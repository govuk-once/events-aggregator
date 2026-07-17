import { Construct } from 'constructs';
import { FactoryBase } from './FactoryBase';
import { INamingProvider } from './namingProviders/INamingProvider';
import * as cdk from 'aws-cdk-lib';
import * as dynamoDB from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';

export type DynamoTableProperties = {
  tableName: string;

  partitionKey: dynamoDB.Attribute;
  sortKey: dynamoDB.Attribute;

  billingMode?: dynamoDB.BillingMode; // defaults to Pay per request
  removalPolicy?: cdk.RemovalPolicy; // defaults to retain
  pointInTimeRecoverySpecification?: dynamoDB.CfnTable.PointInTimeRecoverySpecificationProperty; // defaults to true

  key?: kms.IKey;

  timeToLiveAttribute?: string; // defaults to TTL
  stream?: dynamoDB.StreamViewType; // defaults to no streams

  globalSecodaryIndexes?: Array<{
    indexName: string;
    partitionKey: dynamoDB.Attribute;
    sortKey?: dynamoDB.Attribute;
    projectionType?: dynamoDB.ProjectionType;
  }>;

  localSecondaryIndexes?: Array<{
    indexName: string;
    sortKey: dynamoDB.Attribute;
    projectionType?: dynamoDB.ProjectionType;
  }>;
};

export interface IDynamoTableContract {
  createTable(id: string, props: DynamoTableProperties): dynamoDB.Table;
}

export class DynamoTableFactory
  extends FactoryBase
  implements IDynamoTableContract
{
  constructor(
    private readonly scope: Construct,
    serviceName: string,
    namingProvider?: INamingProvider,
  ) {
    super(serviceName, namingProvider);
  }

  public createTable(id: string, props: DynamoTableProperties): dynamoDB.Table {
    const removalPolicy = props.removalPolicy ?? cdk.RemovalPolicy.RETAIN;

    const encryptionKey =
      props.key ??
      new kms.Key(this.scope, `${this.getResourceId(id)}_key`, {
        enableKeyRotation: true,
        removalPolicy,
      });

    const table = new dynamoDB.Table(this.scope, this.getResourceId(id), {
      tableName: this.getResourceName(props.tableName),
      partitionKey: props.partitionKey,
      sortKey: props.sortKey,

      billingMode: props.billingMode ?? dynamoDB.BillingMode.PAY_PER_REQUEST,
      removalPolicy,

      encryption: dynamoDB.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: encryptionKey,

      timeToLiveAttribute: props.timeToLiveAttribute ?? 'TTL',
      stream: props.stream,
    });

    const cfnTable = table.node.defaultChild as dynamoDB.CfnTable;
    cfnTable.pointInTimeRecoverySpecification =
      props.pointInTimeRecoverySpecification ?? {
        pointInTimeRecoveryEnabled: true,
      };

    props.globalSecodaryIndexes?.forEach((globalIndex) => {
      table.addGlobalSecondaryIndex({
        indexName: globalIndex.indexName,
        partitionKey: globalIndex.partitionKey,
        sortKey: globalIndex.sortKey,
        projectionType: globalIndex.projectionType,
      });
    });

    props.localSecondaryIndexes?.forEach((localIndex) => {
      table.addLocalSecondaryIndex({
        indexName: localIndex.indexName,
        sortKey: localIndex.sortKey,
        projectionType:
          localIndex.projectionType ?? dynamoDB.ProjectionType.ALL,
      });
    });

    return table;
  }
}
