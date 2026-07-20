import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

/**
 * Defines a Lambda route which configures an ApiGateway Router
 * @param path - the path of the route e.g. "/users" or "/users/{id}"
 * @param methods - an array of http verbs for routing e.g. ["get", "post"]
 * @param lambda - the lambda that will process the request
 */
export interface ILambdaRoute {
  path: string;
  methods: string[];
  lambda: lambda.IFunction;
  auth?: apigateway.MethodOptions;
  skipCheckovRule?: string;
}
