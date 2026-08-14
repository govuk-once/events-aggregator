import { DynamoEvent, IncomingEvent } from '@/types/event';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const documentClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

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

export const CADENCES = ['instant', 'daily', 'weekly'] as const;
export type Cadence = (typeof CADENCES)[number];

/** When each cadence processed the event. A missing key means "not yet". */
export type EventStatus = Partial<Record<Cadence, string>>;

export interface EventKey {
  eventID: string;
  compositeKey: string;
}

/** The map attribute holding the timestamps. */
const STATUS_ATTRIBUTE = 'processingStatus';

export interface UpdateStatusOptions {
  /** Replace a timestamp that is already set. Default: keep the first one. */
  overwrite?: boolean;
}

export async function updateEventStatus(
  tableName: string,
  key: EventKey,
  timestamps: EventStatus,
  { overwrite = false }: UpdateStatusOptions = {},
): Promise<EventStatus> {
  const entries = Object.entries(timestamps).filter(
    (entry): entry is [Cadence, string] =>
      typeof entry[1] === 'string' && entry[1].trim() !== '',
  );

  if (entries.length === 0) {
    throw new Error('No timestamps supplied');
  }

  const unknown = entries
    .map(([cadence]) => cadence)
    .filter((cadence) => !CADENCES.includes(cadence));

  if (unknown.length > 0) {
    throw new Error(`Unknown cadence(s): ${unknown.join(', ')}`);
  }

  const names: Record<string, string> = {
    '#eventID': 'eventID',
    '#status': STATUS_ATTRIBUTE,
  };
  const values: Record<string, string> = {};

  const assignments = entries.map(([cadence, at], index) => {
    const name = `#c${index}`;
    const value = `:t${index}`;
    names[name] = cadence;
    values[value] = at;

    return overwrite
      ? `#status.${name} = ${value}`
      : `#status.${name} = if_not_exists(#status.${name}, ${value})`;
  });

  try {
    const { Attributes } = await documentClient.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { eventID: key.eventID, compositeKey: key.compositeKey },
        UpdateExpression: `SET ${assignments.join(', ')}`,
        ConditionExpression: 'attribute_exists(#eventID)',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );

    return (Attributes?.[STATUS_ATTRIBUTE] as EventStatus) ?? {};
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === 'ConditionalCheckFailedException'
    ) {
      throw new Error(
        `No event ${key.eventID} / ${key.compositeKey} to update`,
        { cause: error },
      );
    }
    throw error;
  }
}
