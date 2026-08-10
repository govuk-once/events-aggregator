import { Logger } from '@aws-lambda-powertools/logger';
import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
import type { Context } from 'aws-lambda';
import nock from 'nock';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { handler } from '.';
import { metrics } from '../utils/observability';
import { mockClient } from 'aws-sdk-client-mock';
import { BatchGetCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

vi.stubEnv('UNS_API_URL', 'http://uns.api');
vi.stubEnv('UNS_CERT_ARN', 'arn::cert');
vi.stubEnv('UNS_KEY_ARN', 'arn:key');
vi.stubEnv('UNS_API_KEY_ARN', 'api_key');
vi.stubEnv('SSM_PREFIX', 'prefix');
vi.stubEnv('SOURCE_TABLE_NAME', 'tablename');

const dynamoMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);

const { sendMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
}));

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class {
    send = sendMock;
  },

  GetParametersByPathCommand: class {
    input: Record<string, unknown>;

    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
}));

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

const { segmentMock, subsegmentMock } = vi.hoisted(() => {
  const subsegmentMock = {
    addAnnotation: vi.fn(),
    addMetadata: vi.fn(),
  };

  const segmentMock = vi.fn(
    async <T>(
      _tracer: unknown,
      _name: string,
      fn: (segment: typeof subsegmentMock) => Promise<T> | T,
    ): Promise<T> => {
      return fn(subsegmentMock);
    },
  );

  return {
    segmentMock,
    subsegmentMock,
  };
});

