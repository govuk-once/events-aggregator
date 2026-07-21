import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { Construct } from 'constructs';
import { LambdaFactory } from '../cdk_constructs/LambdaFunctionFactory';
import {
  getResourceNamePrefix,
  isEphemeralEnvironment,
} from '../constants/environments';

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

    cdk.Tags.of(this).add('ServiceName', props.serviceName);
    cdk.Tags.of(this).add('TeamName', props.teamName);
    cdk.Tags.of(this).add('RepositoryUrl', props.repositoryUrl);
    cdk.Tags.of(this).add('Version', props.version);
    cdk.Tags.of(this).add('CostCenter', props.costCenter);
    cdk.Tags.of(this).add('Environment', props.environment);

    const lambdaFactory = new LambdaFactory(this, 'EventsAggregator');
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

    lambdaFactory.createLambda('PollTravelContentLambda', {
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../../src/travel-alerts'),
      ),
      description: 'Polls the content api and sends events to UNS',
      duration: 10,
      key: logKey,
      handler: 'handler',
      memorySize: 128,
      name: 'pollTravelContent',
      retentionDays: logs.RetentionDays.ONE_WEEK,
      runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
      skipCheckovRule: 'CKV_AWS_59',
    });
  }
}
