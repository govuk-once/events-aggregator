import {
  describe,
  it,
  vi,
  afterAll,
  expect,
  afterEach,
  beforeEach,
} from 'vitest';
import { handler } from '.';
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
import { Logger } from '@aws-lambda-powertools/logger';

import nock from 'nock';
import { mockClient } from 'aws-sdk-client-mock';
import {
  QueryCommand,
  type QueryCommandInput,
  DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { metrics } from '../utils/observability';

vi.stubEnv('UNS_API_URL', 'http://uns.api');
vi.stubEnv('UNS_CERT_ARN', 'arn::cert');
vi.stubEnv('UNS_KEY_ARN', 'arn:key');
vi.stubEnv('UNS_API_KEY_ARN', 'api_key');
vi.stubEnv('SSM_PREFIX', 'prefix');
vi.stubEnv('SOURCE_TABLE_NAME', 'tablename');
vi.stubEnv(
  'INCOMING_EVENTS_QUEUE_URL',
  'https://sqs.eu-west-2.amazonaws.com/000000000000/incoming-events.fifo',
);

const dynamoMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);

type MockCommand = Parameters<typeof dynamoMock.on>[0];
const asCommand = (command: unknown) => command as MockCommand;

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
    ): Promise<T> => fn(subsegmentMock),
  );

  return { segmentMock, subsegmentMock };
});

vi.mock('../utils/segment', () => ({ segment: segmentMock }));

const loggerInfoSpy = vi
  .spyOn(Logger.prototype, 'info')
  .mockImplementation(() => {});

const loggerErrorSpy = vi
  .spyOn(Logger.prototype, 'error')
  .mockImplementation(() => {});

const mockGetSecret = vi.mocked(getSecret) as unknown as ReturnType<
  typeof vi.fn
>;

const metricsAddSpy = vi.spyOn(metrics, 'addMetric');

const metricsPublishSpy = vi
  .spyOn(metrics, 'publishStoredMetrics')
  .mockImplementation(() => metrics);

const spainSource = {
  sourceID: 'src-spain',
  compositeKey: 'travel/spain',
  URL: 'https://www.gov.uk/api/content/travel-advice/spain',
  sourceEnabled: true,
};