vi.mock('../utils/segment', () => ({
  segment: segmentMock,
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

const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'events-aggregator-travel-digestion',
  functionVersion: '$LATEST',
  invokedFunctionArn:
    'arn:aws:lambda:eu-west-2:123456789012:function:travel-digestion',
  memoryLimitInMB: '128',
  awsRequestId: 'test-request-id',
  logGroupName: '/aws/lambda/travel-digestion',
  logStreamName: 'test-log-stream',
  getRemainingTimeInMillis: vi.fn().mockReturnValue(30_000),
  done: vi.fn(),
  fail: vi.fn(),
  succeed: vi.fn(),
};

const metricsAddSpy = vi.spyOn(metrics, 'addMetric');

const metricsPublishSpy = vi
  .spyOn(metrics, 'publishStoredMetrics')
  .mockImplementation(() => metrics);

describe('Travel Alerts Schedule', () => {
  afterEach(() => {
    loggerInfoSpy.mockClear();
    loggerErrorSpy.mockClear();
    metricsAddSpy.mockClear();
    metricsPublishSpy.mockClear();
    sendMock.mockClear();
    mockGetSecret.mockClear();
    segmentMock.mockClear();
    subsegmentMock.addAnnotation.mockClear();
    subsegmentMock.addMetadata.mockClear();
  });

  afterAll(() => {
    nock.cleanAll();
  });

  it('Should get all travel alerts for given time and send to uns', async () => {
    sendMock.mockResolvedValueOnce({
      Parameters: [
        {
          Name: '/prefix/uns-api-url',
          Value: 'http://uns.api',
        },
        {
          Name: '/prefix/uns-api-key',
          Value: 'api_key',
        },
        {
          Name: '/prefix/uns-mtls-cert-arn',
          Value: 'arn::cert',
        },
        {
          Name: '/prefix/uns-mtls-key-arn',
          Value: 'arn:key',
        },
      ],
    });

    mockGetSecret.mockResolvedValue('-----BEGIN');

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

    dynamoMock.on(BatchGetCommand).resolves({
      Responses: {
        tablename: [
          {
            compositeKey: 'travel/spain',
            URL: '/travel-advice/spain',
            sourceEnabled: true,
          },
        ],
      },
    });

    sqsMock.on(SendMessageCommand).resolves({});

    const response = await handler(
      {
        triggeredAt: '2026-07-20',
        schedule: 'daily',
      },
      mockContext,
    );

    expect(response).toBe(true);

    expect(metricsAddSpy).toHaveBeenCalledWith(
      'TravelAdviceResultsRetrieved',
      MetricUnit.Count,
      1,
    );

    expect(metricsAddSpy).toHaveBeenCalledWith(
      'NotificationPayloadsCreated',
      MetricUnit.Count,
      1,
    );

    expect(metricsAddSpy).toHaveBeenCalledWith(
      'NotificationsSubmitted',
      MetricUnit.Count,
      1,
    );

    expect(metricsAddSpy).not.toHaveBeenCalledWith(
      'NotificationSubmissionFailures',
      MetricUnit.Count,
      expect.any(Number),
    );

    expect(metricsPublishSpy).toHaveBeenCalledTimes(1);

    expect(segmentMock).toHaveBeenCalledTimes(2);

    expect(segmentMock.mock.calls.map(([, name]) => name)).toEqual([
      'GetTravelChanges',
      'SubmitNotifications',
    ]);

    scope.done();
    contentScope.done();
  });

  it('should log info if the search api returns no results', async () => {
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

    await handler(
      {
        triggeredAt: '2027-07-20',
        schedule: 'daily',
      },
      mockContext,
    );

    expect(loggerInfoSpy).toHaveBeenCalledWith({
      message: 'No travel changes found',
      schedule: 'daily',
      startTime: '2027-07-19T00:00:00.000Z',
      triggeredAt: '2027-07-20',
    });

    expect(metricsAddSpy).toHaveBeenCalledWith(
      'TravelAdviceResultsRetrieved',
      MetricUnit.Count,
      0,
    );

    expect(metricsAddSpy).not.toHaveBeenCalledWith(
      'NotificationPayloadsCreated',
      MetricUnit.Count,
      expect.any(Number),
    );

    expect(metricsAddSpy).not.toHaveBeenCalledWith(
      'NotificationsSubmitted',
      MetricUnit.Count,
      expect.any(Number),
    );

    expect(metricsPublishSpy).toHaveBeenCalledTimes(1);

    expect(segmentMock).toHaveBeenCalledTimes(1);
    expect(segmentMock.mock.calls[0]?.[1]).toBe('GetTravelChanges');

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

    await handler(
      {
        triggeredAt: '2027-07-20',
        schedule: 'daily',
      },
      mockContext,
    );

    expect(loggerInfoSpy).toHaveBeenCalledWith({
      message: 'No country changes detected in content API',
      schedule: 'daily',
      startTime: '2027-07-19T00:00:00.000Z',
      triggeredAt: '2027-07-20',
    });

    expect(metricsAddSpy).toHaveBeenCalledWith(
      'TravelAdviceResultsRetrieved',
      MetricUnit.Count,
      1,
    );

    expect(metricsAddSpy).toHaveBeenCalledWith(
      'NotificationPayloadsCreated',
      MetricUnit.Count,
      0,
    );

    expect(metricsAddSpy).not.toHaveBeenCalledWith(
      'NotificationsSubmitted',
      MetricUnit.Count,
      expect.any(Number),
    );

    expect(metricsPublishSpy).toHaveBeenCalledTimes(1);

    expect(segmentMock).toHaveBeenCalledTimes(1);
    expect(segmentMock.mock.calls[0]?.[1]).toBe('GetTravelChanges');

    scope.done();
    contentScope.done();
  });

  it('should log the error if the search api throws an error', async () => {
    const scope = nock('https://www.gov.uk')
      .get('/api/search.json')
      .query(true)
      .reply(
        500,
        { message: 'unknown error' },
        { content_type: 'application/json' },
      );

    await expect(
      handler(
        {
          triggeredAt: '2027-07-20',
          schedule: 'daily',
        },
        mockContext,
      ),
    ).rejects.toThrow();

    expect(loggerErrorSpy).toHaveBeenCalledWith({
      message: 'Search api returned a 500',
      schedule: 'daily',
      triggeredAt: '2027-07-20',
    });

    expect(metricsAddSpy).not.toHaveBeenCalledWith(
      'TravelAdviceResultsRetrieved',
      MetricUnit.Count,
      expect.any(Number),
    );

    expect(metricsPublishSpy).toHaveBeenCalledTimes(1);

    expect(segmentMock).toHaveBeenCalledTimes(1);
    expect(segmentMock.mock.calls[0]?.[1]).toBe('GetTravelChanges');

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
      handler(
        {
          triggeredAt: '2027-07-20',
          schedule: 'daily',
        },
        mockContext,
      ),
    ).rejects.toThrow();

    expect(loggerErrorSpy).toHaveBeenCalledWith({
      message: 'Content api returned a 500',
      schedule: 'daily',
      triggeredAt: '2027-07-20',
    });

    expect(metricsAddSpy).toHaveBeenCalledWith(
      'TravelAdviceResultsRetrieved',
      MetricUnit.Count,
      1,
    );

    expect(metricsAddSpy).not.toHaveBeenCalledWith(
      'NotificationPayloadsCreated',
      MetricUnit.Count,
      expect.any(Number),
    );

    expect(metricsPublishSpy).toHaveBeenCalledTimes(1);

    expect(segmentMock).toHaveBeenCalledTimes(1);
    expect(segmentMock.mock.calls[0]?.[1]).toBe('GetTravelChanges');

    scope.done();
    contentScope.done();
  });

  it('should record a metric when UNS returns an unsuccessful response', async () => {
    sendMock.mockResolvedValueOnce({
      Parameters: [
        {
          Name: '/prefix/uns-api-url',
          Value: 'http://uns.api',
        },
        {
          Name: '/prefix/uns-api-key',
          Value: 'api_key',
        },
        {
          Name: '/prefix/uns-mtls-cert-arn',
          Value: 'arn::cert',
        },
        {
          Name: '/prefix/uns-mtls-key-arn',
          Value: 'arn:key',
        },
      ],
    });

    mockGetSecret.mockResolvedValue('-----BEGIN');

    const searchScope = nock('https://www.gov.uk')
      .get('/api/search.json')
      .query(true)
      .reply(200, {
        results: [
          {
            link: '/travel-advice/spain',
          },
        ],
      });

    const contentScope = nock('https://www.gov.uk')
      .get('/api/content/travel-advice/spain')
      .query(true)
      .reply(200, {
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
      });

    const unsScope = nock('http://uns.api')
      .post('/v1/send-to-group')
      .reply(500, {
        message: 'UNS unavailable',
      });

    await expect(
      handler(
        {
          triggeredAt: '2026-07-20',
          schedule: 'daily',
        },
        mockContext,
      ),
    ).rejects.toThrow('UNS error');

    expect(metricsAddSpy).toHaveBeenCalledWith(
      'NotificationSubmissionFailures',
      MetricUnit.Count,
      1,
    );

    expect(metricsAddSpy).not.toHaveBeenCalledWith(
      'NotificationsSubmitted',
      MetricUnit.Count,
      expect.any(Number),
    );

    expect(metricsPublishSpy).toHaveBeenCalledTimes(1);

    expect(segmentMock).toHaveBeenCalledTimes(2);

    expect(segmentMock.mock.calls.map(([, name]) => name)).toEqual([
      'GetTravelChanges',
      'SubmitNotifications',
    ]);

    searchScope.done();
    contentScope.done();
    unsScope.done();
  it('should log if theres no content sources in the database', async () => {
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

    dynamoMock.on(BatchGetCommand).resolves({
      Responses: {
        tablename: [],
      },
    });

    await handler({
      triggeredAt: '2027-07-20',
      schedule: 'daily',
    });

    expect(loggerInfoSpy).toHaveBeenCalledWith({
      message: 'No sources detected',
      schedule: 'daily',
      startTime: '2027-07-19T00:00:00.000Z',
      triggeredAt: '2027-07-20',
    });

    scope.done();
  });
});
