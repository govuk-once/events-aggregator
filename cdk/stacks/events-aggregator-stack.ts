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

    const env = getEnvironment();
    const namePrefix = getResourceNamePrefix();
    const __dirname = dirname(fileURLToPath(import.meta.url));

    cdk.Tags.of(this).add('ServiceName', props.serviceName);
    cdk.Tags.of(this).add('TeamName', props.teamName);
    cdk.Tags.of(this).add('RepositoryUrl', props.repositoryUrl);
    cdk.Tags.of(this).add('Version', props.version);
    cdk.Tags.of(this).add('CostCenter', props.costCenter);
    cdk.Tags.of(this).add('Environment', props.environment);

    const ssmNamespace = `ea-${env}`;

    const mtlsCertSecret = new secretsmanager.Secret(
      this,
      'UnsMtlsCertSecret',
      {
        secretName: `${namePrefix}/uns-mtls-cert`,
        description: 'UNS mTLS client certificate (PEM)',
        secretStringValue: cdk.SecretValue.unsafePlainText('PLACEHOLDER'),
        removalPolicy: isEphemeralEnvironment()
          ? cdk.RemovalPolicy.DESTROY
          : cdk.RemovalPolicy.RETAIN,
      },
    );

    const mtlsKeySecret = new secretsmanager.Secret(this, 'UnsMtlsKeySecret', {
      secretName: `${namePrefix}/uns-mtls-key`,
      description: 'UNS mTLS client private key (PEM)',
      secretStringValue: cdk.SecretValue.unsafePlainText('PLACEHOLDER'),
      removalPolicy: isEphemeralEnvironment()
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });

    const unsApiKeySecret = new secretsmanager.Secret(this, 'UnsApiKeySecret', {
      secretName: `${namePrefix}/uns-api-key`,
      description: 'UNS API key',
      secretStringValue: cdk.SecretValue.unsafePlainText('PLACEHOLDER'),
      removalPolicy: isEphemeralEnvironment()
        ? cdk.RemovalPolicy.DESTROY
        : cdk.RemovalPolicy.RETAIN,
    });

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
          join(__dirname, '../../src/travel-alerts'),
        ),
        description: 'Polls the content api and sends events to UNS',
        duration: 10,
        key: logKey,
        handler: 'handler',
        memorySize: 128,
        name: 'pollTravelContent',
        environment: {
          SSM_PREFIX: ssmNamespace,
          UNS_CERT_ARN: mtlsCertSecret.secretArn,
          UNS_KEY_ARN: mtlsKeySecret.secretArn,
          UNS_API_KEY_ARN: unsApiKeySecret.secretArn,
        },
        retentionDays: logs.RetentionDays.ONE_WEEK,
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        skipCheckovRule: 'CKV_AWS_59',
      },
    );

    lambdaFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter', 'ssm:GetParametersByPath'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/${ssmNamespace}/*`,
        ],
      }),
    );

    mtlsCertSecret.grantRead(lambdaFunction);
    mtlsKeySecret.grantRead(lambdaFunction);
    unsApiKeySecret.grantRead(lambdaFunction);

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
