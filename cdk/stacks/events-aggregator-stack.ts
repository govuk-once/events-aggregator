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
  getResourceNamePrefix,
  isEphemeralEnvironment,
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
  TABLE_NAME_VARIABLE: 'eventsSource',
};

export class EventsAggregatorStack extends cdk.Stack {
  public readonly sourceSourceTable: ITable;
  public readonly eventStoreTable: ITableWithStream;
  public readonly sharedNamespace: string = `ea-runner`;

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

    const lambdaFactory = new LambdaFactory(this, 'EventsAggregator');

    const eventBridgeFactory = new EventBridgeScheduleFactory(
      this,
      'EventBridgeSchedule',
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

    const travelDigestionLambda = lambdaFactory.createLambda(
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

    this.sourceSourceTable.grantReadWriteData(travelDigestionLambda);
    certSecret.grantRead(travelDigestionLambda);
    keySecret.grantRead(travelDigestionLambda);
    unsApiKeySecret.grantRead(travelDigestionLambda);

    const singleEventLambda = lambdaFactory.createLambda('SingleEventLambda', {
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
      },
      retentionDays: logs.RetentionDays.ONE_WEEK,
      runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
      skipCheckovRule: 'CKV_AWS_59',
    });

    this.eventStoreTable = this.dynamoFactory.createTableWithStream(
      'EventSourceTable',
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
}
