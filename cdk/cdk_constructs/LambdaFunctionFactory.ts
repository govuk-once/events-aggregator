import { Construct } from 'constructs';
import { ILambdaRoute } from './types/ILambdaRoute';
import { FactoryBase } from './FactoryBase';
import { INamingProvider } from './namingProviders/INamingProvider';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';

class constants {
  static readonly MEMORY_SIZE: number = 256;
  static readonly DURATION: number = 10;
  static readonly METHODS: string[] = ['get'];
  static readonly PATHERROR: string = 'PATH NOT SET';
  static readonly RETENTIONDAYS: logs.RetentionDays.TWO_WEEKS;
}

/**
 * Defines additonal properties to the lambda.FunctionProps
 *
 * @param duration - required set maximum run time for the lambda in seconds
 * @param methods - optional set the http verbs to be used when routing via a restful apigateway
 * @param name - the name of the function.  the system will ensure the function name is configured for the environment in which it is deployed
 * @param path - optional sets the path for the restful apigateway
 * @param retentionDays - optional sets the number of day logs will be stored in cloudwatch
 */
export interface ILambdaProperties extends lambda.FunctionProps {
  duration: number;
  key: cdk.aws_kms.Key;
  methods?: string[];
  name: string;
  path?: string;
  retentionDays?: logs.RetentionDays;
  skipCheckovRule?: string;
}

export interface IEnvironmentVariable {
  name: string;
  value: string;
}

/**
 * create a baseic lambda configured as reruired to work with an routing apigateway or a stand allwon lambda
 * @param scope - the stack scope which is assoicated with the building of the gateway
 */
export class LambdaFactory extends FactoryBase {
  constructor(
    private readonly scope: Construct,
    serviceName: string,
    namingProvider?: INamingProvider,
  ) {
    super(serviceName, namingProvider);
  }

  /**
   * Create a lambda function and its assoicated log group
   * @param id - a unique identifier for the lambda with in the cdk scope
   * @param props - configuration setting for the lambda see {!ILambdaProperties}
   * @returns A lambda function
   */
  public createLambda(id: string, props: ILambdaProperties): lambda.Function {
    const namedProps = { ...props };
    namedProps.functionName = `${this.getResourceName(props.name)}`;
    namedProps.timeout = cdk.Duration.seconds(props.duration);

    const log = new logs.LogGroup(
      this.scope,
      `${this.getResourceId(id)}-LogGroup`,
      {
        logGroupName: `/aws/lambda/${this.getResourceName(namedProps.functionName)}`,
        retention: props.retentionDays
          ? props.retentionDays
          : constants.RETENTIONDAYS,
        encryptionKey: props.key,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    );

    namedProps.logGroup = log;

    const newFunction = new lambda.Function(
      this.scope,
      this.getResourceId(id),
      namedProps,
    );

    return newFunction;
  }

  /**
   * Create a lambda function and its assoicated log group
   * @param id - a unique identifier for the lambda with in the cdk scope
   * @param props - configuration setting for the lambda see {!ILambdaProperties}
   * @returns A ILambdaRoute with the path and methods configured as defind i the props
   */
  public createLambdaWithApiRoute(
    id: string,
    props: ILambdaProperties,
  ): ILambdaRoute {
    return {
      path: props.path ? props.path : constants.PATHERROR,
      methods: props.methods ? props.methods : constants.METHODS,
      lambda: this.createLambda(id, props),
      skipCheckovRule: props.skipCheckovRule,
    };
  }

  public addEnvironmentVariable(
    fn: lambda.IFunction,
    variable: IEnvironmentVariable,
  ): void {
    if (this.isLambdaFunction(fn))
      (fn as lambda.Function).addEnvironment(variable.name, variable.value);
  }

  public addEnvironmentVariables(
    fn: lambda.IFunction,
    variables: IEnvironmentVariable[],
  ): void {
    if (this.isLambdaFunction(fn))
      variables.forEach((en) =>
        (fn as lambda.Function).addEnvironment(en.name, en.value),
      );
  }

  private isLambdaFunction = (fn: lambda.IFunction): boolean => {
    return fn instanceof lambda.Function;
  };
}
