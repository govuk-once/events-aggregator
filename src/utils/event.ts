import { DynamoEvent, IncomingEvent } from '@/types/event';

export const buildDynamoEventItem = (message: IncomingEvent): DynamoEvent => {
  return {
    eventID: message.eventID,
    compositeKey: `${message.namespace}/${message.group}`,
    eventTimestamp: message.eventTimestamp,
    namespace: message.namespace,
    group: message.group,
    eventNote: message.eventNote,
    processingStatus: {
      INSTANT: undefined,
      DAILY: undefined,
      WEEKLY: undefined,
    },
  };
};
