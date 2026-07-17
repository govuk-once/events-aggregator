import { describe, test, expect, vi } from 'vitest';
import { App, Stack, aws_kms } from 'aws-cdk-lib';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { LambdaFactory } from './LambdaFunctionFactory';
import { NullNamingProvider } from './namingProviders/NullNamingProvider';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';

vi.spyOn(lambda.Code, 'fromAsset').mockImplementation(() =>
  lambda.Code.fromInline(`exports.hanlder = async => {};`),
);

describe('lambdaFactory', () => {
  const serviceName = 'WAFService';
  const env = (
    process.env.ENVIRONMENT ??
    process.env.USER ??
    'unknown'
  ).replace(/[^a-zA-Z0-9-]/g, '');

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const getEnvironmentVariable = (
    template: Template,
  ): Record<string, string> => {
    const fn = template.findResources('AWS::Lambda::Function');
    const first = Object.values(fn)[0] as any;

    return (first.Properties.Environment.Variables ?? {}) as Record<
      string,
      string
    >;
  };

  test('creates a lambda service naming provider', () => {
    const app = new App();
    const stack = new Stack(app, 'tsetLambda');
    const lambdaFactory = new LambdaFactory(stack, serviceName);
    const logKey = new aws_kms.Key(stack, 'testkey', {});

    lambdaFactory.createLambda('ServiceTemplateHelloFunction', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src/helloworld')),
      description: 'Displays the message "And is a goodnight from him"',
      duration: 10,
      key: logKey,
      handler: 'handler',
      memorySize: 128,
      methods: ['get'],
      name: 'helloWorldFunction',
      path: '/helloworld',
      retentionDays: logs.RetentionDays.ONE_WEEK,
      runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
      skipCheckovRule: 'CKV_AWS_59',
    });

    const template = Template.fromStack(stack);

    //the environment is set
    expect(JSON.stringify(template).includes(env)).toBe(true);

    //the service is set
    expect(JSON.stringify(template).includes(serviceName.toLowerCase())).toBe(
      true,
    );
  });

  test('creates a lambda overriden naming provider', () => {
    const app = new App();
    const stack = new Stack(app, 'tsetLambda');
    const lambdaFactory = new LambdaFactory(
      stack,
      serviceName,
      new NullNamingProvider(),
    );
    const logKey = new aws_kms.Key(stack, 'testkey', {});

    lambdaFactory.createLambda('ServiceTemplateHelloFunction', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src/helloworld')),
      description: 'Displays the message "And is a goodnight from him"',
      duration: 10,
      key: logKey,
      handler: 'handler',
      memorySize: 128,
      methods: ['get'],
      name: 'helloWorldFunction',
      path: '/helloworld',
      retentionDays: logs.RetentionDays.ONE_WEEK,
      runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
      skipCheckovRule: 'CKV_AWS_59',
    });

    const template = Template.fromStack(stack);

    //the environment is set
    expect(JSON.stringify(template)).not.toContain(env);

    //the service is set
    expect(JSON.stringify(template)).not.toContain(serviceName.toLowerCase());
  });

  test('Creates a "sweet Good Night Function"', () => {
    const app = new App();
    const stack = new Stack(app, 'tsetLambda');
    const lambdaFactory = new LambdaFactory(stack, serviceName);
    const logKey = new aws_kms.Key(stack, 'testkey', {});

    lambdaFactory.createLambda('ServiceTemplateHelloFunction', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src/helloworld')),
      description: 'Displays the message "And is a goodnight from him"',
      duration: 10,
      key: logKey,
      handler: 'handler',
      memorySize: 128,
      methods: ['get'],
      name: 'helloWorldFunction',
      path: '/helloworld',
      retentionDays: logs.RetentionDays.ONE_WEEK,
      runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
      skipCheckovRule: 'CKV_AWS_59',
    });

    const template = Template.fromStack(stack);

    template.hasResource('AWS::Lambda::Function', {
      Properties: {
        Description: 'Displays the message "And is a goodnight from him"',
        MemorySize: 128,
      },
    });
    template.hasResource('AWS::Logs::LogGroup', {
      DeletionPolicy: 'Delete',
      Properties: {
        RetentionInDays: 7,
      },
    });
  });
  test('Creates a "hello world function with routing data"', () => {
    const app = new App();
    const stack = new Stack(app, 'tsetLambda');
    const lambdaFactory = new LambdaFactory(stack, serviceName);
    const logKey = new aws_kms.Key(stack, 'testkey', {});

    const lambdaRoute = lambdaFactory.createLambdaWithApiRoute(
      'ServiceTemplateHelloFunction',
      {
        code: lambda.Code.fromAsset(
          path.join(__dirname, '../../src/helloworld'),
        ),
        description: 'Display message "Hello world"',
        duration: 10,
        key: logKey,
        handler: 'handler',
        memorySize: 128,
        methods: ['get'],
        name: 'helloWorldFunction',
        path: '/helloworld',
        retentionDays: logs.RetentionDays.TWO_WEEKS,
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        skipCheckovRule: 'CKV_AWS_59',
      },
    );

    expect(lambdaRoute).toBeDefined();
    expect(lambdaRoute.methods).toEqual(['get']);
    expect(lambdaRoute.path).toEqual('/helloworld');

    const template = Template.fromStack(stack);

    template.hasResource('AWS::Lambda::Function', {
      Properties: {
        Description: 'Display message "Hello world"',
        MemorySize: 128,
      },
    });
    template.hasResource('AWS::Logs::LogGroup', {
      DeletionPolicy: 'Delete',
      Properties: {
        RetentionInDays: 14,
      },
    });
  });

  test('creates a lambda service and adds a variable', () => {
    const app = new App();
    const stack = new Stack(app, 'tsetLambda');
    const lambdaFactory = new LambdaFactory(stack, serviceName);
    const logKey = new aws_kms.Key(stack, 'testkey', {});

    const func = lambdaFactory.createLambda('ServiceTemplateHelloFunction', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src/helloworld')),
      description: 'Displays the message "And is a goodnight from him"',
      duration: 10,
      key: logKey,
      handler: 'handler',
      memorySize: 128,
      methods: ['get'],
      name: 'helloWorldFunction',
      path: '/helloworld',
      retentionDays: logs.RetentionDays.ONE_WEEK,
      runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
      skipCheckovRule: 'CKV_AWS_59',
    });

    lambdaFactory.addEnvironmentVariable(func, {
      name: 'environment',
      value: 'prod',
    });

    const template = Template.fromStack(stack);
    const fnVar = getEnvironmentVariable(template);

    //the environment is set
    expect(fnVar.environment).toBe('prod');
  });

  test('creates a lambda service and adds a variable', () => {
    const app = new App();
    const stack = new Stack(app, 'tsetLambda');
    const lambdaFactory = new LambdaFactory(stack, serviceName);
    const logKey = new aws_kms.Key(stack, 'testkey', {});

    const func = lambdaFactory.createLambda('ServiceTemplateHelloFunction', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src/helloworld')),
      description: 'Displays the message "And is a goodnight from him"',
      duration: 10,
      key: logKey,
      handler: 'handler',
      memorySize: 128,
      methods: ['get'],
      name: 'helloWorldFunction',
      path: '/helloworld',
      retentionDays: logs.RetentionDays.ONE_WEEK,
      runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
      skipCheckovRule: 'CKV_AWS_59',
    });

    lambdaFactory.addEnvironmentVariable(func, {
      name: 'environment',
      value: 'prod',
    });

    const template = Template.fromStack(stack);
    const fnVar = getEnvironmentVariable(template);

    //the environment is set
    expect(fnVar.environment).toBe('prod');
  });

  test('creates a lambda service and adds multiple variable', () => {
    const app = new App();
    const stack = new Stack(app, 'tsetLambda');
    const lambdaFactory = new LambdaFactory(stack, serviceName);
    const logKey = new aws_kms.Key(stack, 'testkey', {});

    const func = lambdaFactory.createLambda('ServiceTemplateHelloFunction', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src/helloworld')),
      description: 'Displays the message "And is a goodnight from him"',
      duration: 10,
      key: logKey,
      handler: 'handler',
      memorySize: 128,
      methods: ['get'],
      name: 'helloWorldFunction',
      path: '/helloworld',
      retentionDays: logs.RetentionDays.ONE_WEEK,
      runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
      skipCheckovRule: 'CKV_AWS_59',
    });

    lambdaFactory.addEnvironmentVariables(func, [
      {
        name: 'environment',
        value: 'prod',
      },
      {
        name: 'table',
        value: 'testtable',
      },
    ]);

    const template = Template.fromStack(stack);
    const fnVar = getEnvironmentVariable(template);

    //the environment is set
    expect(fnVar.environment).toBe('prod');
    expect(fnVar.table).toBe('testtable');
  });
});
