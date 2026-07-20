import { Construct } from 'constructs';
import { FactoryBase } from './FactoryBase';
import { INamingProvider } from './namingProviders/INamingProvider';
import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export type ScheduleFrequency = 'hourly' | 'daily' | 'weekly';

class constants {
  static readonly FREQUENCY: ScheduleFrequency = 'daily';
  static readonly MAX_EVENT_AGE: cdk.Duration = cdk.Duration.hours(2);
  static readonly RETRY_ATTEMPTS: number = 2;
  static readonly ENABLED: boolean = true;
}

const PRESET_SCHEDULES: Record<ScheduleFrequency, events.Schedule> = {
  hourly: events.Schedule.rate(cdk.Duration.hours(1)),
  daily: events.Schedule.rate(cdk.Duration.days(1)),
  weekly: events.Schedule.rate(cdk.Duration.days(7)),
};

/**
 * Configuration for a scheduled EventBridge rule that triggers a lambda.
 *
 * @param name - the name of the rule.  the system will ensure the rule name is configured for the environment in which it is deployed
 * @param targetFunction - the lambda invoked when the rule fires
 * @param frequency - optional preset cadence (hourly/daily/weekly).  ignored when `schedule` is supplied
 * @param schedule - optional custom cron/rate expression, overrides `frequency`
 * @param eventPayload - optional static JSON event passed to the lambda
 * @param enabled - optional toggle the rule without removing it
 * @param maxEventAge - optional maximum age of an event before it is discarded
 * @param retryAttempts - optional maximum retry attempts for the async invocation
 * @param description - optional description for the rule
 */
export interface IScheduleProperties {
  name: string;
  targetFunction: lambda.IFunction;
  frequency?: ScheduleFrequency;
  schedule?: events.Schedule;
  eventPayload?: Record<string, unknown>;
  enabled?: boolean;
  maxEventAge?: cdk.Duration;
  retryAttempts?: number;
  description?: string;
}

/**
 * create an EventBridge rule that invokes a lambda on a schedule
 * (hourly / daily / weekly, or a custom cron/rate expression)
 * @param scope - the stack scope which is associated with the building of the rule
 */
export class EventBridgeScheduleFactory extends FactoryBase {
  constructor(
    private readonly scope: Construct,
    serviceName: string,
    namingProvider?: INamingProvider,
  ) {
    super(serviceName, namingProvider);
  }

  /**
   * Create a scheduled rule and attach the target lambda
   * @param id - a unique identifier for the rule within the cdk scope
   * @param props - configuration settings for the schedule see {@link IScheduleProperties}
   * @returns the EventBridge rule
   */
  public createScheduledRule(
    id: string,
    props: IScheduleProperties,
  ): events.Rule {
    const frequency = props.frequency ?? constants.FREQUENCY;

    const rule = new events.Rule(this.scope, this.getResourceId(id), {
      ruleName: this.getResourceName(props.name),
      description: props.description ?? `Scheduled (${frequency}) trigger`,
      schedule: props.schedule ?? PRESET_SCHEDULES[frequency],
      enabled: props.enabled ?? constants.ENABLED,
    });

    rule.addTarget(
      new targets.LambdaFunction(props.targetFunction, {
        event: props.eventPayload
          ? events.RuleTargetInput.fromObject(props.eventPayload)
          : undefined,
        maxEventAge: props.maxEventAge ?? constants.MAX_EVENT_AGE,
        retryAttempts: props.retryAttempts ?? constants.RETRY_ATTEMPTS,
      }),
    );

    return rule;
  }
}