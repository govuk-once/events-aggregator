import { ChangeHistory, CountryDetails } from '@/types';
import { IncomingEvent } from '@/types/event';
import {
  SQSClient,
  SendMessageCommand,
  type SendMessageCommandOutput,
} from '@aws-sdk/client-sqs';
import { Logger } from '@aws-lambda-powertools/logger';
import { v4 as uuidv4 } from 'uuid';

const logger = new Logger();
const sqs = new SQSClient({ region: 'eu-west-2' });

export const travelEventToIncomingEvent = (
  history: ChangeHistory,
  details: CountryDetails,
): IncomingEvent => {
  const eventID = uuidv4();
  return {
    eventID,
    eventTimestamp: history.public_timestamp,
    // Group details
    namespace: 'travel',
    group: details.country.slug,
    // Event details - in the future if other services are integrated into the event aggregator, each row here could have it's own custom set of properties
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
      MessageBody: JSON.stringify(event), // Events are typically sent as JSON strings
      MessageGroupId: '1',
    };

    const command = new SendMessageCommand(params);
    const response = await sqs.send(command);

    logger.info('Successfully sent event, Message ID:', {
      MessageId: response.MessageId,
    });
    return response;
  } catch (error) {
    logger.error('Error sending event to SQS:', { error });
    throw new Error('Error sending event to SQS');
  }
};
