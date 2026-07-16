import { describe, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { EventsAggregatorStack } from './events-aggregator-stack';

describe('EventsAggregatorStack', () => {
  const app = new cdk.App();

  process.env.ENVIRONMENT = 'test';

  const stack = new EventsAggregatorStack(app, 'TestStack', {
    serviceName: 'events-aggregator',
    teamName: 'govuk-once',
    repositoryUrl: 'https://github.com/govuk-once/events-aggregator',
    version: '0.1.0',
    costCenter: 'govuk-once',
    environment: 'test',
  });

  const template = Template.fromStack(stack);

  it('creates a Lambda function', () => {
    template.resourceCountIs('AWS::Lambda::Function', 1);
  });

  it('creates three EventBridge rules', () => {
    template.resourceCountIs('AWS::Events::Rule', 3);
  });

  it('creates an SNS alarm topic', () => {
    template.hasResourceProperties('AWS::SNS::Topic', {
      TopicName: 'test-events-aggregator-alarms',
    });
  });

  it('configures Lambda with 60 second timeout', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Timeout: 60,
      MemorySize: 256,
    });
  });

  it('passes schedule input to EventBridge targets', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(1 hour)',
    });
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(1 day)',
    });
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(7 days)',
    });
  });
});
