import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { Duration } from 'aws-cdk-lib';

import { FactoryBase } from './FactoryBase';
import { INamingProvider } from './namingProviders/INamingProvider';

/**
 * Priority prefixed to every alarm name, so the severity is visible wherever
 * the alarm surfaces - the console, and the operational alerts Slack channel.
 *
 * P1 - messages have been lost to processing (dead-letter queue not empty)
 * P2 - a service is failing or falling behind (error rates, queue depth)
 * P3 - a service is degrading (duration)
 */
export enum AlarmPriority {
  P1 = 'P1',
  P2 = 'P2',
  P3 = 'P3',
}

class constants {
  static readonly API_GATEWAY_5XX_THRESHOLD_PERCENT: number = 5;
  static readonly LAMBDA_ERROR_THRESHOLD_PERCENT: number = 1;
  static readonly LAMBDA_DURATION_P95_THRESHOLD_MS: number = 5000;
  static readonly QUEUE_DEPTH_THRESHOLD: number = 100;
  static readonly EVALUATION_PERIOD_MINUTES: number = 5;
  static readonly EVALUATION_PERIODS: number = 1;
  // SQS publishes queue metrics once a minute - evaluate the dead-letter queue
  // at that resolution so a failed message raises the alarm as soon as possible
  static readonly DEAD_LETTER_QUEUE_PERIOD_MINUTES: number = 1;
}

/**
 * Configuration for the standard service alarms. Every alarm publishes both
 * its ALARM and OK transitions to `alarmTopic`, and treats missing data as
 * not breaching.
 *
 * @param restApis - optional API Gateways to alarm on 5xx error rate (P2)
 * @param lambdas - optional functions to alarm on error rate (P2) and duration P95 (P3)
 * @param queues - optional queues to alarm on the number of visible messages (P2)
 * @param deadLetterQueues - optional dead-letter queues to alarm on as soon as any message is visible (P1)
 * @param alarmTopic - the topic alarm and ok actions are published to
 * @param apiGateway5xxThresholdPercent - optional 5xx error rate that raises the alarm
 * @param lambdaErrorThresholdPercent - optional error rate that raises the alarm, shared by every function
 * @param lambdaDurationP95ThresholdMs - optional P95 duration that raises the alarm, shared by every function
 * @param queueDepthThreshold - optional number of visible messages that raises the alarm, shared by every queue
 * @param evaluationPeriodMinutes - optional length of each evaluation period
 * @param evaluationPeriods - optional number of breaching periods before the alarm is raised
 */
export interface IStandardServiceAlarmsProps {
  restApis?: RestApi[];
  lambdas?: IFunction[];
  queues?: IQueue[];
  deadLetterQueues?: IQueue[];
  alarmTopic: sns.ITopic;

  apiGateway5xxThresholdPercent?: number;
  lambdaErrorThresholdPercent?: number;
  lambdaDurationP95ThresholdMs?: number;
  queueDepthThreshold?: number;
  evaluationPeriodMinutes?: number;
  evaluationPeriods?: number;
}

export class StandardServiceAlarmsFactory extends FactoryBase {
  constructor(
    private readonly scope: Construct,
    serviceName: string,
    namingProvider?: INamingProvider,
  ) {
    super(serviceName, namingProvider);
  }

  public createAlarms(
    id: string,
    props: IStandardServiceAlarmsProps,
  ): cloudwatch.Alarm[] {
    const alarms: cloudwatch.Alarm[] = [];

    const apiThreshold =
      props.apiGateway5xxThresholdPercent ??
      constants.API_GATEWAY_5XX_THRESHOLD_PERCENT;
    const lambdaThreshold =
      props.lambdaErrorThresholdPercent ??
      constants.LAMBDA_ERROR_THRESHOLD_PERCENT;
    const durationThreshold =
      props.lambdaDurationP95ThresholdMs ??
      constants.LAMBDA_DURATION_P95_THRESHOLD_MS;
    const queueDepthThreshold =
      props.queueDepthThreshold ?? constants.QUEUE_DEPTH_THRESHOLD;
    const periodMinutes =
      props.evaluationPeriodMinutes ?? constants.EVALUATION_PERIOD_MINUTES;
    const evaluationPeriods =
      props.evaluationPeriods ?? constants.EVALUATION_PERIODS;

    (props.restApis ?? []).forEach((api, index) => {
      alarms.push(
        this.createApiGateway5xxAlarm(
          `${id}-5xx-${index}`,
          api,
          apiThreshold,
          periodMinutes,
          evaluationPeriods,
        ),
      );
    });

    (props.lambdas ?? []).forEach((fn, index) => {
      alarms.push(
        this.createLambdaErrorAlarm(
          `${id}-err-${index}`,
          fn,
          lambdaThreshold,
          periodMinutes,
          evaluationPeriods,
        ),
        this.createLambdaDurationAlarm(
          `${id}-duration-${index}`,
          fn,
          durationThreshold,
          periodMinutes,
          evaluationPeriods,
        ),
      );
    });

    (props.queues ?? []).forEach((queue, index) => {
      alarms.push(
        this.createQueueDepthAlarm(
          `${id}-queue-depth-${index}`,
          queue,
          queueDepthThreshold,
          periodMinutes,
          evaluationPeriods,
        ),
      );
    });

    (props.deadLetterQueues ?? []).forEach((queue, index) => {
      alarms.push(this.createDeadLetterQueueAlarm(`${id}-dlq-${index}`, queue));
    });

    alarms.forEach((alarm) => {
      alarm.addAlarmAction(new cloudwatchActions.SnsAction(props.alarmTopic));
      alarm.addOkAction(new cloudwatchActions.SnsAction(props.alarmTopic));
    });

    return alarms;
  }

