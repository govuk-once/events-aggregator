import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as path from 'path';
import { Construct } from 'constructs';
import {
  getResourceNamePrefix,
  isEphemeralEnvironment,
} from '../constants/environment';
import { StandardServiceAlarmsFactory } from '../cdk_constructs/StandardServiceAlarmsFactory';

export interface EventsAggregatorStackProps extends cdk.StackProps {
  serviceName: string;
  teamName: string;
  repositoryUrl: string;
  version: string;
  environment: string;
  costCenter: string;
}

export class EventsAggregatorStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: EventsAggregatorStackProps,
  ) {
    super(scope, id, props);

    cdk.Tags.of(this).add('ServiceName', props.serviceName);
    cdk.Tags.of(this).add('TeamName', props.teamName);
    cdk.Tags.of(this).add('RepositoryUrl', props.repositoryUrl);
    cdk.Tags.of(this).add('Version', props.version);
    cdk.Tags.of(this).add('CostCenter', props.costCenter);
    cdk.Tags.of(this).add('Environment', props.environment);

    const logKey = new kms.Key(this, 'LogEncryptionKey', {
      alias: `${getResourceNamePrefix()}-log-key`,
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

    const logGroup = new logs.LogGroup(this, 'PollerLogGroup', {
      logGroupName: `/aws/lambda/${getResourceNamePrefix()}-poller`,
      encryptionKey: logKey,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: isEphemeralEnvironment()
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });

    const pollerLambda = new cdk.aws_lambda_nodejs.NodejsFunction(
      this,
      'EventsAggregatorFunction',
      {
        functionName: `${getResourceNamePrefix()}-poller`,
        entry: path.join(__dirname, '../../src/handler.ts'),
        handler: 'handler',
        runtime: cdk.aws_lambda.Runtime.NODEJS_22_X,
        memorySize: 256,
        timeout: cdk.Duration.seconds(60),
        reservedConcurrentExecutions: 3,
        environmentEncryption: logKey,
        logGroup,
        environment: {
          SERVICE_NAME: props.serviceName,
          ENVIRONMENT: props.environment,
          UNS_API_URL: process.env.UNS_API_URL || '',
          UNS_API_REGION: process.env.UNS_API_REGION || 'eu-west-2',
          UNS_SIGV4_ENABLED: isEphemeralEnvironment() ? 'false' : 'true',
        },
      },
    );

    const schedules: { name: string; schedule: events.Schedule; input: string }[] = [
      {
        name: 'Hourly',
        schedule: events.Schedule.rate(cdk.Duration.hours(1)),
        input: JSON.stringify({ schedule: 'hourly' }),
      },
      {
        name: 'Daily',
        schedule: events.Schedule.rate(cdk.Duration.days(1)),
        input: JSON.stringify({ schedule: 'daily' }),
      },
      {
        name: 'Weekly',
        schedule: events.Schedule.rate(cdk.Duration.days(7)),
        input: JSON.stringify({ schedule: 'weekly' }),
      },
    ];

    for (const { name, schedule, input } of schedules) {
      new events.Rule(this, `${name}Rule`, {
        ruleName: `${getResourceNamePrefix()}-${name.toLowerCase()}`,
        schedule,
        targets: [
          new targets.LambdaFunction(pollerLambda, {
            event: events.RuleTargetInput.fromObject(JSON.parse(input)),
          }),
        ],
      });
    }

    const snsKey = new kms.Key(this, 'AlarmTopicKey', {
      enableKeyRotation: true,
    });

    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `${getResourceNamePrefix()}-alarms`,
      displayName: `${getResourceNamePrefix()} Alarms`,
      masterKey: snsKey,
    });

    const alarmsFactory = new StandardServiceAlarmsFactory(
      this,
      props.serviceName,
    );

    alarmsFactory.createAlarms('ServiceAlarms', {
      restApis: [],
      lambdas: [pollerLambda],
      alarmTopic: alarmTopic,
    });

    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: alarmTopic.topicArn,
      description: 'SNS Topic ARN for CloudWatch Alarms',
    });
  }
}
