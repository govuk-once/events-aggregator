import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as destinations from 'aws-cdk-lib/aws-lambda-destinations';
import * as sources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { FactoryBase } from './FactoryBase';
import { INamingProvider } from './namingProviders/INamingProvider';

class constants {
  static readonly ATTRIBUTE_TYPE: dynamodb.AttributeType =
    dynamodb.AttributeType.STRING;
  static readonly BILLING_MODE: dynamodb.BillingMode =
    dynamodb.BillingMode.PAY_PER_REQUEST;
  static readonly POINT_IN_TIME_RECOVERY: boolean = true;
  static readonly DELETION_PROTECTION: boolean = false;
  static readonly REMOVAL_POLICY: cdk.RemovalPolicy = cdk.RemovalPolicy.RETAIN;
  static readonly STREAM_VIEW_TYPE: dynamodb.StreamViewType =
    dynamodb.StreamViewType.NEW_AND_OLD_IMAGES;
  static readonly STARTING_POSITION: lambda.StartingPosition =
    lambda.StartingPosition.LATEST;
  static readonly BATCH_SIZE: number = 10;
  static readonly RETRY_ATTEMPTS: number = 3;
  static readonly BISECT_BATCH_ON_ERROR: boolean = true;
  static readonly REPORT_BATCH_ITEM_FAILURES: boolean = true;
  static readonly ENABLED: boolean = true;
}

/**
 * Configuration for a local secondary index.
 *
 * @param indexName - the name of the index
 * @param sortKeyName - the attribute used as the index sort key
 * @param sortKeyType - optional type of the sort key attribute, defaults to string
 * @param projectionType - optional attributes copied into the index
 * @param nonKeyAttributes - optional attributes projected when the projection type is `INCLUDE`
 */
export interface ILocalSecondaryIndex {
  indexName: string;
  sortKeyName: string;
  sortKeyType?: dynamodb.AttributeType;
  projectionType?: dynamodb.ProjectionType;
  nonKeyAttributes?: string[];
}

/**
 * Configuration for a global secondary index.
 *
 * @param indexName - the name of the index
 * @param partitionKeyName - the attribute used as the index partition key
 * @param partitionKeyType - optional type of the partition key attribute, defaults to string
 * @param sortKeyName - optional attribute used as the index sort key
 * @param sortKeyType - optional type of the sort key attribute, defaults to string
 * @param projectionType - optional attributes copied into the index
 * @param nonKeyAttributes - optional attributes projected when the projection type is `INCLUDE`
 */
export interface IGlobalSecondaryIndex {
  indexName: string;
  partitionKeyName: string;
  partitionKeyType?: dynamodb.AttributeType;
  sortKeyName?: string;
  sortKeyType?: dynamodb.AttributeType;
  projectionType?: dynamodb.ProjectionType;
  nonKeyAttributes?: string[];
}

/**
 * Configuration for the lambda consuming the table stream.
 *
 * @param streamFunction - the lambda invoked with batches of stream records
 * @param startingPosition - optional position in the stream to start reading from
 * @param batchSize - optional maximum number of records delivered in a single invocation
 * @param maxBatchingWindow - optional maximum time to gather records before invoking
 * @param retryAttempts - optional retries for a failed batch before it is discarded
 * @param parallelizationFactor - optional concurrent batches read from a single shard
 * @param bisectBatchOnError - optional split a failing batch in two and retry each half
 * @param reportBatchItemFailures - optional allow the lambda to report individual failed records
 * @param filters - optional event filter patterns, only matching records invoke the lambda
 * @param onFailure - optional queue receiving records that exhaust their retries
 * @param enabled - optional toggle the event source mapping without removing it
 */
export interface IStreamConsumerProperties {
  streamFunction: lambda.IFunction;
  startingPosition?: lambda.StartingPosition;
  batchSize?: number;
  maxBatchingWindow?: cdk.Duration;
  retryAttempts?: number;
  parallelizationFactor?: number;
  bisectBatchOnError?: boolean;
  reportBatchItemFailures?: boolean;
  filters?: Record<string, unknown>[];
  onFailure?: sqs.IQueue;
  enabled?: boolean;
}