describe('Travel Alerts Schedule', () => {
  beforeEach(() => {
    dynamoMock.reset();
    sqsMock.reset();
  });

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
              link: '/foreign-travel-advice/spain',
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

    dynamoMock.on(asCommand(QueryCommand)).resolves({ Items: [spainSource] });

    sqsMock.on(SendMessageCommand).resolves({});

    const response = await handler({
      triggeredAt: '2026-07-20',
      schedule: 'daily',
    });

    expect(response).toBe(true);

    const queryCalls = dynamoMock.commandCalls(asCommand(QueryCommand));
    expect(queryCalls).toHaveLength(1);

    const queryInput = queryCalls[0]?.args[0].input as QueryCommandInput;
    expect(queryInput).toMatchObject({
      TableName: 'tablename',
      IndexName: 'composite-query',
      KeyConditionExpression: '#compositeKey = :compositeKey',
      ExpressionAttributeNames: { '#compositeKey': 'compositeKey' },
      ExpressionAttributeValues: { ':compositeKey': 'travel/spain' },
    });
    expect(queryInput).not.toHaveProperty('ConsistentRead');

    const sendCalls = sqsMock.commandCalls(SendMessageCommand);
    expect(sendCalls).toHaveLength(1);

    const sendInput = sendCalls[0]?.args[0].input;
    expect(sendInput?.MessageGroupId).toBe('travel/spain');
    expect(sendInput?.QueueUrl).toBe(
      'https://sqs.eu-west-2.amazonaws.com/000000000000/incoming-events.fifo',
    );

    const body = JSON.parse(sendInput?.MessageBody as string);
    expect(body).toMatchObject({
      namespace: 'travel',
      group: 'spain',
      eventNote: 'A change has happened',
      eventTimestamp: '2026-07-21T10:10:00Z',
    });

    expect(body.eventID).toMatch(/^[0-9a-f]{64}$/);

    expect(metricsAddSpy).toHaveBeenCalledWith(
      'TravelAdviceResultsRetrieved',
      MetricUnit.Count,
      1,
    );

    expect(metricsAddSpy).toHaveBeenCalledWith(
      'EventSourcesRetrieved',
      MetricUnit.Count,
      1,
    );

    expect(metricsAddSpy).toHaveBeenCalledWith(
      'TravelEventsQueued',
      MetricUnit.Count,
      1,
    );
    expect(metricsPublishSpy).toHaveBeenCalledTimes(1);

    expect(segmentMock).toHaveBeenCalledTimes(4);
    expect(segmentMock.mock.calls.map(([, name]) => name)).toEqual([
      'GetTravelChanges',
      'GetEventSources',
      'GetCountryChanges',
      'PublishCountryChanges',
    ]);

    expect(subsegmentMock.addAnnotation).toHaveBeenCalledWith(
      'Schedule',
      'daily',
    );
    expect(subsegmentMock.addAnnotation).toHaveBeenCalledWith('EventCount', 1);

    scope.done();
    contentScope.done();
  });

  it('should produce a stable eventID for the same change across schedules', async () => {
    const stubRun = (schedule: 'daily' | 'weekly') => {
      nock('https://www.gov.uk')
        .get('/api/search.json')
        .query(true)
        .reply(200, { results: [{ link: '/foreign-travel-advice/spain' }] });

      nock('https://www.gov.uk')
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
            country: { name: 'Spain', slug: 'spain' },
          },
        });

      return handler({ triggeredAt: '2026-07-22', schedule });
    };

    dynamoMock.on(asCommand(QueryCommand)).resolves({ Items: [spainSource] });
    sqsMock.on(SendMessageCommand).resolves({});

    await stubRun('daily');
    await stubRun('weekly');

    const ids = sqsMock
      .commandCalls(SendMessageCommand)
      .map(
        ({ args }) => JSON.parse(args[0].input.MessageBody as string).eventID,
      );

    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it('should return false and log when the search API returns no results', async () => {
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

    const result = await handler({
      triggeredAt: '2027-07-20',
      schedule: 'daily',
    });

    expect(result).toBe(false);

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
      'EventSourcesRetrieved',
      MetricUnit.Count,
      expect.any(Number),
    );
    expect(metricsPublishSpy).toHaveBeenCalledTimes(1);

    expect(segmentMock).toHaveBeenCalledTimes(1);
    expect(segmentMock.mock.calls[0]?.[1]).toBe('GetTravelChanges');

    scope.done();
  });

  it('should return false and log when no sources are found in the database', async () => {
    dynamoMock.on(asCommand(QueryCommand)).resolves({ Items: [] });

    const scope = nock('https://www.gov.uk')
      .get('/api/search.json')
      .query(true)
      .reply(
        200,
        {
          results: [
            {
              link: '/foreign-travel-advice/spain',
            },
          ],
        },
        { content_type: 'application/json' },
      );

    const result = await handler({
      triggeredAt: '2027-07-20',
      schedule: 'daily',
    });

    expect(result).toBe(false);

    expect(loggerInfoSpy).toHaveBeenCalledWith({
      message: 'No sources detected',
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
      'EventSourcesRetrieved',
      MetricUnit.Count,
      0,
    );
    expect(metricsAddSpy).not.toHaveBeenCalledWith(
      'TravelEventsQueued',
      MetricUnit.Count,
      expect.any(Number),
    );
    expect(metricsPublishSpy).toHaveBeenCalledTimes(1);

    expect(segmentMock).toHaveBeenCalledTimes(2);
    expect(segmentMock.mock.calls.map(([, name]) => name)).toEqual([
      'GetTravelChanges',
      'GetEventSources',
    ]);

    scope.done();
  });

  // ADDED: Query returns Items undefined when nothing matches on some paths —
  // the service must not blow up on it.
  it('should treat an undefined Items array as no sources', async () => {
    dynamoMock.on(asCommand(QueryCommand)).resolves({});

    const scope = nock('https://www.gov.uk')
      .get('/api/search.json')
      .query(true)
      .reply(200, { results: [{ link: '/foreign-travel-advice/spain' }] });

    const result = await handler({
      triggeredAt: '2027-07-20',
      schedule: 'daily',
    });

    expect(result).toBe(false);
    expect(metricsAddSpy).toHaveBeenCalledWith(
      'EventSourcesRetrieved',
      MetricUnit.Count,
      0,
    );

    scope.done();
  });

  it('should issue one query per distinct composite key', async () => {
    dynamoMock.on(asCommand(QueryCommand)).resolves({ Items: [] });

    const scope = nock('https://www.gov.uk')
      .get('/api/search.json')
      .query(true)
      .reply(200, {
        results: [
          { link: '/foreign-travel-advice/spain' },
          { link: '/foreign-travel-advice/france' },
          { link: '/foreign-travel-advice/spain' },
        ],
      });

    await handler({ triggeredAt: '2027-07-20', schedule: 'daily' });

    const keys = dynamoMock
      .commandCalls(asCommand(QueryCommand))
      .map(
        ({ args }) =>
          (args[0].input as QueryCommandInput).ExpressionAttributeValues?.[
            ':compositeKey'
          ],
      );

    expect(keys.sort()).toEqual(['travel/france', 'travel/spain']);

    scope.done();
  });

  it('should log and skip a country when the content API returns no changes', async () => {
    dynamoMock.on(asCommand(QueryCommand)).resolves({ Items: [spainSource] });
    sqsMock.on(SendMessageCommand).resolves({ MessageId: 'msg-1' });

    const scope = nock('https://www.gov.uk')
      .get('/api/search.json')
      .query(true)
      .reply(200, { results: [{ link: '/foreign-travel-advice/spain' }] });

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

    await handler({ triggeredAt: '2027-07-20', schedule: 'daily' });

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
      'EventSourcesRetrieved',
      MetricUnit.Count,
      1,
    );
    expect(metricsAddSpy).not.toHaveBeenCalledWith(
      'TravelEventsQueued',
      MetricUnit.Count,
      expect.any(Number),
    );

    expect(metricsPublishSpy).toHaveBeenCalledTimes(1);

    expect(segmentMock).toHaveBeenCalledTimes(3);
    expect(segmentMock.mock.calls.map(([, name]) => name)).toEqual([
      'GetTravelChanges',
      'GetEventSources',
      'GetCountryChanges',
    ]);

    scope.done();
    contentScope.done();
  });

  it('should throw and log when the search API returns an error', async () => {
    const scope = nock('https://www.gov.uk')
      .get('/api/search.json')
      .query(true)
      .reply(
        500,
        { message: 'unknown error' },
        { content_type: 'application/json' },
      );

    await expect(
      handler({ triggeredAt: '2027-07-20', schedule: 'daily' }),
    ).rejects.toThrow('Search api returned a 500');

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

  it('should throw and log when the content API returns an error', async () => {
    dynamoMock.on(asCommand(QueryCommand)).resolves({ Items: [spainSource] });

    const scope = nock('https://www.gov.uk')
      .get('/api/search.json')
      .query(true)
      .reply(
        200,
        {
          results: [
            {
              link: '/foreign-travel-advice/spain',
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
      handler({ triggeredAt: '2027-07-20', schedule: 'daily' }),
    ).rejects.toThrow('Content api returned a 500');

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
    expect(metricsAddSpy).toHaveBeenCalledWith(
      'EventSourcesRetrieved',
      MetricUnit.Count,
      1,
    );
    expect(metricsPublishSpy).toHaveBeenCalledTimes(1);

    expect(segmentMock).toHaveBeenCalledTimes(3);
    expect(segmentMock.mock.calls.map(([, name]) => name)).toEqual([
      'GetTravelChanges',
      'GetEventSources',
      'GetCountryChanges',
    ]);

    scope.done();
    contentScope.done();
  });

  it('should skip a disabled source without queuing events', async () => {
    dynamoMock.on(asCommand(QueryCommand)).resolves({
      Items: [{ ...spainSource, sourceEnabled: false }],
    });

    const scope = nock('https://www.gov.uk')
      .get('/api/search.json')
      .query(true)
      .reply(200, { results: [{ link: '/foreign-travel-advice/spain' }] });

    const result = await handler({
      triggeredAt: '2026-07-20',
      schedule: 'daily',
    });

    expect(result).toBe(true);

    expect(metricsAddSpy).toHaveBeenCalledWith(
      'EventSourcesRetrieved',
      MetricUnit.Count,
      1,
    );
    expect(metricsAddSpy).not.toHaveBeenCalledWith(
      'TravelEventsQueued',
      MetricUnit.Count,
      expect.any(Number),
    );
    expect(metricsPublishSpy).toHaveBeenCalledTimes(1);

    expect(segmentMock).toHaveBeenCalledTimes(2);
    expect(segmentMock.mock.calls.map(([, name]) => name)).toEqual([
      'GetTravelChanges',
      'GetEventSources',
    ]);

    expect(sqsMock.calls()).toHaveLength(0);

    scope.done();
  });
});
