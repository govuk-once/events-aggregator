/* eslint-disable @typescript-eslint/no-explicit-any */

import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import type {
  Context,
  SQSBatchResponse,
  SQSEvent,
  SQSRecord,
} from 'aws-lambda';
import { handler } from './';
import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';
import { IncomingEvent } from '@/types/event';

// Powertools' Logger writes through its own console instance, so spying on
// `console` does not silence it. Mute it by level, before the module loads.
vi.hoisted(() => {
  process.env.POWERTOOLS_LOG_LEVEL = 'SILENT';
});

const dynamoMock = mockClient(DynamoDBDocumentClient);

const getCommandCall = (command: any, callNumber: number) =>
  dynamoMock.commandCalls(command)[callNumber - 1]?.args[0].input;

const TABLE = 'test-travel-events';

const message: IncomingEvent = {
  eventID: 'evt-123',
  eventTimestamp: '2026-08-07T09:14:22.031Z',
  namespace: 'travel',
  group: 'myanmar',
  eventNote: 'Storm warning issued',
};

const makeRecord = (body: unknown, messageId = 'msg-1'): SQSRecord => ({
  messageId,
  receiptHandle: 'receipt',
  body: typeof body === 'string' ? body : JSON.stringify(body),
  attributes: {
    ApproximateReceiveCount: '1',
    SentTimestamp: '1754557000000',
    SenderId: 'sender',
    ApproximateFirstReceiveTimestamp: '1754557000000',
  },
  messageAttributes: {},
  md5OfBody: 'md5',
  eventSource: 'aws:sqs',
  eventSourceARN: 'arn:aws:sqs:eu-west-2:111122223333:travel-events',
  awsRegion: 'eu-west-2',
});

const context = { awsRequestId: 'req-1' } as Context;

const invoke = async (records: SQSRecord[]): Promise<SQSBatchResponse> => {
  const event: SQSEvent = { Records: records };
  // SQSHandler is declared as `void | SQSBatchResponse`; this handler always
  // returns the response.
  return (await handler(
    event,
    context,
    (() => undefined) as any,
  )) as SQSBatchResponse;
};

describe('travel events handler', () => {
  beforeEach(() => {
    dynamoMock.reset();
    process.env.TABLE_NAME = TABLE;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TABLE_NAME;
  });

  describe('handler', () => {
    it('stores a record and reports no failures', async () => {
      dynamoMock.on(PutCommand).resolves({});

      const response = await invoke([makeRecord(message)]);

      expect(response).toEqual({ batchItemFailures: [] });

      expect(getCommandCall(PutCommand, 1)).toMatchObject({
        TableName: TABLE,
        Item: {
          eventID: 'evt-123',
          compositeKey: 'travel/myanmar',
          eventNote: 'Storm warning issued',
          processingStatus: {
            INSTANT: undefined,
            DAILY: undefined,
            WEEKLY: undefined,
          },
        },
      });
    });

    it('writes insert-only so a redelivery cannot reset processingStatus', async () => {
      dynamoMock.on(PutCommand).resolves({});

      await invoke([makeRecord(message)]);

      expect(getCommandCall(PutCommand, 1)).toMatchObject({
        ConditionExpression: 'attribute_not_exists(#eventID)',
        ExpressionAttributeNames: { '#eventID': 'eventID' },
      });
    });

    it('treats an already-stored event as a success', async () => {
      const conflict = new Error('exists');
      conflict.name = 'ConditionalCheckFailedException';
      dynamoMock.on(PutCommand).rejects(conflict);

      const response = await invoke([makeRecord(message)]);

      expect(response).toEqual({ batchItemFailures: [] });
    });

    it('fails only the bad record in a mixed batch', async () => {
      dynamoMock.on(PutCommand).resolves({});

      const response = await invoke([
        makeRecord(message, 'good-1'),
        makeRecord('not json', 'bad-1'),
        makeRecord({ ...message, eventID: 'evt-456' }, 'good-2'),
      ]);

      expect(response).toEqual({
        batchItemFailures: [{ itemIdentifier: 'bad-1' }],
      });
      // The healthy records were still written.
      expect(dynamoMock.commandCalls(PutCommand)).toHaveLength(2);
    });

    it('reports a DynamoDB failure as a batch item failure', async () => {
      dynamoMock
        .on(PutCommand)
        .resolvesOnce({})
        .rejectsOnce(new Error('ProvisionedThroughputExceededException'));

      const response = await invoke([
        makeRecord(message, 'good-1'),
        makeRecord({ ...message, eventID: 'evt-456' }, 'bad-1'),
      ]);

      expect(response).toEqual({
        batchItemFailures: [{ itemIdentifier: 'bad-1' }],
      });
    });

    it('throws when every record fails so the whole batch is retried', async () => {
      dynamoMock.on(PutCommand).rejects(new Error('boom'));

      await expect(invoke([makeRecord(message)])).rejects.toThrow();
    });

    it('does not call DynamoDB when TABLE_NAME is unset', async () => {
      delete process.env.TABLE_NAME;
      dynamoMock.on(PutCommand).resolves({});

      await expect(invoke([makeRecord(message)])).rejects.toThrow();

      expect(dynamoMock.commandCalls(PutCommand)).toHaveLength(0);
    });
  });
});
