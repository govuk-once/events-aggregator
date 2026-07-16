import { SignatureV4 } from '@smithy/signature-v4';
import { HttpRequest } from '@smithy/protocol-http';
import { Hash } from '@smithy/hash-node';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type { NotificationMessage } from './messageBuilder.js';
import type { UnsClientConfig } from '../config.js';

export interface PublishRequest {
  topic: string;
  message: NotificationMessage;
}

export async function publishToUns(
  request: PublishRequest,
  config: UnsClientConfig,
): Promise<void> {
  const { apiUrl, region, sigv4Enabled } = config;

  const body = JSON.stringify({
    topic: request.topic,
    ...request.message,
  });

  const url = new URL(`${apiUrl}/messages`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    host: url.host,
  };

  if (sigv4Enabled) {
    const httpRequest = new HttpRequest({
      method: 'POST',
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      path: url.pathname,
      headers,
      body,
    });

    const signer = new SignatureV4({
      service: 'execute-api',
      region,
      credentials: fromNodeProviderChain(),
      sha256: Hash.bind(null, 'sha256'),
    });

    const signed = await signer.sign(httpRequest);
    Object.assign(headers, signed.headers);
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(
      `UNS API returned ${response.status}: ${response.statusText}`,
    );
  }
}
