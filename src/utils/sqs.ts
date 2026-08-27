import { ChangeHistory, CountryDetails } from '@/types';
import { IncomingEvent } from '@/types/event';
import {
  SQSClient,
  SendMessageCommand,
  type SendMessageCommandOutput,
} from '@aws-sdk/client-sqs';
import { Logger } from '@aws-lambda-powertools/logger';
import { createHash } from 'node:crypto';

const logger = new Logger();
const sqs = new SQSClient({ region: 'eu-west-2' });

export const travelEventToIncomingEvent = (
  history: ChangeHistory,
  details: CountryDetails,
): IncomingEvent => {
  const namespace = 'travel';
  const group = details.country.slug;

  const eventID = createHash('sha256')
    .update(
      [namespace, group, history.public_timestamp, history.note].join('|'),
    )
    .digest('hex');

  return {
    eventID,
    eventTimestamp: history.public_timestamp,
    namespace,
    group,
    eventNote: history.note,
  };
};

export const sendIncomingEventToQueue = async (
  event: IncomingEvent,
  queueUrl: string,
): Promise<SendMessageCommandOutput> => {
  try {
    const params = {
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(event),
      MessageGroupId: `${event.namespace}/${event.group}`,
    };

    const command = new SendMessageCommand(params);
    const response = await sqs.send(command);

    logger.info('Successfully sent event, Message ID:', {
      MessageId: response.MessageId,
    });
    return response;
  } catch (error) {
    logger.error('Error sending event to SQS:', { error });
    throw new Error('Error sending event to SQS', { cause: error });
  }
};
