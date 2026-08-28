import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as events from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import { LambdaFactory } from '../cdk_constructs/LambdaFunctionFactory';
import {
  getEnvironment,
  getPullRequestNumber,
  getResourceNamePrefix,
  isEphemeralEnvironment,
  isPullRequestEnvironment,
} from '../constants/environments';
import {
  EventBridgeScheduleFactory,
  ScheduleFrequency,
} from '../cdk_constructs/EventBridgeScheduleFactory';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { ISecret, Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { AttributeType, ITable } from 'aws-cdk-lib/aws-dynamodb';
import {
  DynamoDbTableFactory,
  ITableWithStream,
} from '../cdk_constructs/DynamoTableFactory';
import { SqsQueueFactory } from '../cdk_constructs/SqsQueueFactory';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

interface IUnsConfig {
  certArn: ISecret;
  keyArn: ISecret;
  kmsKeyArn: string;
  apiKeySecret: ISecret;
}

export interface EventsAggregatorStackProps extends cdk.StackProps {
  serviceName: string;
  teamName: string;
  repositoryUrl: string;
  version: string;
  environment: string;
  costCenter: string;
}

const constants = {
  SOURCE_STORE_TABLE_NAME_VARIABLE: 'sourceStore',
  TABLE_NAME_VARIABLE: 'eventsStore',
};

export class EventsAggregatorStack extends cdk.Stack {
  public readonly sourceTable: ITable;
  public readonly eventStoreTable: ITableWithStream;
  public readonly sharedNamespace: string = `ea-runner`;

  private readonly dynamoFactory = new DynamoDbTableFactory(
    this,
    'DynamoTable',
  );

  private readonly sqsFactory = new SqsQueueFactory(this, 'SqsEvents');
  private readonly lambdaFactory = new LambdaFactory(this, 'EventsAggregator');

  constructor(scope: Construct, id: string, props: EventsAggregatorStackProps) {
    super(scope, id, props);

    const env = getEnvironment();
    const flexAccountId = process.env.FLEX_ACCOUNT_ID;
    const flexExternalId = process.env.FLEX_EXTERNAL_ID;

    if (!flexAccountId || !flexExternalId) {
      throw new Error('Flex Account id and external id not set');
    }

    const namePrefix = getResourceNamePrefix();
    const __dirname = dirname(fileURLToPath(import.meta.url));

    cdk.Tags.of(this).add('ServiceName', props.serviceName);
    cdk.Tags.of(this).add('TeamName', props.teamName);
    cdk.Tags.of(this).add('RepositoryUrl', props.repositoryUrl);
    cdk.Tags.of(this).add('Version', props.version);
    cdk.Tags.of(this).add('CostCenter', props.costCenter);
    cdk.Tags.of(this).add('Environment', props.environment);

    const pullRequestNumber = getPullRequestNumber();
    if (pullRequestNumber) {
      cdk.Tags.of(this).add('Ephemeral', 'true');
      cdk.Tags.of(this).add('PullRequest', pullRequestNumber);
    }

    const localNamespace = `ea-${env}`;
    const params = [
      `/${this.sharedNamespace}/uns-mtls-cert-arn`,
      `/${this.sharedNamespace}/uns-mtls-key-arn`,
      `/${this.sharedNamespace}/uns-kms-key-arn`,
    ];

    const [cert, key, kmsArn] = params.map((param: string) =>
      StringParameter.valueForStringParameter(this, param),
    );

    const certSecret = Secret.fromSecretCompleteArn(this, 'ClientCert', cert);

    const keySecret = Secret.fromSecretCompleteArn(this, 'ClientKey', key);

    const unsApiKeySecret = new Secret(this, 'UnsApiKeySecret', {
      secretName: `${localNamespace}/uns-api-key`,
      description: 'UNS API key',
      secretStringValue: cdk.SecretValue.unsafePlainText('PLACEHOLDER'),
      removalPolicy: isEphemeralEnvironment()
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });

    this.sourceTable = this.dynamoFactory.createTable('EventSourceTable', {
      name: constants.SOURCE_STORE_TABLE_NAME_VARIABLE,
      partitionKey: 'sourceID',
      sortKey: 'compositeKey',
      pointInTimeRecovery: false,
      globalSecondaryIndexes: [
        {
          indexName: 'composite-query',
          partitionKeyName: 'compositeKey',
          partitionKeyType: AttributeType.STRING,
          sortKeyName: 'lastUpdated',
          sortKeyType: AttributeType.STRING,
        },
      ],
      removalPolicy: isEphemeralEnvironment()
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });

    const incomingEventsQueue = this.sqsFactory.createQueueWithDeadLetter(
      'InEventsQueue',
      {
        name: 'incoming-events',
        fifo: true,
        contentBasedDeduplication: true,
        visibilityTimeout: cdk.Duration.seconds(60),
        maxReceiveCount: 3,
      },
    );

    const eventBridgeFactory = new EventBridgeScheduleFactory(
      this,
      'EBSchedule',
    );

    const logKey = new kms.Key(this, 'LogEncryptionKey', {
      alias: `${namePrefix}-log-key`,
      enableKeyRotation: true,
      removalPolicy: isEphemeralEnvironment()
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });

    logKey.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [
          new iam.ServicePrincipal(`logs.${this.region}.amazonaws.com`),
        ],
        actions: [
          'kms:Encrypt',
          'kms:Decrypt',
          'kms:ReEncrypt*',
          'kms:GenerateDataKey*',
          'kms:DescribeKey',
        ],
        resources: ['*'],
      }),
    );

    const travelDigestionLambda = this.lambdaFactory.createLambda(
      'TravelDigestionLambda',
      {
        code: lambda.Code.fromAsset(
          join(__dirname, '../../dist/travel-digestion'),
        ),
        description: 'Polls the content api and sends events to UNS',
        duration: 10,
        key: logKey,
        handler: 'index.handler',
        memorySize: 128,
        name: 'travel-digestion',
        environment: {
          SSM_PREFIX: this.sharedNamespace,
          UNS_API_KEY_ARN: unsApiKeySecret.secretArn,
          INCOMING_EVENTS_QUEUE_URL: incomingEventsQueue.queue.queueUrl,
          SOURCE_TABLE_NAME: this.sourceTable.tableName,
          POWERTOOLS_SERVICE_NAME: 'events-aggregator-travel-digestion',
          POWERTOOLS_METRICS_NAMESPACE: 'EventsAggregator',
        },
        retentionDays: logs.RetentionDays.ONE_WEEK,
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        skipCheckovRule: 'CKV_AWS_59',
      },
    );

    this.grantUnsAccess(travelDigestionLambda, {
      certArn: certSecret,
      keyArn: keySecret,
      apiKeySecret: unsApiKeySecret,
      kmsKeyArn: kmsArn,
    });

    this.sourceTable.grantReadWriteData(travelDigestionLambda);
    incomingEventsQueue.queue.grantSendMessages(travelDigestionLambda);
    incomingEventsQueue.deadLetterQueue.grantSendMessages(
      travelDigestionLambda,
    );

    const singleEventLambda = this.lambdaFactory.createLambda(
      'SingleEventLambda',
      {
        code: lambda.Code.fromAsset(join(__dirname, '../../dist/single-event')),
        description: 'sends a single event to UNS',
        duration: 10,
        key: logKey,
        handler: 'index.handler',
        memorySize: 128,
        name: 'single-event',
        environment: {
          SSM_PREFIX: this.sharedNamespace,
          UNS_API_KEY_ARN: unsApiKeySecret.secretArn,
          POWERTOOLS_SERVICE_NAME: 'events-aggregator-single-event',
          POWERTOOLS_METRICS_NAMESPACE: 'EventsAggregator',
        },
        retentionDays: logs.RetentionDays.ONE_WEEK,
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        skipCheckovRule: 'CKV_AWS_59',
      },
    );

    this.eventStoreTable = this.dynamoFactory.createTableWithStream(
      'EventStoreTable',
      {
        name: constants.TABLE_NAME_VARIABLE,
        partitionKey: 'eventID',
        sortKey: 'compositeKey',
        globalSecondaryIndexes: [
          {
            indexName: 'timestamp-query',
            partitionKeyName: 'compositeKey',
            partitionKeyType: AttributeType.STRING,
            sortKeyName: 'eventTimestamp',
            sortKeyType: AttributeType.STRING,
          },
          {
            indexName: 'namespace-timestamp-query',
            partitionKeyName: 'namespace',
            partitionKeyType: AttributeType.STRING,
            sortKeyName: 'eventTimestamp',
            sortKeyType: AttributeType.STRING,
          },
        ],
        pointInTimeRecovery: false,
        removalPolicy: isEphemeralEnvironment()
          ? cdk.RemovalPolicy.DESTROY
          : cdk.RemovalPolicy.RETAIN,
        streamConsumer: {
          streamFunction: singleEventLambda,
        },
      },
    );

    this.grantUnsAccess(singleEventLambda, {
      certArn: certSecret,
      keyArn: keySecret,
      apiKeySecret: unsApiKeySecret,
      kmsKeyArn: kmsArn,
    });

    const eventProcessingLambda = this.lambdaFactory.createLambda(
      'EventProcessing',
      {
        code: lambda.Code.fromAsset(
          join(__dirname, '../../dist/event-processing'),
        ),
        description: 'Processes the events from the SQS queue',
        duration: 10,
        key: logKey,
        handler: 'index.handler',
        memorySize: 128,
        name: 'eventProcessing',
        retentionDays: logs.RetentionDays.ONE_WEEK,
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        skipCheckovRule: 'CKV_AWS_59',
      },
    );

    this.grantTableAccess(eventProcessingLambda, 'write');
    eventProcessingLambda.addEventSource(
      new SqsEventSource(incomingEventsQueue.queue, {
        batchSize: 1,
        reportBatchItemFailures: true,
        maxConcurrency: 5,
      }),
    );

    const aggregatedEventLambda = this.lambdaFactory.createLambda(
      'AggregatedEventLambda',
      {
        code: lambda.Code.fromAsset(
          join(__dirname, '../../dist/aggregated-event'),
        ),
        description:
          'Create and send daily or weekly aggregated event digests to UNS',
        duration: 30,
        key: logKey,
        handler: 'index.handler',
        memorySize: 128,
        name: 'aggregated-event',
        environment: {
          SSM_PREFIX: this.sharedNamespace,
          UNS_API_KEY_ARN: unsApiKeySecret.secretArn,
          EVENT_STORE_TABLE_NAME: this.eventStoreTable.table.tableName,
          POWERTOOLS_SERVICE_NAME: 'events-aggregator-aggregated-event',
          POWERTOOLS_METRICS_NAMESPACE: 'EventsAggregator',
        },
        retentionDays: logs.RetentionDays.ONE_WEEK,
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        skipCheckovRule: 'CKV_AWS_59',
      },
    );

    this.grantUnsAccess(aggregatedEventLambda, {
      certArn: certSecret,
      keyArn: keySecret,
      apiKeySecret: unsApiKeySecret,
      kmsKeyArn: kmsArn,
    });

    aggregatedEventLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query', 'dynamodb:UpdateItem'],
        resources: [
          this.eventStoreTable.table.tableArn,
          `${this.eventStoreTable.table.tableArn}/index/namespace-timestamp-query`,
        ],
      }),
    );

    // EventBridge schedules — daily and weekly only
    (['daily', 'weekly'] as const).forEach((frequency) => {
      eventBridgeFactory.createScheduledRule(`${frequency}-digest-schedule`, {
        name: `${frequency.toUpperCase()}DigestSchedule`,
        targetFunction: aggregatedEventLambda,
        frequency,
        enabled: true,
        eventPayload: {
          triggeredAt: events.EventField.fromPath('$.time'),
          schedule: frequency,
        },
      });
    });

    (['hourly', 'daily', 'weekly'] as ScheduleFrequency[]).map(
      (frequency: ScheduleFrequency) => {
        eventBridgeFactory.createScheduledRule(`${frequency}-schedule`, {
          name: `${frequency.toUpperCase()}TravelSchedule`,
          targetFunction: travelDigestionLambda,
          frequency,
          enabled: true,
          eventPayload: {
            triggeredAt: events.EventField.fromPath('$.time'),
            schedule: frequency,
            source: events.EventField.fromPath('$.source'),
          },
        });
      },
    );

    const flexTravelReadRole = new iam.Role(this, 'FlexTravelReadRole', {
      roleName: `${namePrefix}-flex-travel-read`,
      description:
        'Assumed by the FLEX travel sercice gateway to read travel sources',
      assumedBy: new iam.AccountPrincipal(flexAccountId),
      externalIds: [flexExternalId],
      maxSessionDuration: cdk.Duration.hours(1),
    });

    this.sourceTable.grantReadData(flexTravelReadRole);
    this.eventStoreTable.table.grantReadData(flexTravelReadRole);

    const flexConfigKey = new kms.Key(this, 'FlexConfigEncryptionKey', {
      alias: `${namePrefix}-flex-config-key`,
      description: 'Encrypts the FLEX travel connection secret',
      enableKeyRotation: true,
      removalPolicy: isEphemeralEnvironment()
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });

    flexConfigKey.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.AccountPrincipal(flexAccountId)],
        actions: ['kms:Decrypt', 'kms:DescribeKey'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'kms:ViaService': `secretsmanager.${this.region}.amazon.com`,
          },
        },
      }),
    );

    const flexTravelConfigSecret = new Secret(this, 'FlexTravelConfigSecret', {
      ...(isPullRequestEnvironment()
        ? {}
        : { secretName: `${namePrefix}/flex-travel-config` }),
      description:
        'Connection details the FLEX account uses to read travel sources',
      encryptionKey: flexConfigKey,
      secretObjectValue: {
        externalId: cdk.SecretValue.unsafePlainText(flexExternalId),
        region: cdk.SecretValue.unsafePlainText(this.region),
        roleArn: cdk.SecretValue.unsafePlainText(flexTravelReadRole.roleArn),
        sourcesTableName: cdk.SecretValue.unsafePlainText(
          this.sourceTable.tableName,
        ),
        eventStoreTableName: cdk.SecretValue.unsafePlainText(
          this.eventStoreTable.table.tableName,
        ),
      },
      removalPolicy: isEphemeralEnvironment()
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });

    flexTravelConfigSecret.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.AccountPrincipal(flexAccountId)],
        actions: [
          'secretsmanager:GetSecretValue',
          'secretsmanager:DescribeSecret',
        ],
        resources: ['*'],
      }),
    );

    new cdk.CfnOutput(this, 'FlexTravelConfigSecretArn', {
      value: flexTravelConfigSecret.secretArn,
      description: 'Secret the FLEX account reads to connect to this account',
    });

    new cdk.CfnOutput(this, 'FlexTravelReadRoleArn', {
      value: flexTravelReadRole.roleArn,
    });
  }

  private grantUnsAccess(fn: lambda.Function, uns: IUnsConfig): void {
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParametersByPath'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${this.sharedNamespace}/*`,
        ],
      }),
    );

    fn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'secretsmanager:DescribeSecret',
          'secretsmanager:GetSecretValue',
        ],
        resources: [uns.certArn.secretArn, uns.keyArn.secretArn],
      }),
    );

    fn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['kms:Decrypt'],
        resources: [uns.kmsKeyArn],
      }),
    );

    uns.certArn.grantRead(fn);
    uns.keyArn.grantRead(fn);
    uns.apiKeySecret.grantRead(fn);
  }

  private grantTableAccess(
    fn: lambda.Function,
    access: 'read' | 'write',
  ): void {
    if (access === 'write') this.eventStoreTable.table.grantWriteData(fn);
    else this.eventStoreTable.table.grantReadData(fn);

    this.lambdaFactory.addEnvironmentVariable(fn, {
      name: 'TABLE_NAME',
      value: this.eventStoreTable.table.tableName,
    });
  }
}
