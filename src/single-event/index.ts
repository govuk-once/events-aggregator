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

const processor = new BatchProcessor(EventType.DynamoDBStreams); // (1)!
const logger = new Logger();

const recordHandler = async (record: DynamoDBRecord): Promise<void> => {
  if (record.dynamodb && record.dynamodb.NewImage) {
    logger.info('Processing record', { record: record.dynamodb.NewImage });
    const message = record.dynamodb.NewImage;
    const payload = getNotificationPayload(
      message as unknown as DynamoEvent,
      'instant',
    );
    if (payload) {
      // temp commented out copied from the original solution this will prob be part of this solution
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
          schedule: message.schedule,
        });
        throw new Error('UNS error');
      }
    }

    return;
  }
};

export const handler: DynamoDBStreamHandler = async (event, context) =>
  processPartialResponse(event, recordHandler, processor, {
    context,
  });
