import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { FactoryBase } from './FactoryBase';
import { INamingProvider } from './namingProviders/INamingProvider';

export class DashboardFactory extends FactoryBase {
  constructor(
    private readonly scope: Construct,
    serviceName: string,
    namingProvider?: INamingProvider,
  ) {
    super(serviceName, namingProvider);
  }

  public createOverviewDashboard(props: {
    ingestion: lambda.Function;
    processing: lambda.Function;
    singleEvent: lambda.Function;
    aggregatedEvent: lambda.Function;
  }) {
    // Lambda config for widgets
    const lambdaConfigs = [
      {
        name: props.ingestion.functionName,
        metricTitle: 'Errors, Invocations - ingestion',
        logTitle: 'Ingestion logs',
        logGroup: props.ingestion.logGroup,
      },
      {
        name: props.processing.functionName,
        metricTitle: 'Errors, Invocations - event processing',
        logTitle: 'Event processing',
        logGroup: props.processing.logGroup,
      },
      {
        name: props.singleEvent.functionName,
        metricTitle: 'Errors, Invocations - single event',
        logTitle: 'Single event',
        logGroup: props.singleEvent.logGroup,
      },
      {
        name: props.aggregatedEvent.functionName,
        metricTitle: 'Errors, Invocations - aggregated event',
        logTitle: 'Aggregated event',
        logGroup: props.aggregatedEvent.logGroup,
      },
    ];

    const metricWidgets: cloudwatch.IWidget[] = [];
    const logWidgets: cloudwatch.IWidget[] = [];

    for (const config of lambdaConfigs) {
      // 1. Bar Chart Metric Widget
      const invocations = new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Invocations',
        dimensionsMap: { FunctionName: config.name },
        statistic: 'Average',
        period: cdk.Duration.seconds(300),
        region: cdk.Stack.of(this.scope).region,
      });

      const errors = new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Errors',
        dimensionsMap: { FunctionName: config.name },
        statistic: 'Average',
        period: cdk.Duration.seconds(300),
        region: cdk.Stack.of(this.scope).region,
      });

      metricWidgets.push(
        new cloudwatch.GraphWidget({
          title: config.metricTitle,
          width: 6,
          height: 6,
          view: cloudwatch.GraphWidgetView.BAR,
          stacked: true,
          left: [invocations, errors],
          region: cdk.Stack.of(this.scope).region,
        }),
      );

      // 2. Log Query Widget
      logWidgets.push(
        new cloudwatch.LogQueryWidget({
          title: config.logTitle,
          width: 6,
          height: 15,
          logGroupNames: [`/aws/lambda/${config.name}`],
          queryLines: [
            'fields @timestamp, @message',
            'sort @timestamp desc',
            'limit 10000',
          ],
          region: cdk.Stack.of(this.scope).region,
        }),
      );
    }

    // Assemble Dashboard
    const dashboard = new cloudwatch.Dashboard(
      this.scope,
      'EventsAggregatorDashboard',
      {
        dashboardName: this.getResourceName(`overview`),
      },
    );

    // Row 1: Metrics (4 x 6 width = 24 total grid width)
    dashboard.addWidgets(...metricWidgets);

    // Row 2: Logs (4 x 6 width = 24 total grid width)
    dashboard.addWidgets(...logWidgets);
  }
}
