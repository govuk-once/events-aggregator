import { GetParametersByPathCommand, SSMClient } from '@aws-sdk/client-ssm';
import { Logger } from '@aws-lambda-powertools/logger';

import { InMemoryTTLCache } from './in-memory-ttl-cache.js';

export const SsmParameters = {
  GovukFeedUrl: 'govuk-feed-url',
  UnsApiUrl: 'uns-api-url',
  UnsMtlsCertArn: 'uns-mtls-cert-arn',
  UnsMtlsKeyArn: 'uns-mtls-key-arn',
} as const;

export type SsmParameterKey =
  (typeof SsmParameters)[keyof typeof SsmParameters];

const TTL_MS = 60_000;

const logger = new Logger({
  serviceName: 'ssm-client',
});

const ssmClient = new SSMClient({});

const cache = new InMemoryTTLCache<string, string>(TTL_MS);

let refreshPromise: Promise<void> | null = null;

function getSsmPrefix(): string {
  const prefix = process.env.SSM_PREFIX;

  if (!prefix) {
    throw new Error('SSM_PREFIX environment variable is not set');
  }

  return prefix.replace(/^\/+|\/+$/g, '');
}

const refreshCache = async (): Promise<void> => {
  const prefix = getSsmPrefix();

  logger.info('Refreshing SSM cache', {
    prefix,
  });

  let nextToken: string | undefined;

  do {
    const result = await ssmClient.send(
      new GetParametersByPathCommand({
        Path: `/${prefix}/`,
        Recursive: true,
        WithDecryption: true,
        MaxResults: 10,
        NextToken: nextToken,
      }),
    );

    for (const parameter of result.Parameters ?? []) {
      if (parameter.Name && parameter.Value !== undefined) {
        cache.set(parameter.Name, parameter.Value);
      }
    }

    nextToken = result.NextToken;
  } while (nextToken);
};

async function ensureCacheIsRefreshed(): Promise<void> {
  if (refreshPromise === null) {
    refreshPromise = refreshCache().then(
      () => {
        refreshPromise = null;
      },
      (error) => {
        refreshPromise = null;
        throw error;
      },
    );
  } else {
    logger.info('Waiting for in-progress SSM cache refresh');
  }

  await refreshPromise;
}

export const getParameter = async (key: SsmParameterKey): Promise<string> => {
  const prefix = getSsmPrefix();
  const fullKey = `/${prefix}/${key}`;

  if (!cache.has(fullKey)) {
    await ensureCacheIsRefreshed();
  }

  const value = cache.get(fullKey);

  if (value === undefined) {
    throw new Error(`SSM parameter not found: ${fullKey}`);
  }

  logger.debug('Retrieved SSM parameter', {
    key: fullKey,
    source: 'cache',
  });

  return value;
};
