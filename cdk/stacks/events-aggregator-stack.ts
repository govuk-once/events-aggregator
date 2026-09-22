import * as cdk from 'aws-cdk-lib';
import { AttributeType, ITable } from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import {
  CodeSigningConfig,
  UntrustedArtifactOnDeployment,
} from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import { ISecret, Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Platform, SigningProfile } from 'aws-cdk-lib/aws-signer';
import { ITopic } from 'aws-cdk-lib/aws-sns';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DashboardFactory } from '../cdk_constructs/DashboardFactory';
import {
  DynamoDbTableFactory,
  ITableWithStream,
} from '../cdk_constructs/DynamoTableFactory';
import {
  EventBridgeScheduleFactory,
  ScheduleFrequency,
} from '../cdk_constructs/EventBridgeScheduleFactory';
import { LambdaFactory } from '../cdk_constructs/LambdaFunctionFactory';
import { NotificationFactory } from '../cdk_constructs/NotificationFactory';
import { SqsQueueFactory } from '../cdk_constructs/SqsQueueFactory';
import { StandardServiceAlarmsFactory } from '../cdk_constructs/StandardServiceAlarmsFactory';
import {
  alertsNotificationSsmKeys,
  getEnvironment,
  getPullRequestNumber,
  getResourceNamePrefix,
  isEphemeralEnvironment,
  ISlackChannelSsmKeys,
  isPullRequestEnvironment,
  isSandboxEnvironment,
  releaseNotificationSsmKeys,
  ssmPlaceholderValue,
} from '../constants/environments';