/**
 * Configuration for a DynamoDB table.
 *
 * @param name - the name of the table.  the system will ensure the table name is configured for the environment in which it is deployed
 * @param partitionKey - the attribute used as the table partition key
 * @param partitionKeyType - optional type of the partition key attribute, defaults to string
 * @param sortKey - optional attribute used as the table sort key
 * @param sortKeyType - optional type of the sort key attribute, defaults to string
 * @param key - optional customer managed KMS key used to encrypt the table at rest
 * @param billingMode - optional on-demand or provisioned capacity, defaults to on-demand
 * @param pointInTimeRecovery - optional enable continuous backups
 * @param ttlAttributeName - optional attribute holding the expiry timestamp for each item
 * @param stream - optional view type of the table stream.  implied when a stream consumer is supplied
 * @param streamConsumer - optional lambda wired to the table stream see {@link IStreamConsumerProperties}
 * @param localSecondaryIndexes - optional local secondary indexes see {@link ILocalSecondaryIndex}
 * @param globalSecondaryIndexes - optional global secondary indexes see {@link IGlobalSecondaryIndex}
 * @param deletionProtection - optional block the table being deleted
 * @param removalPolicy - optional what happens to the table when it leaves the stack, defaults to retain
 */
export interface ITableProperties {
  name: string;
  partitionKey: string;
  partitionKeyType?: dynamodb.AttributeType;
  sortKey?: string;
  sortKeyType?: dynamodb.AttributeType;
  key?: cdk.aws_kms.IKey;
  billingMode?: dynamodb.BillingMode;
  pointInTimeRecovery?: boolean;
  ttlAttributeName?: string;
  stream?: dynamodb.StreamViewType;
  streamConsumer?: IStreamConsumerProperties;
  localSecondaryIndexes?: ILocalSecondaryIndex[];
  globalSecondaryIndexes?: IGlobalSecondaryIndex[];
  deletionProtection?: boolean;
  removalPolicy?: cdk.RemovalPolicy;
}

/**
 * Result of creating a table wired to a stream consumer.
 *
 * @param table - the table, with its stream enabled
 * @param eventSource - the mapping between the table stream and the consuming lambda
 */
export interface ITableWithStream {
  table: dynamodb.Table;
  eventSource?: sources.DynamoEventSource;
}

/**
 * create a DynamoDB table, optionally streaming its changes to a lambda
 * @param scope - the stack scope which is associated with the building of the table
 */
export class DynamoDbTableFactory extends FactoryBase {
  constructor(
    private readonly scope: Construct,
    serviceName: string,
    namingProvider?: INamingProvider,
  ) {
    super(serviceName, namingProvider);
  }

  /**
   * Create a table and its indexes.  When `streamConsumer` is supplied the table
   * stream is enabled and the lambda is subscribed to it.
   * @param id - a unique identifier for the table within the cdk scope
   * @param props - configuration settings for the table see {@link ITableProperties}
   * @returns the DynamoDB table
   */
  public createTable(id: string, props: ITableProperties): dynamodb.Table {
    const table = new dynamodb.Table(
      this.scope,
      this.getResourceId(id),
      this.buildTableProps(props),
    );

    props.localSecondaryIndexes?.forEach((index) =>
      table.addLocalSecondaryIndex({
        indexName: index.indexName,
        sortKey: this.buildAttribute(index.sortKeyName, index.sortKeyType),
        projectionType: index.projectionType,
        nonKeyAttributes: index.nonKeyAttributes,
      }),
    );

    props.globalSecondaryIndexes?.forEach((index) =>
      table.addGlobalSecondaryIndex({
        indexName: index.indexName,
        partitionKey: this.buildAttribute(
          index.partitionKeyName,
          index.partitionKeyType,
        ),
        sortKey: index.sortKeyName
          ? this.buildAttribute(index.sortKeyName, index.sortKeyType)
          : undefined,
        projectionType: index.projectionType,
        nonKeyAttributes: index.nonKeyAttributes,
      }),
    );

    if (props.streamConsumer)
      this.addStreamConsumer(table, props.streamConsumer);

    return table;
  }

