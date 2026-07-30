import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as events from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import { LambdaFactory } from '../cdk_constructs/LambdaFunctionFactory';
import {
  getEnvironment,
  getResourceNamePrefix,
  isEphemeralEnvironment,
} from '../constants/environments';
import {
  EventBridgeScheduleFactory,
  ScheduleFrequency,
} from '../cdk_constructs/EventBridgeScheduleFactory';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { SqsQueueFactory } from '../cdk_constructs/SqsQueueFactory';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import {
  DynamoDbTableFactory,
  ITableWithStream,
} from '../cdk_constructs/DynamoTableFactory';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

interface IUnsConfig {
  certArn: secretsmanager.ISecret;
  keyArn: secretsmanager.ISecret;
  kmsKeyArn: string;
  apiKeySecret: secretsmanager.ISecret;
}

const constants = {
  SOURCE_STORE_TABLE_NAME_VARIABLE: 'sourceStore',
  TABLE_NAME_VARIABLE: 'eventsSource',
};

export interface EventsAggregatorStackProps extends cdk.StackProps {
  serviceName: string;
  teamName: string;
  repositoryUrl: string;
  version: string;
  environment: string;
  costCenter: string;
}

export class EventsAggregatorStack extends cdk.Stack {
  public readonly eventSourceTable: ITableWithStream;
  public readonly sourceSourceTable: dynamodb.ITable;
  public readonly sharedNamespace = `ea-runner`;

  private readonly lambdaFactory = new LambdaFactory(this, 'EventsAggregator');

  private readonly scheduleFactory = new EventBridgeScheduleFactory(
    this,
    'EventBridgeSchedule',
  );

  private readonly dynamoFactory = new DynamoDbTableFactory(
    this,
    'DyanamoTable',
  );

  constructor(scope: Construct, id: string, props: EventsAggregatorStackProps) {
    super(scope, id, props);

    const env = getEnvironment();
    const namePrefix = getResourceNamePrefix();
    const __dirname = dirname(fileURLToPath(import.meta.url));

    cdk.Tags.of(this).add('ServiceName', props.serviceName);
    cdk.Tags.of(this).add('TeamName', props.teamName);
    cdk.Tags.of(this).add('RepositoryUrl', props.repositoryUrl);
    cdk.Tags.of(this).add('Version', props.version);
    cdk.Tags.of(this).add('CostCenter', props.costCenter);
    cdk.Tags.of(this).add('Environment', props.environment);

    const localNamespace = `ea-${env}`;
    const params = [
      `/${this.sharedNamespace}/uns-mtls-cert-arn`,
      `/${this.sharedNamespace}/uns-mtls-key-arn`,
      `/${this.sharedNamespace}/uns-kms-key-arn`,
    ];

    const [cert, key, kmsArn] = params.map((param: string) =>
      StringParameter.valueForStringParameter(this, param),
    );

    const certSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'ClientCert',
      cert,
    );

