import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { RestApi } from 'aws-cdk-lib/aws-apigateway';
import { Duration } from 'aws-cdk-lib';

import { FactoryBase } from './FactoryBase';
import { INamingProvider } from './namingProviders/INamingProvider';

export interface IStandardServiceAlarmsProps {
  restApis: RestApi[];
  lambdas: IFunction[];
  alarmTopic: sns.ITopic;

  apiGateway5xxThresholdPercent?: number;
  lambdaErrorThresholdPercent?: number;
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

    const apiThreshold = props.apiGateway5xxThresholdPercent ?? 5;
    const lambdaThreshold = props.lambdaErrorThresholdPercent ?? 1;
    const periodMinutes = props.evaluationPeriodMinutes ?? 5;
    const evaluationPeriods = props.evaluationPeriods ?? 1;

    props.restApis.forEach((api, index) => {
      const alarm = this.createApiGateway5xxAlarm(
        `${id}-5xx-${index}`,
        api,
        apiThreshold,
        periodMinutes,
        evaluationPeriods,
      );
      alarm.addAlarmAction(new cloudwatchActions.SnsAction(props.alarmTopic));
      alarm.addOkAction(new cloudwatchActions.SnsAction(props.alarmTopic));
      alarms.push(alarm);
    });

    props.lambdas.forEach((fn, index) => {
      const alarm = this.createLambdaErrorAlarm(
        `${id}-err-${index}`,
        fn,
        lambdaThreshold,
        periodMinutes,
        evaluationPeriods,
      );
      alarm.addAlarmAction(new cloudwatchActions.SnsAction(props.alarmTopic));
      alarm.addOkAction(new cloudwatchActions.SnsAction(props.alarmTopic));
      alarms.push(alarm);
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
      alarmName: this.getResourceName(`${api.restApiName}-5xx-error-rate`),
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
      alarmName: this.getResourceName(`${fn.functionName}-error-rate`),
      alarmDescription: `Lambda ${fn.functionName} error rate exceeds ${thresholdPercent}%`,
      metric: errorRate,
      threshold: thresholdPercent,
      evaluationPeriods,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }
}
