import { describe, test } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';

import { StandardServiceAlarmsFactory } from './StandardServiceAlarmsFactory';

const serviceName = 'alarmService';

describe('Standard Service Alarms', () => {
  test('creates Lambda error rate alarm with default threshold', () => {
    const app = new App();
    const stack = new Stack(app, 'teststack');

    const topic = new sns.Topic(stack, 'AlarmTopic');

    const fn = new lambda.Function(stack, 'testFunc', {
      functionName: 'testFunction',
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code: lambda.Code.fromInline(
        'exports.handler = async () => ({ statusCode: 200, body: "ok" })',
      ),
    });

    const alarmsFactory = new StandardServiceAlarmsFactory(stack, serviceName);

    alarmsFactory.createAlarms('alarms', {
      restApis: [],
      lambdas: [fn],
      alarmTopic: topic,
    });

    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::CloudWatch::Alarm', 1);

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      ComparisonOperator: 'GreaterThanThreshold',
      Threshold: 1,
      EvaluationPeriods: 1,
      TreatMissingData: 'notBreaching',
      Metrics: Match.arrayWith([
        Match.objectLike({
          Expression: '(errors / invocations) * 100',
          Label: 'Error Rate %',
        }),
      ]),
    });
  });

  test('alarms publish to SNS topic on alarm and OK', () => {
    const app = new App();
    const stack = new Stack(app, 'teststack');

    const topic = new sns.Topic(stack, 'AlarmTopic');

    const fn = new lambda.Function(stack, 'testFunc', {
      functionName: 'testFunction',
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code: lambda.Code.fromInline(
        'exports.handler = async () => ({ statusCode: 200, body: "ok" })',
      ),
    });

    const alarmsFactory = new StandardServiceAlarmsFactory(stack, serviceName);

    alarmsFactory.createAlarms('alarms', {
      restApis: [],
      lambdas: [fn],
      alarmTopic: topic,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmActions: [{ Ref: Match.anyValue() }],
      OKActions: [{ Ref: Match.anyValue() }],
    });
  });

  test('supports custom thresholds and evaluation periods', () => {
    const app = new App();
    const stack = new Stack(app, 'teststack');

    const topic = new sns.Topic(stack, 'AlarmTopic');

    const fn = new lambda.Function(stack, 'testFunc', {
      functionName: 'testFunction',
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'index.handler',
      code: lambda.Code.fromInline(
        'exports.handler = async () => ({ statusCode: 200, body: "ok" })',
      ),
    });

    const alarmsFactory = new StandardServiceAlarmsFactory(stack, serviceName);

    alarmsFactory.createAlarms('alarms', {
      restApis: [],
      lambdas: [fn],
      alarmTopic: topic,
      lambdaErrorThresholdPercent: 10,
      evaluationPeriodMinutes: 10,
      evaluationPeriods: 3,
    });

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::CloudWatch::Alarm', {
      Threshold: 10,
      EvaluationPeriods: 3,
    });
  });
});
