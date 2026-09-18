import { buildDynamoEventItem } from '@/utils/event';
import {
  BatchProcessor,
  EventType,
  processPartialResponse,
} from '@aws-lambda-powertools/batch';
import { Logger } from '@aws-lambda-powertools/logger';
import { AttributeValue, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SQSHandler, SQSRecord } from 'aws-lambda';

const client = new DynamoDBClient({});
const documentClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const processor = new BatchProcessor(EventType.SQS);
const logger = new Logger({
  serviceName: 'event-processing',
});

const getTableName = (): string => {
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    throw new Error('Table Name not set');
  }
  return tableName;
};

const isConditionalCheckFailed = (error: unknown): boolean =>
  error instanceof Error && error.name === 'ConditionalCheckFailedException';

export const parseSqsMessage = (record: SQSRecord) => {
  try {
    const payload = record.body;
    const item = JSON.parse(payload);

    return item;
  } catch (error) {
    logger.error('Unable to parse the SQS payload', { error });
    throw new Error('Unable to parse the SQS payload');
  }
};

const recordHandler = async (record: SQSRecord): Promise<void> => {
  logger.info({
    message: `Request received`,
    record,
  });

  const item = parseSqsMessage(record);

  try {
    if (item) {
      const dynamoEvent = buildDynamoEventItem(item);
      await documentClient.send(
        new PutCommand({
          TableName: getTableName(),
          Item: dynamoEvent as unknown as Record<string, AttributeValue>,
          ConditionExpression: 'attribute_not_exists(#eventID)',
          ExpressionAttributeNames: { '#eventID': 'eventID' },
        }),
      );

      logger.info('Stored Event', {
        eventId: item.eventID,
        compositeKey: item.compositeKey,
      });
    }
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      logger.info('event already saved, skipping', {
        eventId: item.eventID,
        compositeKey: item.compositeKey,
      });
      return;
    }

    logger.error('Failed to store the event', {
      eventId: item.eventID,
      compositeKey: item.compositeKey,
      error,
    });

    throw error;
  }
};

export const handler: SQSHandler = async (event, context) =>
  processPartialResponse(event, recordHandler, processor, {
    context,
  });
