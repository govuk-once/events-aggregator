/* eslint-disable @typescript-eslint/no-explicit-any */

import { Logger } from '@aws-lambda-powertools/logger';
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  Context,
  DynamoDBBatchResponse,
  DynamoDBRecord,
  DynamoDBStreamEvent,
} from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import nock from 'nock';
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

const dynamodbClient = mockClient(DynamoDBDocumentClient);

vi.stubEnv('UNS_API_URL', 'http://uns.api');
vi.stubEnv('UNS_API_KEY_ARN', 'arn:uns-key');
vi.stubEnv('SSM_PREFIX', 'prefix');
vi.stubEnv('EVENTS_STORE_TABLE_NAME', 'event-table');
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

const mockParams = {
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
};

const context = { awsRequestId: 'req-1' } as Context;

const newImage = (compositeKey = 'travel/spain') => ({
  eventID: { S: 'evt-1' },
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

const mockRequestPayload = [
  {
    Namespace: 'travel',
    Group: 'spain',
    Subgroup: 'instant',
    NotificationTitle: 'Spain: Travel advice alert',
    NotificationBody: "There's been a change in country you are interested in",
    MessageTitle: 'Spain: Travel advice alert',
    MessageBody:
      '[Go to latest](govuk://app.gov.uk/web?url=https://www.gov.uk/foreign-travel-advice/spain)\n' +
      '\n' +
      'Changes made:\n' +
      'Storm warning\n' +
      '\n' +
      'Time updated:\n' +
      '10:14am, 10th August 2026 (BST)\n' +
      '\n' +
      '[Manage your countries](govuk://app.gov.uk/travelalerts/edit)',
    DeeplinkURL: `govuk://app.gov.uk/web?url=https://www.gov.uk/foreign-travel-advice/spain`,
    Channel: 'PUSH_NOTIFICATION_AND_MESSAGE_CENTRE',
  },
  {
    Namespace: 'travel',
    Group: 'spain',
    Subgroup: 'instant',
    NotificationTitle: 'Spain: Travel advice alert',
    NotificationBody: "There's been a change in country you are interested in",
    MessageTitle: 'Spain: Travel advice alert',
    MessageBody:
      '[Go to latest](govuk://app.gov.uk/web?url=https://www.gov.uk/foreign-travel-advice/spain)\n' +
      '\n' +
      'Changes made:\n' +
      'Storm warning\n' +
      '\n' +
      'Time updated:\n' +
      '10:14am, 10th August 2026 (BST)\n' +
      '\n' +
      '[Manage your countries](govuk://app.gov.uk/travelalerts/edit)',
    DeeplinkURL: `govuk://app.gov.uk/web?url=https://www.gov.uk/foreign-travel-advice/spain`,
    Channel: 'MESSAGE_CENTRE_ONLY',
  },
];

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
    dynamodbClient.reset();
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

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'SSM Error',
        schedule: 'INSTANT',
      }),
    );
  });

  it('Should handle undefined parameters', async () => {
    sendMock.mockResolvedValueOnce({
      Parameters: [],
    });
    mockGetSecret.mockResolvedValue('-----BEGIN');

    await expect(invoke([makeRecord()])).rejects.toThrow();

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'SSM parameter not found: /prefix/uns-api-url',
        schedule: 'INSTANT',
      }),
    );
  });

  it('Should send a single event to uns', async () => {
    sendMock.mockResolvedValueOnce(mockParams);

    mockGetSecret.mockResolvedValue('-----BEGIN');

    dynamodbClient.on(UpdateCommand).resolvesOnce({
      Attributes: { processingStatus: { instant: '2016-09-09T10:00:00Z' } },
    });

    const unsScope = nock('http://uns.api')
      .post('/v1/send-to-group', mockRequestPayload)
      .reply(200, {}, { content_type: 'application/json' });

    const response = await invoke([makeRecord()]);

    expect(response).toEqual({
      batchItemFailures: [],
    });
    const updates = dynamodbClient.commandCalls(UpdateCommand);
    expect(updates).toHaveLength(1);
    expect(updates[0].args[0].input).toMatchObject({
      TableName: 'event-table',
      Key: { eventID: 'evt-1', compositeKey: 'travel/spain' },
    });

    unsScope.done();
  });

  it('Should log an error if uns api fails', async () => {
    sendMock.mockResolvedValueOnce(mockParams);

    mockGetSecret.mockResolvedValue('-----BEGIN');

    const unsScope = nock('http://uns.api')
      .post('/v1/send-to-group', mockRequestPayload)
      .reply(400, {}, { content_type: 'application/json' });

    await expect(invoke([makeRecord()])).rejects.toThrow();

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
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
      }),
    );

    unsScope.done();
  });

  it('Should handle secret failure', async () => {
    sendMock.mockResolvedValueOnce(mockParams);

    mockGetSecret.mockResolvedValue(undefined);

    await expect(invoke([makeRecord()])).rejects.toThrow();

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'secret is empty or not a string: arn:uns-key',
        schedule: 'INSTANT',
      }),
    );
  });

  it('Should handle secret error', async () => {
    mockGetSecret.mockRejectedValue(new Error('Secret Error'));

    await expect(invoke([makeRecord()])).rejects.toThrow();

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Secret Error',
        schedule: 'INSTANT',
      }),
    );
  });

  it('Should fail if tableName environment not set', async () => {
    vi.stubEnv('EVENTS_STORE_TABLE_NAME', undefined);

    mockGetSecret.mockResolvedValue('-----BEGIN');

    dynamodbClient.on(UpdateCommand).resolvesOnce({
      Attributes: { processingStatus: { instant: '2016-09-09T10:00:00Z' } },
    });

    const unsScope = nock('http://uns.api')
      .post('/v1/send-to-group', mockRequestPayload)
      .reply(200, {}, { content_type: 'application/json' });

    await expect(invoke([makeRecord()])).rejects.toThrow();

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'No table env passed',
        schedule: 'INSTANT',
      }),
    );

    unsScope.done();
  });

  it('Should fail the record if the status update fails', async () => {
    vi.stubEnv('EVENTS_STORE_TABLE_NAME', 'events-table');

    sendMock.mockResolvedValueOnce(mockParams);
    mockGetSecret.mockResolvedValue('-----BEGIN');

    const err = new Error('Conditional check failed');
    err.name = 'ConditionalCheckFailedException';
    dynamodbClient.on(UpdateCommand).rejectsOnce(err);

    const unsScope = nock('http://uns.api')
      .post('/v1/send-to-group')
      .reply(200, {}, { content_type: 'application/json' });

    await expect(invoke([makeRecord()])).rejects.toThrow();

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'No event evt-1 / travel/spain to update',
        schedule: 'INSTANT',
      }),
    );

    unsScope.done();
  });
});
