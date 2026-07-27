import type { FetchInit, NotificationPayload } from '@/types';
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
import { createHash } from 'node:crypto';
import { Agent } from 'undici';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MtlsClientConfig {
  /** Base URL of the mTLS-enabled UNS API (e.g. https://uns.example.com) */
  apiUrl: string;
  /** PEM-encoded client certificate chain. */
  clientCert: string;
  /** PEM-encoded private key for `clientCert`. */
  clientKey: string;
  /** Optional passphrase if `clientKey` is encrypted. */
  keyPassphrase?: string;
  /**
   * Optional PEM-encoded CA bundle used to verify the *server* certificate.
   * Only needed when the server is signed by a private CA.
   */
  caCert?: string;
  /** Optional API key, if the API requires one alongside the client cert. */
  apiKey?: string;
}

/** The PEM pair, each read from its own Secrets Manager secret. */
export interface MtlsCertificate {
  clientCert: string;
  clientKey: string;
}

export type NotificationStatus = 'RECEIVED' | 'READ' | 'MARKED_AS_UNREAD';

export interface NotificationPatchBody {
  Status: NotificationStatus;
}

/** Discriminated result — success or a structured error, never throws on HTTP status. */
export type ApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: { status: number; message: string; body?: unknown } };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KEEP_ALIVE_TIMEOUT_MS = 60_000;
const CONNECT_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// TLS dispatcher
//
// Building an Agent performs the key/cert parse and holds the connection pool,
// so we cache one per (host + certificate) pair. On a warm Lambda this keeps the
// TLS session alive across invocations instead of re-handshaking every request.
// ---------------------------------------------------------------------------

const agentCache = new Map<string, Agent>();

const cacheKey = (config: MtlsClientConfig): string => {
  const fingerprint = createHash('sha265')
    .update(config.clientCert)
    .update('|')
    .update(config.clientKey)
    .digest('hex');

  return `${config.apiUrl}|${fingerprint}`;
};

const createAgent = (config: MtlsClientConfig): Agent =>
  new Agent({
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
    connect: {
      cert: config.clientCert,
      key: config.clientKey,
      timeout: CONNECT_TIMEOUT_MS,
    },
  });

const getAgent = (config: MtlsClientConfig): Agent => {
  const key = cacheKey(config);
  const cached = agentCache.get(key);
  if (cached) return cached;

  const agent = createAgent(config);
  agentCache.set(key, agent);
  return agent;
};

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

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Create a UNS remote client authenticated with mutual TLS.
 *
 * Typed methods per the UNS notification contract. Every request presents the
 * configured client certificate; no AWS credentials or role assumption involved.
 */
export const createUnsMtlsClient = (config: MtlsClientConfig) => {
  const dispatcher = getAgent(config);

  const defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(config.apiKey ? { 'X-API-KEY': config.apiKey } : {}),
  };

  const send = <T>(path: string, init: RequestInit): Promise<ApiResult<T>> => {
    const requestInit: FetchInit = {
      ...init,
      headers: {
        ...defaultHeaders,
        ...(init.headers as Record<string, string>),
      },
      dispatcher: dispatcher as never,
    };

    return toApiResult(fetch(`${config.apiUrl}${path}`, requestInit));
  };

  return {
    notification: {
      sendToSubscribers: (
        body: NotificationPayload[],
      ): Promise<ApiResult<void>> =>
        send(`/send-to-subscribers`, {
          method: 'POST',
          body: JSON.stringify(body),
        }),
    },
  };
};

export type UnsMtlsClient = ReturnType<typeof createUnsMtlsClient>;

// ---------------------------------------------------------------------------
// Certificate loading
//
// The certificate and key are NOT hardcoded and do NOT live in a consumer-config
// blob. Each is its own AWS Secrets Manager secret holding a raw PEM string, read
// at runtime from two ARNs passed in via env vars.
//
// Requires: @aws-lambda-powertools/parameters
// ---------------------------------------------------------------------------

/**
 * PEM stored in Secrets Manager is sometimes written with escaped newlines (when
 * it has been round-tripped through JSON). Normalise those back to real newlines
 * — `crypto` rejects a PEM whose armour is not newline-delimited.
 */
const normalisePem = (pem: string): string => pem.replace(/\\n/g, '\n').trim();

/**
 * Read one secret as a raw PEM string. `maxAge` caches the value for 10 minutes
 * so we don't hit Secrets Manager on every warm invocation.
 */
const loadPem = async (secretArn: string, label: string): Promise<string> => {
  const value = await getSecret<string>(secretArn, { maxAge: 600 });

  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} secret is empty or not a string: ${secretArn}`);
  }

  const pem = normalisePem(value);
  if (!pem.startsWith('-----BEGIN')) {
    throw new Error(
      `${label} secret does not contain a PEM block: ${secretArn}`,
    );
  }

  return pem;
};

/**
 * Load the client certificate and private key from two separate Secrets Manager
 * secrets. Both reads are issued concurrently.
 *
 * @param certSecretArn ARN (or name) of the secret holding the PEM certificate chain.
 * @param keySecretArn  ARN (or name) of the secret holding the PEM private key.
 */
export const loadMtlsCertificate = async (
  certSecretArn: string,
  keySecretArn: string,
): Promise<MtlsCertificate> => {
  const [clientCert, clientKey] = await Promise.all([
    loadPem(certSecretArn, 'Client certificate'),
    loadPem(keySecretArn, 'Client private key'),
  ]);

  return { clientCert, clientKey };
};

/**
 * Convenience factory: fetch the PEM pair from their two secrets and build a
 * client in one step.
 */
export const createUnsMtlsClientFromSecrets = async (options: {
  apiUrl: string;
  certSecretArn: string;
  keySecretArn: string;
  keyPassphrase?: string;
  caCert?: string;
  apiKey?: string;
}): Promise<UnsMtlsClient> => {
  const { certSecretArn, keySecretArn, ...rest } = options;
  const certificate = await loadMtlsCertificate(certSecretArn, keySecretArn);

  return createUnsMtlsClient({ ...rest, ...certificate });
};
