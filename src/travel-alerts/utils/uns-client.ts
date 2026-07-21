import { ApiResult, NotificationPayload, typedFetch } from '../types';
import { ConsumerConfig } from './config';
import { createSigv4FetchWithCredentials } from './sigv4';

const UNS_REMOTE_ROUTES = {
  subscription: '',
};

/**
 * Remote client for the UNS API.
 *
 * Typed methods per UnsRemoteContract. Validates responses with Zod schemas.
 * Private to the gateway package — domain services NEVER import from here.
 */
export function createUnsRemoteClient(config: ConsumerConfig) {
  const fetcher = createSigv4FetchWithCredentials({
    region: config.region,
    baseUrl: config.privateApiUrl,
    roleArn: config.roleArn,
    roleName: 'uns-consumer-session',
  });

  const defaultHeaders = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-API-KEY': config.apiKey,
  };

  return {
    notification: {
      sendToSubscribers: (
        body: NotificationPayload[],
      ): Promise<ApiResult<void>> => {
        const request = fetcher(`${UNS_REMOTE_ROUTES.subscription}`, {
          method: 'POST',
          headers: defaultHeaders,
          body: JSON.stringify(body),
        }).request;
        return typedFetch(request);
      },
    },
  };
}

export type UnsRemoteClient = ReturnType<typeof createUnsRemoteClient>;