  private createApiGateway5xxAlarm(
    id: string,
    api: RestApi,
    thresholdPercent: number,
    periodMinutes: number,
    evaluationPeriods: number,
  ): cloudwatch.Alarm {
    const period = Duration.minutes(periodMinutes);

    const errorRate = new cloudwatch.MathExpression({
      expression: '(errors / requests) * 100',
      label: '5xx Error Rate %',
      usingMetrics: {
        errors: api.metricServerError({ period, statistic: 'Sum' }),
        requests: api.metricCount({ period, statistic: 'Sum' }),
      },
    });

    return new cloudwatch.Alarm(this.scope, id, {
      alarmName: this.getAlarmName(
        AlarmPriority.P2,
        `${this.getResourceName(api.restApiName)}-5xx-error-rate`,
      ),
      alarmDescription: `API Gateway ${api.restApiName} 5xx error rate exceeds ${thresholdPercent}%`,
      metric: errorRate,
      threshold: thresholdPercent,
      evaluationPeriods,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }

  private createLambdaErrorAlarm(
    id: string,
    fn: IFunction,
    thresholdPercent: number,
    periodMinutes: number,
    evaluationPeriods: number,
  ): cloudwatch.Alarm {
    const period = Duration.minutes(periodMinutes);

    const errorRate = new cloudwatch.MathExpression({
      expression: '(errors / invocations) * 100',
      label: 'Error Rate %',
      usingMetrics: {
        errors: fn.metricErrors({ period, statistic: 'Sum' }),
        invocations: fn.metricInvocations({ period, statistic: 'Sum' }),
      },
    });

    return new cloudwatch.Alarm(this.scope, id, {
      alarmName: this.getAlarmName(
        AlarmPriority.P2,
        `${fn.functionName}-error-rate`,
      ),
      alarmDescription: `Lambda ${fn.functionName} error rate exceeds ${thresholdPercent}%`,
      metric: errorRate,
      threshold: thresholdPercent,
      evaluationPeriods,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }

  private createLambdaDurationAlarm(
    id: string,
    fn: IFunction,
    thresholdMs: number,
    periodMinutes: number,
    evaluationPeriods: number,
  ): cloudwatch.Alarm {
    const period = Duration.minutes(periodMinutes);

    return new cloudwatch.Alarm(this.scope, id, {
      alarmName: this.getAlarmName(
        AlarmPriority.P3,
        `${fn.functionName}-duration-p95`,
      ),
      alarmDescription: `Lambda ${fn.functionName} P95 duration exceeds ${thresholdMs}ms`,
      metric: fn.metricDuration({ period, statistic: 'p95' }),
      threshold: thresholdMs,
      evaluationPeriods,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }

  private createQueueDepthAlarm(
    id: string,
    queue: IQueue,
    threshold: number,
    periodMinutes: number,
    evaluationPeriods: number,
  ): cloudwatch.Alarm {
    const period = Duration.minutes(periodMinutes);

    return new cloudwatch.Alarm(this.scope, id, {
      alarmName: this.getAlarmName(
        AlarmPriority.P2,
        `${queue.queueName}-queue-depth`,
      ),
      alarmDescription: `SQS queue ${queue.queueName} has more than ${threshold} visible messages`,
      metric: queue.metricApproximateNumberOfMessagesVisible({
        period,
        statistic: 'Maximum',
      }),
      threshold,
      evaluationPeriods,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }

  private createDeadLetterQueueAlarm(
    id: string,
    queue: IQueue,
  ): cloudwatch.Alarm {
    return new cloudwatch.Alarm(this.scope, id, {
      alarmName: this.getAlarmName(
        AlarmPriority.P1,
        `${queue.queueName}-not-empty`,
      ),
      alarmDescription: `SQS dead-letter queue ${queue.queueName} contains messages that failed processing`,
      metric: queue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(constants.DEAD_LETTER_QUEUE_PERIOD_MINUTES),
        statistic: 'Maximum',
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }

  // function and queue names are tokens already scoped to the environment, so
  // they are used as-is - passing a token through getResourceName would prefix
  // the environment a second time
  private getAlarmName(priority: AlarmPriority, name: string): string {
    return `${priority}-${name}`;
  }
}
