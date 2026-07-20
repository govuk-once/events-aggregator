import { beforeEach, describe, expect, it , vi} from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import { EventBridgeScheduleFactory } from './EventBridgeScheduleFactory';
import { INamingProvider } from './namingProviders/INamingProvider';

const SERVICE_NAME = 'events-aggregator';

interface TestSetup {
  stack: cdk.Stack;
  factory: EventBridgeScheduleFactory;
  fn: lambda.Function;
}

const setup = (namingProvider?: INamingProvider): TestSetup => {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'TestStack');
  const fn = new lambda.Function(stack, 'TargetFn', {
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => {};'),
  });
  const factory = new EventBridgeScheduleFactory(
    stack,
    SERVICE_NAME,
    namingProvider,
  );
  return { stack, factory, fn };
};

describe('EventBridgeScheduleFactory', () => {
  
  beforeEach(()=> {
    vi.stubEnv('ENVIRONMENT', 'Dev');
    vi.stubEnv('USER', 'CI');
  })

  it('returns an EventBridge rule', () => {
    const { factory, fn } = setup();

    const rule = factory.createScheduledRule('HourlyJob', {
      name: 'events-aggregation',
      frequency: 'hourly',
      targetFunction: fn,
    });

    expect(rule).toBeInstanceOf(events.Rule);
  });

  it.each([
    ['hourly', 'rate(1 hour)'],
    ['daily', 'rate(1 day)'],
    ['weekly', 'rate(7 days)'],
  ] as const)(
    'maps the %s preset to schedule expression %s',
    (frequency, expression) => {
      const { stack, factory, fn } = setup();

      factory.createScheduledRule('Job', {
        name: 'events-aggregation',
        frequency,
        targetFunction: fn,
      });

      Template.fromStack(stack).hasResourceProperties('AWS::Events::Rule', {
        ScheduleExpression: expression,
        State: 'ENABLED',
      });
    },
  );

  it('defaults to the daily preset when no frequency or schedule is given', () => {
    const { stack, factory, fn } = setup();

    factory.createScheduledRule('Job', {
      name: 'events-aggregation',
      targetFunction: fn,
    });

    Template.fromStack(stack).hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(1 day)',
    });
  });

  it('prefers a custom schedule over the frequency preset', () => {
    const { stack, factory, fn } = setup();

    factory.createScheduledRule('Job', {
      name: 'events-aggregation',
      frequency: 'hourly',
      schedule: events.Schedule.cron({ minute: '0', hour: '9' }),
      targetFunction: fn,
    });

    Template.fromStack(stack).hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'cron(0 9 * * ? *)',
    });
  });

  it('prefixes the rule name with the service name by default', () => {
    const { stack, factory, fn } = setup();

    factory.createScheduledRule('Job', {
      name: 'events-aggregation',
      targetFunction: fn,
    });

    Template.fromStack(stack).hasResourceProperties('AWS::Events::Rule', {
      Name: `dev-${SERVICE_NAME}-events-aggregation`,
    });
  });

  it('delegates naming to the naming provider when supplied', () => {
    const namingProvider: INamingProvider = {
      getResourceName: (name) => `dev-${name}-prod`,
      getResourceId: (id) => `dev-${id}`,
    };
    const { stack, factory, fn } = setup(namingProvider);

    factory.createScheduledRule('Job', {
      name: 'events-aggregation',
      targetFunction: fn,
    });

    Template.fromStack(stack).hasResourceProperties('AWS::Events::Rule', {
      Name: 'dev-events-aggregation-prod',
    });
  });

  it('attaches the lambda as a target with a static event payload', () => {
    const { stack, factory, fn } = setup();

    factory.createScheduledRule('Job', {
      name: 'events-aggregation',
      targetFunction: fn,
      eventPayload: { job: 'digest' },
    });

    Template.fromStack(stack).hasResourceProperties('AWS::Events::Rule', {
      Targets: Match.arrayWith([
        Match.objectLike({
          Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('TargetFn'), 'Arn'] },
          Input: JSON.stringify({ job: 'digest' }),
          RetryPolicy: {
            MaximumRetryAttempts: 2,
            MaximumEventAgeInSeconds: 7200,
          },
        }),
      ]),
    });
  });

  it('grants EventBridge permission to invoke the lambda', () => {
    const { stack, factory, fn } = setup();

    factory.createScheduledRule('Job', {
      name: 'events-aggregation',
      targetFunction: fn,
    });

    Template.fromStack(stack).hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'events.amazonaws.com',
    });
  });

  it('honours enabled=false and custom retry/max-age overrides', () => {
    const { stack, factory, fn } = setup();

    factory.createScheduledRule('Job', {
      name: 'events-aggregation',
      targetFunction: fn,
      enabled: false,
      retryAttempts: 5,
      maxEventAge: cdk.Duration.minutes(30),
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Events::Rule', {
      State: 'DISABLED',
      Targets: Match.arrayWith([
        Match.objectLike({
          RetryPolicy: {
            MaximumRetryAttempts: 5,
            MaximumEventAgeInSeconds: 1800,
          },
        }),
      ]),
    });
  });
});
