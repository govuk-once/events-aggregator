/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  Context,
  DynamoDBBatchResponse,
  DynamoDBRecord,
  DynamoDBStreamEvent,
} from 'aws-lambda';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { handler } from '.';
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
import { Logger } from '@aws-lambda-powertools/logger';
import nock from 'nock';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const dynamodbClient = mockClient(DynamoDBDocumentClient);

vi.stubEnv('UNS_API_URL', 'http://uns.api');
vi.stubEnv('UNS_API_KEY_ARN', 'arn:uns-key');
vi.stubEnv('SSM_PREFIX', 'prefix');
vi.stubEnv('EVENTS_TABLE_NAME', 'event-table');
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

const loggerInfoSpy = vi
  .spyOn(Logger.prototype, 'info')
  .mockImplementation(() => {});

const loggerErrorSpy = vi
  .spyOn(Logger.prototype, 'error')
  .mockImplementation(() => {});

const mockGetSecret = vi.mocked(getSecret) as unknown as ReturnType<
  typeof vi.fn
>;

const context = { awsRequestId: 'req-1' } as Context;

const newImage = (compositeKey = 'travel/spain') => ({
  compositeKey: { S: compositeKey },
  eventTimestamp: { S: '2026-08-10T09:14:22.031Z' },
  group: { S: compositeKey.split('/')[1] },
  namespace: { S: compositeKey.split('/')[0] },
  schedule: { S: 'instant' },
  eventNote: { S: 'Storm warning' },
});

const makeRecord = (
  overrides: Partial<DynamoDBRecord['dynamodb']> = {},
  sequenceNumber = 'seq-1',
): DynamoDBRecord => ({
  eventID: `evt-${sequenceNumber}`,
  eventName: 'INSERT',
  eventVersion: '1.1',
  eventSource: 'aws:dynamodb',
  awsRegion: 'eu-west-2',
  eventSourceARN:
    'arn:aws:dynamodb:eu-west-2:111122223333:table/events/stream/2026',
  dynamodb: {
    ApproximateCreationDateTime: 1786000000,
    Keys: { eventId: { S: 'evt-1' } },
    NewImage: newImage(),
    SequenceNumber: sequenceNumber,
    SizeBytes: 128,
    StreamViewType: 'NEW_AND_OLD_IMAGES',
    ...overrides,
  },
});

const invoke = async (
  records: DynamoDBRecord[],
): Promise<DynamoDBBatchResponse> => {
  const event: DynamoDBStreamEvent = { Records: records };
  return (await handler(
    event,
    context,
    (() => undefined) as any,
  )) as DynamoDBBatchResponse;
};

describe('Single Event', () => {
  beforeEach(() => {
    loggerInfoSpy.mockClear();
    loggerErrorSpy.mockClear();
    sendMock.mockClear();
    mockGetSecret.mockClear();
  });

  afterEach(() => {
    loggerInfoSpy.mockClear();
    loggerErrorSpy.mockClear();
    sendMock.mockClear();
    mockGetSecret.mockClear();
  });

  afterAll(() => {
    nock.cleanAll();
  });

  it('Should handle secret failure', async () => {
    sendMock.mockRejectedValue(new Error('SSM Error'));

    mockGetSecret.mockResolvedValue('-----BEGIN');

    await expect(invoke([makeRecord()])).rejects.toThrow();

    expect(loggerErrorSpy).toHaveBeenCalledWith({
      message: 'SSM Error',
      schedule: 'INSTANT',
    });
  });

  it('Should handle undefined parameters', async () => {
    sendMock.mockResolvedValueOnce({
      Parameters: [],
    });
    mockGetSecret.mockResolvedValue('-----BEGIN');

    await expect(invoke([makeRecord()])).rejects.toThrow();

    expect(loggerErrorSpy).toHaveBeenCalledWith({
      message: 'SSM parameter not found: /prefix/uns-api-url',
      schedule: 'INSTANT',
    });
  });

  it('Should send a single event to uns', async () => {
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

    dynamodbClient.on(UpdateCommand).resolves({
      Attributes: { processingStatus: { instant: '2016-09-09T10:00:00Z' } },
    });

    const unsScope = nock('http://uns.api')
      .post('/v1/send-to-group', [
        {
          Namespace: 'travel',
          Group: 'spain',
          Subgroup: 'instant',
          NotificationTitle: 'Travel Advice - SPAIN',
          NotificationBody:
            "There's been a change in country you are interested in",
          MessageTitle: 'SPAIN Travel Advice',
          MessageBody: 'Storm warning',
        },
      ])
      .reply(200, {}, { content_type: 'application/json' });

    const response = await invoke([makeRecord()]);

    expect(response).toEqual({
      batchItemFailures: [],
    });

    unsScope.done();
  });

  it('Should log an error if uns api fails', async () => {
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

    const unsScope = nock('http://uns.api')
      .post('/v1/send-to-group', [
        {
          Namespace: 'travel',
          Group: 'spain',
          Subgroup: 'instant',
          NotificationTitle: 'Travel Advice - SPAIN',
          NotificationBody:
            "There's been a change in country you are interested in",
          MessageTitle: 'SPAIN Travel Advice',
          MessageBody: 'Storm warning',
        },
      ])
      .reply(400, {}, { content_type: 'application/json' });

    await expect(invoke([makeRecord()])).rejects.toThrow();

    expect(loggerErrorSpy).toHaveBeenCalledWith({
      compositeKey: 'travel/spain',
      eventTimestamp: '2026-08-10T09:14:22.031Z',
      message: 'Error from uns api',
      result: {
        error: {
          body: {},
          message: 'Bad Request',
          status: 400,
        },
        ok: false,
      },
      schedule: 'INSTANT',
    });

    unsScope.done();
  });

  it('Should handle secret failure', async () => {
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

    mockGetSecret.mockResolvedValue(undefined);

    await expect(invoke([makeRecord()])).rejects.toThrow();

    expect(loggerErrorSpy).toHaveBeenCalledWith({
      message: 'secret is empty or not a string: arn:uns-key',
      schedule: 'INSTANT',
    });
  });

  it('Should handle secret error', async () => {
    mockGetSecret.mockRejectedValue(new Error('Secret Error'));

    await expect(invoke([makeRecord()])).rejects.toThrow();

    expect(loggerErrorSpy).toHaveBeenCalledWith({
      message: 'Secret Error',
      schedule: 'INSTANT',
    });
  });
});
