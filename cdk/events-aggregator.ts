import * as cdk from 'aws-cdk-lib/core';
import { EventsAggregatorStack } from './stacks/events-aggregator-stack';
import { getEnvironment, getResourceNamePrefix } from './constants/environment';
import { serviceMetadata } from './constants/environment';

const app = new cdk.App();

new EventsAggregatorStack(app, 'EventsAggregatorStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'eu-west-2',
  },
  description: 'Travel advice change aggregator and notification publisher',
  stackName: `${getResourceNamePrefix()}-Stack`,
  serviceName: serviceMetadata.serviceName,
  teamName: serviceMetadata.teamName,
  repositoryUrl: serviceMetadata.repositoryUrl,
  version: serviceMetadata.version,
  costCenter: serviceMetadata.costCenter,
  environment: getEnvironment(),
});
