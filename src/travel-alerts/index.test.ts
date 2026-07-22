import { describe, it, vi, afterAll, expect } from 'vitest';
import { handler } from '.';
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
import { Logger } from '@aws-lambda-powertools/logger';

import nock from 'nock';
import { afterEach } from 'node:test';

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

const loggerInfoSpy = vi
  .spyOn(Logger.prototype, 'info')
  .mockImplementation(() => {});

const loggerErrorSpy = vi
  .spyOn(Logger.prototype, 'error')
  .mockImplementation(() => {});

const mockGetSecret = vi.mocked(getSecret) as unknown as ReturnType<
  typeof vi.fn
>;

describe('Travel Alerts Schedule', () => {
  afterEach(() => {
    loggerInfoSpy.mockClear();
    loggerErrorSpy.mockClear();
  });

  afterAll(() => {
    nock.cleanAll();
  });

  it('Should get all travel alerts for given time and send to uns', async () => {
    mockGetSecret.mockResolvedValue({
      apiUrl: 'https://test.api',
      apiKey: 'key',
      region: 'test',
      privateApiUrl: 'https://api.test',
      roleArn: 'key', // pragma: allowlist secret
    });

    const scope = nock('https://www.gov.uk')
      .get('/api/search.json')
      .query(true)
      .reply(
        200,
        {
          results: [
            {
              link: '/travel-advice/spain',
            },
          ],
        },
        { content_type: 'application/json' },
      );

    const contentScope = nock('https://www.gov.uk')
      .get('/api/content/travel-advice/spain')
      .query(true)
      .reply(
        200,
        {
          details: {
            change_history: [
              {
                note: 'A change has happened',
                public_timestamp: '2026-07-21T10:10:00Z',
              },
            ],
            country: {
              name: 'Spain',
              slug: 'spain',
            },
          },
        },
        { content_type: 'application/json' },
      );

    const unsScope = nock('https://api.test')
      .post('/subscriptions/', [
        {
          Subscription: 'travel/spain/daily',
          NotificationTitle: 'There has been 1 travel updates for Spain',
          NotificationBody: 'There has been 1 travel updates for Spain',
          MessageTitle: 'There has been 1 travel updates for Spain',
          MessageBody: 'There has been 1 travel updates for Spain',
        },
      ])
      .query(true)
      .reply(200, {}, { content_type: 'application/json' });

    await handler({
      triggeredAt: '2026-07-20',
      schedule: 'daily',
    });

    scope.done();
    contentScope.done();
    unsScope.done();
  });

  it('should log info if the search api returns not results', async () => {
    const scope = nock('https://www.gov.uk')
      .get('/api/search.json')
      .query(true)
      .reply(
        200,
        {
          results: [],
        },
        { content_type: 'application/json' },
      );

    await handler({
      triggeredAt: '2027-07-20',
      schedule: 'daily',
    });

    expect(loggerInfoSpy).toHaveBeenCalledWith({
      message: 'No travel changes found',
      schedule: 'daily',
      startTime: '2027-07-19T00:00:00.000Z',
      triggeredAt: '2027-07-20',
    });

    scope.done();
  });

  it('should log if theres an error from the content api', async () => {
    const scope = nock('https://www.gov.uk')
      .get('/api/search.json')
      .query(true)
      .reply(
        200,
        {
          results: [
            {
              link: '/travel-advice/spain',
            },
          ],
        },
        { content_type: 'application/json' },
      );

    const contentScope = nock('https://www.gov.uk')
      .get('/api/content/travel-advice/spain')
      .query(true)
      .reply(
        200,
        {
          details: {
            change_history: [],
            country: {
              name: 'Spain',
              slug: 'spain',
            },
          },
        },
        { content_type: 'application/json' },
      );

    await handler({
      triggeredAt: '2027-07-20',
      schedule: 'daily',
    });

    expect(loggerInfoSpy).toHaveBeenCalledWith({
      message: 'No country changes detected in content API',
      schedule: 'daily',
      startTime: '2027-07-19T00:00:00.000Z',
      triggeredAt: '2027-07-20',
    });

    scope.done();
    contentScope.done();
  });

  it('should log the error if the search api throws an error', async () => {
    const scope = nock('https://www.gov.uk')
      .get('/api/search.json')
      .query(true)
      .reply(
        500,
        { messge: 'unknown error' },
        { content_type: 'application/json' },
      );

    await expect(
      handler({
        triggeredAt: '2027-07-20',
        schedule: 'daily',
      }),
    ).rejects.toThrow();

    expect(loggerErrorSpy).toHaveBeenCalledWith({
      message: 'Search api returned a 500',
      schedule: 'daily',
      triggeredAt: '2027-07-20',
    });

    scope.done();
  });

  it('should log the error if the content api throws an error', async () => {
    const scope = nock('https://www.gov.uk')
      .get('/api/search.json')
      .query(true)
      .reply(
        200,
        {
          results: [
            {
              link: '/travel-advice/spain',
            },
          ],
        },
        { content_type: 'application/json' },
      );

    const contentScope = nock('https://www.gov.uk')
      .get('/api/content/travel-advice/spain')
      .query(true)
      .reply(
        500,
        { message: 'Unknown Error' },
        { content_type: 'application/json' },
      );

    await expect(
      handler({
        triggeredAt: '2027-07-20',
        schedule: 'daily',
      }),
    ).rejects.toThrow();

    expect(loggerErrorSpy).toHaveBeenCalledWith({
      message: 'Content api returned a 500',
      schedule: 'daily',
      triggeredAt: '2027-07-20',
    });

    scope.done();
    contentScope.done();
  });
});
