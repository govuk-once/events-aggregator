import { Source } from '@/types/source';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchGetCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: 'eu-west-2' });
const documentClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

export const getEventSourceByCompositeKeys = async (
  keys: string[],
  tableName: string,
): Promise<Source[]> => {
  const request = {
    Keys: keys.map((key) => ({
      compositeKey: key,
    })),
    ConsistentRead: true,
  };

  const result = await documentClient.send(
    new BatchGetCommand({ RequestItems: { [tableName]: request } }),
  );

  const sources = [];
  for (const item of result.Responses?.[tableName] ?? []) {
    const source = item as Source;
    sources.push(source);
  }

  return sources;
};
