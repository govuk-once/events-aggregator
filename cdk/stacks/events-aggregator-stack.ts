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
  getResourceNamePrefix,
  isEphemeralEnvironment,
} from '../constants/environments';
import {
  EventBridgeScheduleFactory,
  ScheduleFrequency,
} from '../cdk_constructs/EventBridgeScheduleFactory';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';

export interface EventsAggregatorStackProps extends cdk.StackProps {
  serviceName: string;
  teamName: string;
  repositoryUrl: string;
  version: string;
  environment: string;
  costCenter: string;
}

export class EventsAggregatorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EventsAggregatorStackProps) {
    super(scope, id, props);

    const namePrefix = getResourceNamePrefix();
    const __dirname = dirname(fileURLToPath(import.meta.url));

    cdk.Tags.of(this).add('ServiceName', props.serviceName);
    cdk.Tags.of(this).add('TeamName', props.teamName);
    cdk.Tags.of(this).add('RepositoryUrl', props.repositoryUrl);
    cdk.Tags.of(this).add('Version', props.version);
    cdk.Tags.of(this).add('CostCenter', props.costCenter);
    cdk.Tags.of(this).add('Environment', props.environment);

    const namespace = `ea-runner`;
    const params = [
      `/${namespace}/uns-mtls-cert-arn`,
      `/${namespace}/uns-mtls-key-arn`,
      `/${namespace}/uns-kms-key-arn`,
      `/${namespace}/uns-api-key`,
    ];

    const [cert, key, kmsArn, apiKeyArn] = params.map((param: string) =>
      StringParameter.valueForStringParameter(this, param),
    );

    const certSecret = Secret.fromSecretCompleteArn(this, 'ClientCert', cert);

    const keySecret = Secret.fromSecretCompleteArn(this, 'ClientKey', key);
    // const unsApiKeySecret = Secret.fromSecretCompleteArn(
    //   this,
    //   'ApiKey',
    //   apiKeyArn,
    // );

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

    const lambdaFunction = lambdaFactory.createLambda(
      'PollTravelContentLambda',
      {
        code: lambda.Code.fromAsset(
          join(__dirname, '../../dist/travel-alerts'),
        ),
        description: 'Polls the content api and sends events to UNS',
        duration: 10,
        key: logKey,
        handler: 'index.handler',
        memorySize: 128,
        name: 'pollTravelContent',
        environment: {
          SSM_PREFIX: namespace,
          UNS_API_KEY_ARN: apiKeyArn,
        },
        retentionDays: logs.RetentionDays.ONE_WEEK,
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        skipCheckovRule: 'CKV_AWS_59',
      },
    );

    lambdaFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['kms:Decrypt'],
        resources: [kmsArn],
      }),
    );

    certSecret.grantRead(lambdaFunction);
    keySecret.grantRead(lambdaFunction);
    // unsApiKeySecret.grantRead(lambdaFunction);

    (['hourly', 'daily', 'weekly'] as ScheduleFrequency[]).map(
      (frequency: ScheduleFrequency) => {
        eventBridgeFactory.createScheduledRule(`${frequency}-schedule`, {
          name: `${frequency.toUpperCase()}TravelSchedule`,
          targetFunction: lambdaFunction,
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
}