interface ISlackChannelWiring {
  id: string;
  name: string;
  keys: ISlackChannelSsmKeys;
  topics: ITopic[];
  key: kms.IKey;
}

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
  public readonly alertsTopic: ITopic;
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

    const codeSigningProfile = new SigningProfile(this, 'CodeSigningProfile', {
      platform: Platform.AWS_LAMBDA_SHA384_ECDSA,
    });

    const codeSigningConfig = new CodeSigningConfig(this, 'CodeSigningConfig', {
      signingProfiles: [codeSigningProfile],
      untrustedArtifactOnDeployment: UntrustedArtifactOnDeployment.WARN,
    });

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

    const dataKey = new kms.Key(this, 'DataEncryptionKey', {
      alias: `${namePrefix}-data-key`,
      enableKeyRotation: true,
      removalPolicy: isEphemeralEnvironment()
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });

    dataKey.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.AccountPrincipal(flexAccountId)],
        actions: ['kms:Decrypt', 'kms:DescribeKey'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'kms:ViaService': `dynamodb.${this.region}.amazonaws.com`,
          },
        },
      }),
    );

    const unsApiKeySecret = new Secret(this, 'UnsApiKeySecret', {
      secretName: `${localNamespace}/uns-api-key`,
      description: 'UNS API key',
      generateSecretString: { excludePunctuation: true },
      encryptionKey: dataKey,
      removalPolicy: isEphemeralEnvironment()
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });

    this.sourceTable = this.dynamoFactory.createTable('EventSourceTable', {
      name: constants.SOURCE_STORE_TABLE_NAME_VARIABLE,
      partitionKey: 'sourceID',
      sortKey: 'compositeKey',
      pointInTimeRecovery: true,
      key: dataKey,
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
        key: dataKey,
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

    const travelIngestionLambda = this.lambdaFactory.createLambda(
      'travelIngestionLambda',
      {
        code: lambda.Code.fromAsset(
          join(__dirname, '../../dist/travel-ingestion'),
        ),
        codeSigningConfig,
        description: 'Polls the content api and sends events to UNS',
        duration: 10,
        key: logKey,
        handler: 'index.handler',
        memorySize: 128,
        name: 'travel-ingestion',
        environment: {
          SSM_PREFIX: this.sharedNamespace,
          UNS_API_KEY_ARN: unsApiKeySecret.secretArn,
          INCOMING_EVENTS_QUEUE_URL: incomingEventsQueue.queue.queueUrl,
          SOURCE_TABLE_NAME: this.sourceTable.tableName,
          POWERTOOLS_SERVICE_NAME: 'events-aggregator-travel-ingestion',
          POWERTOOLS_METRICS_NAMESPACE: 'EventsAggregator',
        },
        retentionDays: logs.RetentionDays.ONE_WEEK,
        runtime: cdk.aws_lambda.Runtime.NODEJS_24_X,
        skipCheckovRule: 'CKV_AWS_59',
      },
    );

    this.grantUnsAccess(travelIngestionLambda, {
      certArn: certSecret,
      keyArn: keySecret,
      apiKeySecret: unsApiKeySecret,
      kmsKeyArn: kmsArn,
    });

    this.sourceTable.grantReadWriteData(travelIngestionLambda);
    incomingEventsQueue.queue.grantSendMessages(travelIngestionLambda);
    incomingEventsQueue.deadLetterQueue.grantSendMessages(
      travelIngestionLambda,
    );

    const { table: eventStoreTable } = this.dynamoFactory.createTableWithStream(
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
        pointInTimeRecovery: true,
        key: dataKey,
        removalPolicy: isEphemeralEnvironment()
          ? cdk.RemovalPolicy.DESTROY
          : cdk.RemovalPolicy.RETAIN,
      },
    );

    const singleEventLambda = this.lambdaFactory.createLambda(
      'SingleEventLambda',
      {
        code: lambda.Code.fromAsset(join(__dirname, '../../dist/single-event')),
        codeSigningConfig,
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
          EVENTS_STORE_TABLE_NAME: eventStoreTable.tableName,
        },
        retentionDays: logs.RetentionDays.ONE_WEEK,
        runtime: cdk.aws_lambda.Runtime.NODEJS_24_X,
        skipCheckovRule: 'CKV_AWS_59',
      },
    );

    this.eventStoreTable = {
      table: eventStoreTable,
      eventSource: this.dynamoFactory.addStreamConsumer(eventStoreTable, {
        streamFunction: singleEventLambda,
      }),
    };

    this.grantTableAccess(singleEventLambda, 'write');
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
        codeSigningConfig,
        description: 'Processes the events from the SQS queue',
        duration: 10,
        key: logKey,
        handler: 'index.handler',
        memorySize: 128,
        name: 'eventProcessing',
        retentionDays: logs.RetentionDays.ONE_WEEK,
        runtime: cdk.aws_lambda.Runtime.NODEJS_24_X,
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
        codeSigningConfig,
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
          EVENTS_STORE_TABLE_NAME: this.eventStoreTable.table.tableName,
          POWERTOOLS_SERVICE_NAME: 'events-aggregator-aggregated-event',
          POWERTOOLS_METRICS_NAMESPACE: 'EventsAggregator',
        },
        retentionDays: logs.RetentionDays.ONE_WEEK,
        runtime: cdk.aws_lambda.Runtime.NODEJS_24_X,
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

    for (const frequency of [
      'hourly',
      'daily',
      'weekly',
    ] as ScheduleFrequency[]) {
      eventBridgeFactory.createScheduledRule(`${frequency}-schedule`, {
        name: `${frequency.toUpperCase()}TravelSchedule`,
        targetFunction: travelIngestionLambda,
        frequency,
        enabled: true,
        eventPayload: {
          triggeredAt: events.EventField.fromPath('$.time'),
          schedule: frequency,
          source: events.EventField.fromPath('$.source'),
        },
      });
    }

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
            'kms:ViaService': `secretsmanager.${this.region}.amazonaws.com`,
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

    // Operational alerts and release announcements are kept on separate topics
    // and separate channels, so a deploy announcement can never be mistaken for
    // an alarm.
    this.alertsTopic = this.createNotifications(namePrefix, props.serviceName);

    // The same thresholds apply to every function and queue, so a breach means
    // the same thing wherever it is raised.
    new StandardServiceAlarmsFactory(this, props.serviceName).createAlarms(
      'ServiceAlarms',
      {
        alarmTopic: this.alertsTopic,
        lambdas: [
          travelIngestionLambda,
          singleEventLambda,
          eventProcessingLambda,
          aggregatedEventLambda,
        ],
        queues: [incomingEventsQueue.queue],
        deadLetterQueues: [incomingEventsQueue.deadLetterQueue],
      },
    );

    new DashboardFactory(this, props.serviceName).createOverviewDashboard({
      ingestion: travelIngestionLambda,
      processing: eventProcessingLambda,
      singleEvent: singleEventLambda,
      aggregatedEvent: aggregatedEventLambda,
    });

    new cdk.CfnOutput(this, 'TravelConfigKey', {
      value: flexConfigKey.keyArn,
      description: 'Travel KMS Config key arn',
    });

    new cdk.CfnOutput(this, 'TravelKMSDataKey', {
      value: dataKey.keyArn,
      description: 'Travel KMS data key arn',
    });

    new cdk.CfnOutput(this, 'FlexTravelConfigSecretArn', {
      value: flexTravelConfigSecret.secretArn,
      description: 'Secret the FLEX account reads to connect to this account',
    });

    new cdk.CfnOutput(this, 'FlexTravelReadRoleArn', {
      value: flexTravelReadRole.roleArn,
    });
  }

  /**
   * Create the notification topics - operational alerts, and the release
   * announcements the deployment pipeline publishes - and the Slack channels
   * that subscribe to them. The topics are created in every environment; only
   * the Slack integration is conditional.
   *
   * @returns the topic alarm constructs publish operational alerts to
   */
  private createNotifications(namePrefix: string, serviceName: string): ITopic {
    const notificationFactory = new NotificationFactory(this, serviceName);

    const notificationKey = new kms.Key(this, 'NotificationEncryptionKey', {
      alias: `${namePrefix}-notification-key`,
      description: 'Encrypts notifications at rest in SNS',
      enableKeyRotation: true,
      removalPolicy: isEphemeralEnvironment()
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });

    // Without this an alarm action fails silently - CloudWatch cannot put a
    // message on a topic whose key it is not allowed to use.
    notificationKey.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
        actions: ['kms:Decrypt', 'kms:GenerateDataKey*'],
        resources: ['*'],
      }),
    );

    const alertsTopic = notificationFactory.createTopic('OperationalAlerts', {
      name: 'operational-alerts',
      displayName: 'Operational alerts',
      key: notificationKey,
    });

    const releaseTopic = notificationFactory.createTopic(
      'ReleaseNotifications',
      {
        name: 'release-notifications',
        displayName: 'Release notifications',
        key: notificationKey,
      },
    );

    // A sandbox - a developer's own stack, or a per pull request stack - shares
    // its account with the real environments, so it gets the topics but never
    // its own Slack integration.
    if (!isSandboxEnvironment()) {
      [
        {
          id: 'AlertsSlackChannel',
          name: 'operational-alerts',
          keys: alertsNotificationSsmKeys,
          topics: [alertsTopic],
          key: notificationKey,
        },
        {
          id: 'ReleaseSlackChannel',
          name: 'release-notifications',
          keys: releaseNotificationSsmKeys,
          topics: [releaseTopic],
          key: notificationKey,
        },
      ].forEach((wiring: ISlackChannelWiring) =>
        this.subscribeSlackChannel(notificationFactory, wiring),
      );
    }

    new cdk.CfnOutput(this, 'AlertsTopicArn', {
      value: alertsTopic.topicArn,
      description: 'SNS topic CloudWatch alarms publish operational alerts to',
    });

    new cdk.CfnOutput(this, 'ReleaseNotificationTopicArn', {
      value: releaseTopic.topicArn,
      description:
        'SNS topic the deployment pipeline publishes release notifications to',
    });

    return alertsTopic;
  }

  /**
   * Subscribe a Slack channel to the given topics. Both ids are seeded as
   * placeholders and Chatbot rejects those, so the integration is held behind a
   * condition until each carries a real value. The check is a deploy time one,
   * so synth neither reads nor needs the values.
   */
  private subscribeSlackChannel(
    factory: NotificationFactory,
    wiring: ISlackChannelWiring,
  ): void {
    const [workspaceId, channelId] = [
      wiring.keys.slackWorkspaceId,
      wiring.keys.slackChannelId,
    ].map((key: string) =>
      StringParameter.valueForStringParameter(
        this,
        `/${this.sharedNamespace}/${key}`,
      ),
    );

    const configured = new cdk.CfnCondition(this, `${wiring.id}Configured`, {
      expression: cdk.Fn.conditionAnd(
        cdk.Fn.conditionNot(
          cdk.Fn.conditionEquals(
            workspaceId,
            ssmPlaceholderValue(wiring.keys.slackWorkspaceId),
          ),
        ),
        cdk.Fn.conditionNot(
          cdk.Fn.conditionEquals(
            channelId,
            ssmPlaceholderValue(wiring.keys.slackChannelId),
          ),
        ),
      ),
    });

    factory.createSlackChannel(wiring.id, {
      name: wiring.name,
      workspaceId,
      channelId,
      topics: wiring.topics,
      decryptKeys: [wiring.key],
      createCondition: configured,
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
