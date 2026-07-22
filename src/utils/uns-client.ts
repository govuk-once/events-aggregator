import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { createSignedFetcher } from 'aws-sigv4-fetch';
import {
  ApiResult,
  ConsumerConfig,
  CredentialProvider,
  NotificationPayload,
} from '@/types';
import { AwsCredentialIdentity } from '@aws-sdk/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNS_ROUTE = '/subscriptions';
const CREDENTIAL_REFRESH_BUFFER_MS = 300_000; // refresh when < 5 min remain

// ---------------------------------------------------------------------------
// Credential caching
// ---------------------------------------------------------------------------

/** A credential is still usable while it has no expiry or is comfortably before it. */
const isFresh = (credential?: AwsCredentialIdentity): boolean => {
  if (credential === undefined) return false;
  const expiresAt = credential.expiration?.getTime();
  return (
    expiresAt === undefined ||
    expiresAt - Date.now() > CREDENTIAL_REFRESH_BUFFER_MS
  );
};

/**
 * Wrap a credential provider so credentials are reused across calls and only
 * refreshed near expiry — keeping us within the STS TTL instead of assuming the
 * role on every request. Uses a closure-captured cache rather than mutation of
 * shared scope.
 */
const memoizeCredentials = (
  provider: CredentialProvider,
): CredentialProvider => {
  const cache: { current?: AwsCredentialIdentity } = {};
  return async () =>
    isFresh(cache.current)
      ? (cache.current as AwsCredentialIdentity)
      : (cache.current = await provider());
};

// Reuse providers across client instances keyed by role ARN, so warm
// invocations keep their cached credentials.
const providerCache = new Map<string, CredentialProvider>();

const getCredentialProvider = (
  roleArn: string,
  roleName: string,
  region: string,
): CredentialProvider =>
  providerCache.get(roleArn) ??
  providerCache
    .set(
      roleArn,
      memoizeCredentials(
        fromTemporaryCredentials({
          clientConfig: { region },
          params: { RoleArn: roleArn, RoleSessionName: roleName },
        }),
      ),
    )
    .get(roleArn)!;

// ---------------------------------------------------------------------------
// Response handling
// ---------------------------------------------------------------------------

const parseBody = async (response: Response): Promise<unknown> => {
  if (response.status === 204 || response.headers.get('content-length') === '0')
    return undefined;

  const text = await response.text();
  if (!text) return undefined;

  const isJson = (response.headers.get('content-type') ?? '').includes(
    'application/json',
  );
  if (!isJson) return text;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const toApiResult = async <T>(
  request: Promise<Response>,
): Promise<ApiResult<T>> => {
  const res = await request;
  const body = await parseBody(res);

  return res.ok
    ? { ok: true, status: res.status, data: body as T }
    : {
        ok: false,
        error: {
          status: res.status,
          message:
            (body as { message?: string } | undefined)?.message ??
            res.statusText,
          body,
        },
      };
};

/*
 * Create a UNS remote client.
 *
 * Typed methods per the UNS notification contract. Every request is SigV4
 * signed with temporary credentials assumed from `config.roleArn`.
 */
export const createUnsRemoteClient = (config: ConsumerConfig) => {
  const signedFetch = createSignedFetcher({
    service: 'execute-api',
    region: config.region,
    credentials: getCredentialProvider(
      config.roleArn,
      'uns-consumer-session',
      config.region,
    ),
  });

  const defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-API-KEY': config.apiKey,
  };

  const send = <T>(path: string, init: RequestInit): Promise<ApiResult<T>> =>
    toApiResult(
      signedFetch(`${config.privateApiUrl}${path}`, {
        ...init,
        headers: {
          ...defaultHeaders,
          ...(init.headers as Record<string, string>),
        },
      }),
    );

  return {
    subscription: {
      sendToSubscribers: (
        body: NotificationPayload[],
      ): Promise<ApiResult<void>> =>
        send(`${UNS_ROUTE}/`, {
          method: 'POST',
          body: JSON.stringify(body),
        }),
    },
  };
};

export type UnsRemoteClient = ReturnType<typeof createUnsRemoteClient>;

/**
 * Load a ConsumerConfig from an AWS Secrets Manager secret (JSON), the same way
 * the flex platform does. `maxAge` caches the value for 10 minutes so we don't
 * hit Secrets Manager on every warm invocation.
 *
 * @param secretArn ARN (or name) of the JSON secret to read.
 */
export const loadConsumerConfig = async (
  secretArn: string,
): Promise<ConsumerConfig> => {
  const config = await getSecret<ConsumerConfig>(secretArn, {
    transform: 'json',
    maxAge: 600,
  });

  if (!config) throw new Error('Consumer config not found');

  const missing = (
    ['apiKey', 'roleArn', 'privateApiUrl', 'region'] as const
  ).filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new Error(`Consumer config missing fields: ${missing.join(', ')}`);
  }

  return config;
};
