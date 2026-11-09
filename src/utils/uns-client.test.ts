import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetch, MockAgent } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  MockAgent: vi.fn(function () {
    return {};
  }),
}));

vi.mock('undici', () => ({
  Agent: MockAgent,
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

vi.mock('@aws-lambda-powertools/logger', () => ({
  Logger: class {
    info = vi.fn();
    error = vi.fn();
  },
}));

const loadClient = () => import('./uns-client.js');

const BASE_CONFIG = {
  apiUrl: 'https://uns.example.com',
  clientCert: '-----BEGIN CERTIFICATE-----\nfoo\n-----END CERTIFICATE-----',
  clientKey: '-----BEGIN PRIVATE KEY-----\nbar\n-----END PRIVATE KEY-----', // pragma: allowlist secret
};

const makeResponse = (
  status: number,
  body?: unknown,
  contentType = 'application/json',
) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status >= 200 && status < 300 ? 'OK' : 'Bad Request',
  headers: { get: (h: string) => (h === 'content-type' ? contentType : null) },
  text: () =>
    Promise.resolve(
      body != null
        ? typeof body === 'string'
          ? body
          : JSON.stringify(body)
        : '',
    ),
});

describe('createUnsMtlsClient', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('sendToSubscribers', () => {
    it('posts to /v1/send-to-group with serialised payload', async () => {
      const { createUnsMtlsClient } = await loadClient();
      mockFetch.mockResolvedValueOnce(makeResponse(200, { received: 1 }));

      const payload = [{ GroupNotificationID: 'abc' }];
      await (
        createUnsMtlsClient(BASE_CONFIG) as ReturnType<
          typeof createUnsMtlsClient
        >
      ).notification.sendToSubscribers(payload as never);

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_CONFIG.apiUrl}/v1/send-to-group`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      );
    });

    it('returns ok:true with parsed JSON body on a 200 response', async () => {
      const { createUnsMtlsClient } = await loadClient();
      mockFetch.mockResolvedValueOnce(makeResponse(200, { sent: 2 }));

      const result = await createUnsMtlsClient(
        BASE_CONFIG,
      ).notification.sendToSubscribers([]);

      expect(result).toEqual({ ok: true, status: 200, data: { sent: 2 } });
    });

    it('returns ok:true with undefined data on a 204 response', async () => {
      const { createUnsMtlsClient } = await loadClient();
      mockFetch.mockResolvedValueOnce(makeResponse(204));

      const result = await createUnsMtlsClient(
        BASE_CONFIG,
      ).notification.sendToSubscribers([]);

      expect(result).toEqual({ ok: true, status: 204, data: undefined });
    });

    it('returns ok:false with error details on a non-2xx response', async () => {
      const { createUnsMtlsClient } = await loadClient();
      mockFetch.mockResolvedValueOnce(
        makeResponse(503, { message: 'Service Unavailable' }),
      );

      const result = await createUnsMtlsClient(
        BASE_CONFIG,
      ).notification.sendToSubscribers([]);

      expect(result).toEqual({
        ok: false,
        error: {
          status: 503,
          message: 'Service Unavailable',
          body: { message: 'Service Unavailable' },
        },
      });
    });

    it('falls back to statusText when the error body has no message field', async () => {
      const { createUnsMtlsClient } = await loadClient();
      mockFetch.mockResolvedValueOnce(makeResponse(502, { code: 42 }));

      const result = await createUnsMtlsClient(
        BASE_CONFIG,
      ).notification.sendToSubscribers([]);

      expect(result).toMatchObject({
        ok: false,
        error: { message: 'Bad Request' },
      });
    });

    it('rethrows network errors', async () => {
      const { createUnsMtlsClient } = await loadClient();
      mockFetch.mockRejectedValueOnce(new Error('UND_ERR_HEADERS_TIMEOUT'));

      await expect(
        createUnsMtlsClient(BASE_CONFIG).notification.sendToSubscribers([]),
      ).rejects.toThrow('UND_ERR_HEADERS_TIMEOUT');
    });
  });

  describe('agent caching', () => {
    it('creates one agent and reuses it for repeated client builds with the same config', async () => {
      const { createUnsMtlsClient } = await loadClient();

      createUnsMtlsClient(BASE_CONFIG);
      createUnsMtlsClient(BASE_CONFIG);
      createUnsMtlsClient(BASE_CONFIG);

      expect(MockAgent).toHaveBeenCalledTimes(1);
    });

    it('creates separate agents for configs with different URLs', async () => {
      const { createUnsMtlsClient } = await loadClient();

      createUnsMtlsClient({
        ...BASE_CONFIG,
        apiUrl: 'https://uns-1.example.com',
      });
      createUnsMtlsClient({
        ...BASE_CONFIG,
        apiUrl: 'https://uns-2.example.com',
      });

      expect(MockAgent).toHaveBeenCalledTimes(2);
    });

    it('evicts the cached agent on a network error so the next call gets a fresh one', async () => {
      const { createUnsMtlsClient } = await loadClient();

      const client = createUnsMtlsClient(BASE_CONFIG);
      expect(MockAgent).toHaveBeenCalledTimes(1);

      // Same config: cache hit, no new agent
      createUnsMtlsClient(BASE_CONFIG);
      expect(MockAgent).toHaveBeenCalledTimes(1);

      // Network failure evicts the cache entry
      mockFetch.mockRejectedValueOnce(new Error('timeout'));
      await expect(client.notification.sendToSubscribers([])).rejects.toThrow();

      // Next client build must create a fresh agent
      createUnsMtlsClient(BASE_CONFIG);
      expect(MockAgent).toHaveBeenCalledTimes(2);
    });
  });
});
