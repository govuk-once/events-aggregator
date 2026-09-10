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

export const releaseNotificationSsmKeys = {
  slackWorkspaceId: 'release-slack-workspace-id',
  slackChannelId: 'release-slack-channel-id',
};

export const ssmPlaceholderValue = (key: string): string =>
  `${key}-placeholder`;
