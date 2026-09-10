import { ITopic, Topic } from 'aws-cdk-lib/aws-sns';
import { FactoryBase } from './FactoryBase';
import { INamingProvider } from './namingProviders/INamingProvider';
import { IKey } from 'aws-cdk-lib/aws-kms';
import {
  LoggingLevel,
  SlackChannelConfiguration,
} from 'aws-cdk-lib/aws-chatbot';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

class constants {
  static readonly ENFORCE_SSL: boolean = true;
  static readonly LOGGING_LEVEL: LoggingLevel = LoggingLevel.ERROR;
}

export interface ITopicProperties {
  name: string;
  key?: IKey;
  displayName: string;
  enforceSSL?: boolean;
}

export interface ISlackCHannelProperties {
  name: string;
  workspaceId: string;
  channelId: string;
  topics: ITopic[];
  loggingLevel?: LoggingLevel;
  logRetentionDays?: RetentionDays;
}

export class NotificationFactory extends FactoryBase {
  constructor(
    private readonly scope: Construct,
    serviceName: string,
    namingProvider?: INamingProvider,
  ) {
    super(serviceName, namingProvider);
  }

  public createTopic(id: string, props: ITopicProperties): Topic {
    return new Topic(this.scope, this.getResourceId(id), {
      topicName: this.getResourceName(props.name),
      displayName: props.displayName,
      masterKey: props.key,
      enforceSSL: props.enforceSSL ?? constants.ENFORCE_SSL,
    });
  }

  public createSlackChannel(
    id: string,
    props: ISlackCHannelProperties,
  ): SlackChannelConfiguration {
    return new SlackChannelConfiguration(this.scope, this.getResourceId(id), {
      slackChannelConfigurationName: this.getResourceName(props.name),
      slackWorkspaceId: props.workspaceId,
      slackChannelId: props.channelId,
      notificationTopics: props.topics,
      loggingLevel: props.loggingLevel ?? constants.LOGGING_LEVEL,
      logRetention: props.logRetentionDays,
    });
  }
}
