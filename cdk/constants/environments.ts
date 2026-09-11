// define environments
export enum GovUkOnceEnvironments {
  Dev = 'dev',
  Test = 'test',
  Stag = 'stag',
  Prod = 'prod',
}

export enum GovUkOnceFullEnvironments {
  Dev = 'development',
  Test = 'testing',
  Stag = 'staging',
  Prod = 'production',
}

// define service metadata
export const serviceMetadata = {
  serviceName: 'events-aggregator',
  teamName: 'events-aggregator-team',
  repositoryUrl: 'https://github.com/govuk-once/events-aggregator',
  version: process.env.VERSION ?? '0.1.0',
  costCenter: 'update-me',
};

// get environment
export const getEnvironment = (): string => {
  const env = process.env.ENVIRONMENT || process.env.USER;
  if (!env) {
    throw new Error(
      'Unable to determine environment: Neither ENVIRONMENT nor USER environment variables are set',
    );
  }
  return env.replace(/[^a-zA-Z0-9-]/g, '');
};

const PULL_REQUEST_ENVIRONMENT = /^pr-(\d+)$/;

export const isPullRequestEnvironment = (): boolean =>
  PULL_REQUEST_ENVIRONMENT.test(getEnvironment());

export const getPullRequestNumber = (): string | undefined =>
  PULL_REQUEST_ENVIRONMENT.exec(getEnvironment())?.[1];

// the long lived environments the pipeline deploys to.  anything else - a
// developer's own stack, or a per pull request stack - is a sandbox
const DEPLOYED_ENVIRONMENTS: string[] = [
  ...Object.values(GovUkOnceEnvironments),
  ...Object.values(GovUkOnceFullEnvironments),
];

export const isSandboxEnvironment = (): boolean =>
  !DEPLOYED_ENVIRONMENTS.includes(getEnvironment());

// identify if is ephemeral environment
export const isEphemeralEnvironment = (): boolean => {
  const environment = getEnvironment();
  const nonEphemeral = [GovUkOnceEnvironments.Stag, GovUkOnceEnvironments.Prod];
  return !nonEphemeral.includes(environment as GovUkOnceEnvironments);
};

// get resource name prefix
export const getResourceNamePrefix = (): string => {
  const environment = getEnvironment();
  const prefix = `${environment}-${serviceMetadata.serviceName}`.toLowerCase();
  return prefix.substring(0, 40);
};

// generate a 5 string alphanumeric unique id
export const generateUniqueId = (): string => {
  return Math.random().toString(36).substring(2, 7);
};

// SSM keys, in the shared namespace, identifying a Slack channel
export interface ISlackChannelSsmKeys {
  slackWorkspaceId: string;
  slackChannelId: string;
}

// the channel deployment announcements go to
export const releaseNotificationSsmKeys: ISlackChannelSsmKeys = {
  slackWorkspaceId: 'release-slack-workspace-id',
  slackChannelId: 'release-slack-channel-id',
};

// the channel CloudWatch alarm notifications go to
export const alertsNotificationSsmKeys: ISlackChannelSsmKeys = {
  slackWorkspaceId: 'alerts-slack-workspace-id',
  slackChannelId: 'alerts-slack-channel-id',
};

// the value a configurable parameter is seeded with until the real one arrives
export const ssmPlaceholderValue = (key: string): string =>
  `${key}-placeholder`;
