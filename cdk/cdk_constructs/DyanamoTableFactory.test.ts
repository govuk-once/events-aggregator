import { App, Stack } from 'aws-cdk-lib';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as dynamoDB from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import { describe, test, expect } from 'vitest';

import { DynamoTableFactory } from './DynamoTableFactory';
import { NullNamingProvider } from './namingProviders/NullNamingProvider';

describe('DynamoTableFactory', () => {
  const env = (process.env.ENVIRONMENT ?? process.env.USER ?? 'unkown').replace(
    /[^a-zA-Z0-9-]/g,
    '',
  );
  const serviceName = 'databaseservice';

  test('creates a S3 distrubution using service naming provider', () => {
    const app = new App();
    const stack = new Stack(app, 'testCloudfront');

    const factory = new DynamoTableFactory(stack, serviceName);

    factory.createTable('petShop', {
      tableName: 'petStore',
      partitionKey: { name: 'pk', type: dynamoDB.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamoDB.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const template = Template.fromStack(stack);

    //the environment is set
    expect(JSON.stringify(template).includes(env)).toBe(true);

    //the service is set
    expect(JSON.stringify(template).includes(serviceName)).toBe(true);

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: `${env}-${serviceName}-petStore`,

      KeySchema: Match.arrayWith([
        Match.objectLike({ AttributeName: 'pk', KeyType: 'HASH' }),
        Match.objectLike({ AttributeName: 'sk', KeyType: 'RANGE' }),
      ]),

      TimeToLiveSpecification: {
        AttributeName: 'TTL',
        Enabled: true,
      },

      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true,
      },

      SSESpecification: {
        SSEEnabled: true,
        SSEType: 'KMS',
        KMSMasterKeyId: Match.anyValue(),
      },
    });
  });

  test('creates a S3 distrubution using overriding naming provider', () => {
    const app = new App();
    const stack = new Stack(app, 'testCloudfront');

    const factory = new DynamoTableFactory(
      stack,
      serviceName,
      new NullNamingProvider(),
    );

    factory.createTable('petShop', {
      tableName: 'petStore',
      partitionKey: { name: 'pk', type: dynamoDB.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamoDB.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const template = Template.fromStack(stack);

    //the environment is set
    expect(JSON.stringify(template)).not.toContain(env);

    //the service is set
    expect(JSON.stringify(template)).not.toContain(serviceName);
  });

  test('creates a table with defaults: TTL = "TTL", Customer managed encryption with new key', () => {
    const app = new App();
    const stack = new Stack(app, 'TestDynamoStack');

    const factory = new DynamoTableFactory(stack, serviceName);

    factory.createTable('petShop', {
      tableName: 'petStore',
      partitionKey: { name: 'pk', type: dynamoDB.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamoDB.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::KMS::Key', 1);
    template.resourceCountIs('AWS::DynamoDB::Table', 1);

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: `${env}-${serviceName}-petStore`,

      KeySchema: Match.arrayWith([
        Match.objectLike({ AttributeName: 'pk', KeyType: 'HASH' }),
        Match.objectLike({ AttributeName: 'sk', KeyType: 'RANGE' }),
      ]),

      TimeToLiveSpecification: {
        AttributeName: 'TTL',
        Enabled: true,
      },

      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true,
      },

      SSESpecification: {
        SSEEnabled: true,
        SSEType: 'KMS',
        KMSMasterKeyId: Match.anyValue(),
      },
    });
  });

  test('creates a table and used provided key', () => {
    const app = new App();
    const stack = new Stack(app, 'TestDynamoStack');

    const encryptionKey = new kms.Key(stack, 'providedKey', {
      enableKeyRotation: true,
    });

    const factory = new DynamoTableFactory(stack, serviceName);

    factory.createTable('petShop', {
      tableName: 'petStore',
      partitionKey: { name: 'pk', type: dynamoDB.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamoDB.AttributeType.STRING },
      key: encryptionKey,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::KMS::Key', 1);
    template.resourceCountIs('AWS::DynamoDB::Table', 1);

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: `${env}-${serviceName}-petStore`,

      SSESpecification: {
        SSEEnabled: true,
        SSEType: 'KMS',
        KMSMasterKeyId: Match.anyValue(),
      },
    });
  });

  test('creates a table and overrides steams and point in time recovery', () => {
    const app = new App();
    const stack = new Stack(app, 'TestDynamoStack');

    const factory = new DynamoTableFactory(stack, serviceName);

    factory.createTable('petShop', {
      tableName: 'petStore',
      partitionKey: { name: 'pk', type: dynamoDB.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamoDB.AttributeType.STRING },
      stream: dynamoDB.StreamViewType.NEW_AND_OLD_IMAGES,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: false,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::DynamoDB::Table', 1);

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: `${env}-${serviceName}-petStore`,

      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: false,
      },

      StreamSpecification: {
        StreamViewType: 'NEW_AND_OLD_IMAGES',
      },
    });
  });

  test('creates a table and overrides TTL', () => {
    const app = new App();
    const stack = new Stack(app, 'TestDynamoStack');

    const factory = new DynamoTableFactory(stack, serviceName);

    factory.createTable('petShop', {
      tableName: 'petStore',
      partitionKey: { name: 'pk', type: dynamoDB.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamoDB.AttributeType.STRING },
      timeToLiveAttribute: 'look at fred',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::DynamoDB::Table', 1);

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: `${env}-${serviceName}-petStore`,

      TimeToLiveSpecification: {
        AttributeName: 'look at fred',
        Enabled: true,
      },
    });
  });
});
