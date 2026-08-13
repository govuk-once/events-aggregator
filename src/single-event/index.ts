import { Logger } from '@aws-lambda-powertools/logger';
import { DynamoDBRecord, DynamoDBStreamHandler } from 'aws-lambda';
import {
  BatchProcessor,
  EventType,
  processPartialResponse,
} from '@aws-lambda-powertools/batch';
import { getParameter, SsmParameters } from '@/utils/ssm-client';
import { getNotificationPayload, getSmmSecret } from '@/utils';
import { createUnsMtlsClientFromSecrets } from '@/utils/uns-client';
import { DynamoEvent } from '@/types/event';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { AttributeValue } from '@aws-sdk/client-dynamodb';
import { updateEventStatus } from '@/utils/event';

const processor = new BatchProcessor(EventType.DynamoDBStreams); // (1)!
const logger = new Logger();

const recordHandler = async (record: DynamoDBRecord): Promise<void> => {
  try {
    if (record.dynamodb && record.dynamodb.NewImage) {
      const message = unmarshall(
        record.dynamodb.NewImage as Record<string, AttributeValue>,
      ) as DynamoEvent;

      const payload = getNotificationPayload(message, 'instant');

      if (payload) {
        const [apiUrl, certSecretArn, keySecretArn] = await Promise.all([
          getParameter(SsmParameters.UnsApiUrl),
          getParameter(SsmParameters.UnsMtlsCertArn),
          getParameter(SsmParameters.UnsMtlsKeyArn),
        ]);

        const apiKeySecretArn = process.env.UNS_API_KEY_ARN as string;
        const apiKey = await getSmmSecret(apiKeySecretArn);

        const uns = await createUnsMtlsClientFromSecrets({
          apiUrl,
          certSecretArn,
          keySecretArn,
          apiKey,
        });
        const result = await uns.notification.sendToSubscribers([payload]);
        if (!result.ok) {
          logger.error({
            message: `Error from uns api`,
            result: result,
            eventTimestamp: message.eventTimestamp,
            compositeKey: message.compositeKey,
            schedule: 'INSTANT',
          });
          throw new Error('UNS error');
        }

        const tableName = process.env.EVENTS_TABLE_NAME;
        if (!tableName) {
          logger.error({
            message: `No table env`,
            eventTimestamp: message.eventTimestamp,
            compositeKey: message.compositeKey,
            schedule: 'INSTANT',
          });
          throw new Error('No table env passed');
        }

        updateEventStatus(
          tableName,
          {
            eventID: message.eventID,
            compositeKey: message.compositeKey,
          },
          { instant: message.eventTimestamp },
        );
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      logger.error({
        message: error.message,
        schedule: 'INSTANT',
      });
      throw error;
    }
  }
};

export const handler: DynamoDBStreamHandler = async (event, context) =>
  processPartialResponse(event, recordHandler, processor, {
    context,
  });
