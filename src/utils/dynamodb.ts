import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';

import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: 'eu-west-2' }),
  { marshallOptions: { removeUndefinedValues: true } },
);

export const getSourceIDFromCounty = (country: string) => {
  return 'string';
};

export const getSourceCountry = async (sourceId: string, tableName: string) => {
  try {
    const command = new GetItemCommand({
      TableName: tableName,
      Key: {
        sourceID: { S: sourceId },
      },
    });
    const response = await client.send(command);

    if (!response.Item) {
      return null;
    }

    return response.Item;
  } catch (error) {
    console.log(error);
  }
};

export const updateCountryTimestamp = async (
  sourceId: string,
  timestamp: string,
  tableName: string,
) => {
  try {
    const command = new UpdateItemCommand({
      TableName: tableName,
      Key: {
        sourceID: { S: sourceId },
      },
      UpdateExpression: 'SET #lastUpdated = :lastUpdated',
      ExpressionAttributeNames: {
        lastUpdated: 'Last Updated',
      },
      ExpressionAttributeValues: {
        ':lastUpdated': { S: timestamp },
      },
    });
    const response = await client.send(command);

    if (!response.Attributes) {
      return null;
    }

    return response.Attributes;
  } catch (error) {
    console.log(error);
    return;
  }
};

export const toEventStore = () => {
  return {
    eventID: 'sdlfsdlfsdlk3u3i4u39', // Partition Key //MD5 Hash of Event Note+Timestamp
    namespace: 'travel',
    group: 'spain',
    compositeKey: '{{namespace}}+{{group}}', // SK
    eventTimestamp: '2025-06-04T14:08:25Z',
    eventNote:
      'Temperatures may rise above 30 degrees, take appropriate precautions when travelling',
    deeplink: 'https://url',
    notificationStatus: {
      daily_status: 'true',
      weekly_status: 'false',
    },
  };
};
