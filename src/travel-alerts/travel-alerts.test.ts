import { describe, it, beforeEach, vi, afterAll } from 'vitest';
import { handler } from '.';
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';

vi.stubEnv('FLEX_UNS_CONSUMER_CONFIG_SECRET_ARN', 'arn:test');

const mockCredentialProvider = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    accessKeyId: 'test-access-key-id',
    secretAccessKey: 'test-secret-access-key', // pragma: allowlist secret
    sessionToken: 'test-session-token',
  }),
);

vi.mock('@aws-sdk/credential-providers', () => ({
  fromTemporaryCredentials: vi.fn().mockReturnValue(mockCredentialProvider),
}));

vi.mock('@aws-lambda-powertools/parameters/secrets', () => ({
  getSecret: vi.fn(),
}));

const mockGetSecret = vi.mocked(getSecret) as unknown as ReturnType<
  typeof vi.fn
>;

describe('Travel Alerts Schedule', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it('Should get all travel alerts for given time and send to uns', async () => {
    mockGetSecret.mockResolvedValue({
      apiUrl: 'https://test.api',
      apiKey: 'key',
      region: 'test',
      privateApiUrl: 'https://api.test',
      roleArn: 'key', // pragma: allowlist secret
    });

    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                link: '/travel-advice/spain',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            details: {
              change_history: [
                {
                  note: 'A change has happened',
                },
              ],
              country: {
                name: 'Spain',
                slug: 'spain',
              },
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

    await handler({
      triggeredAt: '2026-07-20',
      schedule: 'daily',
    });
  });

  //   it('should log if no alerts are found')

  //   it('Should log if theres an error from the search api')

  //   it('should log if theres an error from the content api')
});
