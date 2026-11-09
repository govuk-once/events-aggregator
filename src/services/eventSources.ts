import { Source } from '@/types/source';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: 'eu-west-2' });
const documentClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

const COMPOSITE_INDEX = 'composite-query';

const getEventSourceByCompositeKey = async (
  compositeKey: string,
  tableName: string,
): Promise<Source[]> => {
  const result = await documentClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: COMPOSITE_INDEX,
      KeyConditionExpression: '#compositeKey = :compositeKey',
      ExpressionAttributeNames: { '#compositeKey': 'compositeKey' },
      ExpressionAttributeValues: { ':compositeKey': compositeKey },
    }),
  );

  return (result.Items ?? []) as Source[];
};

export const updateSourceLastUpdated = async (
  source: Pick<Source, 'sourceID' | 'compositeKey'>,
  tableName: string,
  lastUpdated: string,
): Promise<void> => {
  await documentClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { sourceID: source.sourceID, compositeKey: source.compositeKey },
      UpdateExpression: 'SET #lastUpdated = :lastUpdated',
      ExpressionAttributeNames: { '#lastUpdated': 'lastUpdated' },
      ExpressionAttributeValues: { ':lastUpdated': lastUpdated },
    }),
  );
};

export const getEventSourceByCompositeKeys = async (
  keys: string[],
  tableName: string,
): Promise<Source[]> => {
  const results = await Promise.all(
    [...new Set(keys)].map((key) =>
      getEventSourceByCompositeKey(key, tableName),
    ),
  );

  return results.flat();
};