    const keySecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'ClientKey',
      key,
    );

    const unsApiKeySecret = new secretsmanager.Secret(this, 'UnsApiKeySecret', {
      secretName: `${localNamespace}/uns-api-key`,
      description: 'UNS API key',
      secretStringValue: cdk.SecretValue.unsafePlainText('PLACEHOLDER'),
      removalPolicy: isEphemeralEnvironment()
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });

    const sqsFactory = new SqsQueueFactory(this, 'SqsEvents');

    const incomingEventsQueue = sqsFactory.createQueueWithDeadLetter(
      'IncomingEventsQueue',
      {
        name: 'incoming-events',
        fifo: true,
        contentBasedDeduplication: true,
        visibilityTimeout: cdk.Duration.seconds(60),
        maxReceiveCount: 3,
      },
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

    this.sourceSourceTable = this.dynamoFactory.createTable(
      'EventSourceTable',
      {
        name: constants.SOURCE_STORE_TABLE_NAME_VARIABLE,
        partitionKey: 'sourceID',
        pointInTimeRecovery: false,
        removalPolicy: isEphemeralEnvironment()
          ? cdk.RemovalPolicy.DESTROY
          : cdk.RemovalPolicy.RETAIN,
      },
    );

    const travelDigestionLambda = this.lambdaFactory.createLambda(
      'TravelIngestionLambda',
      {
        code: lambda.Code.fromAsset(
          join(__dirname, '../../dist/travel-ingestion'),
        ),
        description: 'Polls the content api and sends events to UNS',
        duration: 10,
        key: logKey,
        handler: 'index.handler',
        memorySize: 128,
        name: 'pollTravelContent',
        environment: {
          INCOMING_EVENTS_QUEUE_URL: incomingEventsQueue.queue.queueName,
        },
        retentionDays: logs.RetentionDays.ONE_WEEK,
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        skipCheckovRule: 'CKV_AWS_59',
      },
    );

    this.sourceSourceTable.grantReadWriteData(travelDigestionLambda);
    incomingEventsQueue.queue.grantSendMessages(travelDigestionLambda);
    incomingEventsQueue.deadLetterQueue.grantSendMessages(
      travelDigestionLambda,
    );

    const singleEventLambda = this.lambdaFactory.createLambda('SingleEvent', {
      code: lambda.Code.fromAsset(join(__dirname, '../../dist/single-event')),
      description: 'Pushes singe event "instant" to UNS',
      duration: 10,
      key: logKey,
      handler: 'index.handler',
      memorySize: 128,
      name: 'singleEvent',
      environment: {
        SSM_PREFIX: this.sharedNamespace,
        UNS_API_KEY_ARN: unsApiKeySecret.secretArn,
      },
      retentionDays: logs.RetentionDays.ONE_WEEK,
      runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
      skipCheckovRule: 'CKV_AWS_59',
    });

    // // create the db

    this.eventSourceTable = this.dynamoFactory.createTableWithStream(
      'EventSourceTable',
      {
        name: constants.TABLE_NAME_VARIABLE,
        partitionKey: 'eventID',
        sortKey: 'compositeKey',
        globalSecondaryIndexes: [
          {
            indexName: 'timestamp-query',
            partitionKeyName: 'compositeKey',
            partitionKeyType: dynamodb.AttributeType.STRING,
            sortKeyName: 'eventTimestamp',
            sortKeyType: dynamodb.AttributeType.STRING,
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
        description: 'Polls the content api and sends events to UNS',
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

    const eventAggregatorLambda = this.lambdaFactory.createLambda(
      'EventAggregator',
      {
        code: lambda.Code.fromAsset(
          join(__dirname, '../../dist/events-aggregator'),
        ),
        description: 'Pushes singe event "instant" to UNS',
        duration: 10,
        key: logKey,
        handler: 'index.handler',
        memorySize: 128,
        name: 'eventsAggregator',
        environment: {
          SSM_PREFIX: this.sharedNamespace,
          UNS_API_KEY_ARN: unsApiKeySecret.secretArn,
        },
        retentionDays: logs.RetentionDays.ONE_WEEK,
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        skipCheckovRule: 'CKV_AWS_59',
      },
    );

    this.grantTableAccess(eventAggregatorLambda, 'read');
    this.grantUnsAccess(eventAggregatorLambda, {
      certArn: certSecret,
      keyArn: keySecret,
      apiKeySecret: unsApiKeySecret,
      kmsKeyArn: kmsArn,
    });

    (['hourly'] as ScheduleFrequency[]).map((frequency: ScheduleFrequency) => {
      this.scheduleFactory.createScheduledRule(`${frequency}-schedule`, {
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
    });

    (['daily', 'weekly'] as ScheduleFrequency[]).map(
      (frequency: ScheduleFrequency) => {
        this.scheduleFactory.createScheduledRule(`${frequency}-schedule`, {
          name: `${frequency.toUpperCase()}eventAggregator`,
          targetFunction: eventAggregatorLambda,
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
    if (access === 'write') this.eventSourceTable.table.grantWriteData(fn);
    else this.eventSourceTable.table.grantReadData(fn);

    this.lambdaFactory.addEnvironmentVariable(fn, {
      name: constants.TABLE_NAME_VARIABLE,
      value: this.eventSourceTable.table.tableName,
    });
  }
}
