import { Construct } from 'constructs';
import { FactoryBase } from './FactoryBase';
import { INamingProvider } from './namingProviders/INamingProvider';
import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';

class constants {
  static readonly VISIBILITY_TIMEOUT: cdk.Duration = cdk.Duration.seconds(30);
  static readonly RETENTION_PERIOD: cdk.Duration = cdk.Duration.days(4);
  static readonly MAX_RECEIVE_COUNT: number = 3;
  static readonly DLQ_SUFFIX: string = 'dlq';
  static readonly ENFORCE_SSL: boolean = true;
}

/**
 * Result of creating a queue with an attached dead-letter queue.
 *
 * @param queue - the primary queue
 * @param deadLetterQueue - the dead-letter queue receiving failed messages
 */
export interface IQueueWithDlq {
  queue: sqs.Queue;
  deadLetterQueue: sqs.Queue;
}

/**
 * Configuration for an SQS queue.
 *
 * @param name - the name of the queue.  the system will ensure the queue name is configured for the environment in which it is deployed
 * @param key - optional customer managed KMS key used to encrypt messages at rest
 * @param visibilityTimeout - optional time a message stays hidden after being received
 * @param retentionPeriod - optional how long messages are retained in the queue
 * @param deliveryDelay - optional delay before messages become available for delivery
 * @param fifo - optional create a FIFO queue (the `.fifo` suffix is applied automatically)
 * @param contentBasedDeduplication - optional FIFO only, derive the dedup id from the message body
 * @param maxReceiveCount - optional receives before a message is moved to the dead-letter queue
 * @param enforceSSL - optional reject requests made over plain HTTP
 */
export interface IQueueProperties {
  name: string;
  key?: cdk.aws_kms.IKey;
  visibilityTimeout?: cdk.Duration;
  retentionPeriod?: cdk.Duration;
  deliveryDelay?: cdk.Duration;
  fifo?: boolean;
  contentBasedDeduplication?: boolean;
  maxReceiveCount?: number;
  enforceSSL?: boolean;
}

/**
 * create an SQS queue, optionally paired with a dead-letter queue
 * @param scope - the stack scope which is associated with the building of the queue
 */
export class SqsQueueFactory extends FactoryBase {
  constructor(
    private readonly scope: Construct,
    serviceName: string,
    namingProvider?: INamingProvider,
  ) {
    super(serviceName, namingProvider);
  }

  /**
   * Create a standalone queue
   * @param id - a unique identifier for the queue within the cdk scope
   * @param props - configuration settings for the queue see {@link IQueueProperties}
   * @returns the SQS queue
   */
  public createQueue(id: string, props: IQueueProperties): sqs.Queue {
    return new sqs.Queue(
      this.scope,
      this.getResourceId(id),
      this.buildQueueProps(props),
    );
  }

  /**
   * Create a queue with an attached dead-letter queue.  Messages that fail to be
   * processed `maxReceiveCount` times are moved to the dead-letter queue.
   * @param id - a unique identifier for the queue within the cdk scope
   * @param props - configuration settings for the queue see {@link IQueueProperties}
   * @returns the primary queue and its dead-letter queue see {@link IQueueWithDlq}
   */
  public createQueueWithDeadLetter(
    id: string,
    props: IQueueProperties,
  ): IQueueWithDlq {
    const deadLetterQueue = new sqs.Queue(
      this.scope,
      this.getResourceId(`${id}-${constants.DLQ_SUFFIX}`),
      this.buildQueueProps({
        ...props,
        name: `${props.name}-${constants.DLQ_SUFFIX}`,
      }),
    );

    const queue = new sqs.Queue(this.scope, this.getResourceId(id), {
      ...this.buildQueueProps(props),
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: props.maxReceiveCount ?? constants.MAX_RECEIVE_COUNT,
      },
    });

    return { queue, deadLetterQueue };
  }

  private buildQueueProps(props: IQueueProperties): sqs.QueueProps {
    const fifo = props.fifo ?? false;
    const baseName = this.getResourceName(props.name);

    return {
      queueName: fifo ? `${baseName}.fifo` : baseName,
      fifo: fifo || undefined,
      contentBasedDeduplication: fifo
        ? props.contentBasedDeduplication
        : undefined,
      encryption: props.key
        ? sqs.QueueEncryption.KMS
        : sqs.QueueEncryption.SQS_MANAGED,
      encryptionMasterKey: props.key,
      visibilityTimeout:
        props.visibilityTimeout ?? constants.VISIBILITY_TIMEOUT,
      retentionPeriod: props.retentionPeriod ?? constants.RETENTION_PERIOD,
      deliveryDelay: props.deliveryDelay,
      enforceSSL: props.enforceSSL ?? constants.ENFORCE_SSL,
    };
  }
}