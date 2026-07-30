import { Logger } from '@aws-lambda-powertools/logger';
import { SQSEvent } from 'aws-lambda';

const logger = new Logger();

export const handler = (event: SQSEvent) => {
  logger.info('event-processing', { event });
  return '';
};
