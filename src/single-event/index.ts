import { DynamoEvent } from '@/types/event';
import { getNotificationPayload, getSmmSecret } from '@/utils';
import { updateEventStatus } from '@/utils/event';
import { getParameter, SsmParameters } from '@/utils/ssm-client';
import { createUnsMtlsClientFromSecrets } from '@/utils/uns-client';
import {
  BatchProcessor,
  EventType,
  processPartialResponse,
} from '@aws-lambda-powertools/batch';
import { Logger } from '@aws-lambda-powertools/logger';
import { AttributeValue } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { DynamoDBRecord, DynamoDBStreamHandler } from 'aws-lambda';

const processor = new BatchProcessor(EventType.DynamoDBStreams); // (1)!
const logger = new Logger();

const recordHandler = async (record: DynamoDBRecord): Promise<void> => {
  try {
    logger.info({
      message: `Request received`,
      record,
    });
    if (record.eventName == 'REMOVE') {
      logger.info({
        message: `Request ignored - we do not handle REMOVE calls`,
        record,
      });
      return;
    }
    if (record.dynamodb && record.dynamodb.NewImage) {
      const message = unmarshall(
        record.dynamodb.NewImage as Record<string, AttributeValue>,
      ) as DynamoEvent;

      const payload = getNotificationPayload(message, 'instant');

      if (payload) {
        logger.info({
          message: `Fetching SSM config`,
        });
        const [apiUrl, certSecretArn, keySecretArn] = await Promise.all([
          getParameter(SsmParameters.UnsApiUrl),
          getParameter(SsmParameters.UnsMtlsCertArn),
          getParameter(SsmParameters.UnsMtlsKeyArn),
        ]);

        logger.info({
          message: `Fetching secret`,
        });
        const apiKeySecretArn = process.env.UNS_API_KEY_ARN as string;
        const apiKey = await getSmmSecret(apiKeySecretArn);

        logger.info({
          message: `Building client`,
        });
        const uns = await createUnsMtlsClientFromSecrets({
          apiUrl,
          certSecretArn,
          keySecretArn,
          apiKey,
        });

        logger.info({
          message: `Sending request`,
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

        logger.info({
          message: `Updating progress`,
        });
        const tableName = process.env.EVENTS_STORE_TABLE_NAME;
        if (!tableName) {
          logger.error({
            message: `No table env`,
            eventTimestamp: message.eventTimestamp,
            compositeKey: message.compositeKey,
            schedule: 'INSTANT',
          });
          throw new Error('No table env passed');
        }

        await updateEventStatus(
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
        record,
        error,
      });
      throw error;
    }
  }
};

export const handler: DynamoDBStreamHandler = async (event, context) => {
  logger.info({
    message: `Batch processing initialisation`,
    event,
    context,
  });
  return processPartialResponse(event, recordHandler, processor, {
    context,
  });
};