  /**
   * Create a table with its stream enabled and a lambda consuming it.  The
   * lambda is granted read access to the stream.
   * @param id - a unique identifier for the table within the cdk scope
   * @param props - configuration settings for the table, `streamConsumer` is required see {@link ITableProperties}
   * @returns the table and the event source wiring it to the lambda see {@link ITableWithStream}
   */
  public createTableWithStream(
    id: string,
    props: ITableProperties & { streamConsumer?: IStreamConsumerProperties },
  ): ITableWithStream {
    const table = this.createTable(id, {
      ...props,
      stream: props.stream ?? constants.STREAM_VIEW_TYPE,
      streamConsumer: undefined,
    });

    return {
      table,
      ...(props.streamConsumer
        ? { eventSource: this.addStreamConsumer(table, props.streamConsumer) }
        : {}),
    };
  }

  /**
   * Subscribe a lambda to the stream of an existing table and grant it read
   * access to that stream.
   * @param table - a table with its stream enabled
   * @param props - configuration settings for the consumer see {@link IStreamConsumerProperties}
   * @returns the event source mapping the stream to the lambda
   */
  public addStreamConsumer(
    table: dynamodb.ITable,
    props: IStreamConsumerProperties,
  ): sources.DynamoEventSource {
    const eventSource = new sources.DynamoEventSource(table, {
      startingPosition: props.startingPosition ?? constants.STARTING_POSITION,
      batchSize: props.batchSize ?? constants.BATCH_SIZE,
      maxBatchingWindow: props.maxBatchingWindow,
      retryAttempts: props.retryAttempts ?? constants.RETRY_ATTEMPTS,
      parallelizationFactor: props.parallelizationFactor,
      bisectBatchOnError:
        props.bisectBatchOnError ?? constants.BISECT_BATCH_ON_ERROR,
      reportBatchItemFailures:
        props.reportBatchItemFailures ?? constants.REPORT_BATCH_ITEM_FAILURES,
      filters: props.filters,
      onFailure: props.onFailure
        ? new destinations.SqsDestination(props.onFailure)
        : undefined,
      enabled: props.enabled ?? constants.ENABLED,
    });

    props.streamFunction.addEventSource(eventSource);
    table.grantStreamRead(props.streamFunction);

    return eventSource;
  }

  private buildTableProps(props: ITableProperties): dynamodb.TableProps {
    return {
      tableName: this.getResourceName(props.name),
      partitionKey: this.buildAttribute(
        props.partitionKey,
        props.partitionKeyType,
      ),
      sortKey: props.sortKey
        ? this.buildAttribute(props.sortKey, props.sortKeyType)
        : undefined,
      billingMode: props.billingMode ?? constants.BILLING_MODE,
      encryption: props.key
        ? dynamodb.TableEncryption.CUSTOMER_MANAGED
        : dynamodb.TableEncryption.AWS_MANAGED,
      encryptionKey: props.key,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled:
          props.pointInTimeRecovery ?? constants.POINT_IN_TIME_RECOVERY,
      },
      timeToLiveAttribute: props.ttlAttributeName,
      // a consumer is useless without a stream, so enable one when it is omitted
      stream:
        props.stream ??
        (props.streamConsumer ? constants.STREAM_VIEW_TYPE : undefined),
      deletionProtection:
        props.deletionProtection ?? constants.DELETION_PROTECTION,
      removalPolicy: props.removalPolicy ?? constants.REMOVAL_POLICY,
    };
  }

  private buildAttribute = (
    name: string,
    type?: dynamodb.AttributeType,
  ): dynamodb.Attribute => {
    return { name, type: type ?? constants.ATTRIBUTE_TYPE };
  };
}
