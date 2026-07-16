export enum GovUkOnceEnvironments {
  Dev = 'dev',
  Test = 'test',
  Stag = 'stag',
  Prod = 'prod',
}

export const serviceMetadata = {
  serviceName: 'events-aggregator',
  teamName: 'govuk-once',
  repositoryUrl: 'https://github.com/govuk-once/events-aggregator',
  version: '0.1.0',
  costCenter: 'govuk-once',
};

export const getEnvironment = (): string => {
  const env = process.env.ENVIRONMENT || process.env.USER;
  if (!env) {
    throw new Error(
      'Unable to determine environment: Neither ENVIRONMENT nor USER environment variables are set',
    );
  }
  return env.replace(/[^a-zA-Z0-9-]/g, '');
};

export const isEphemeralEnvironment = (): boolean => {
  const environment = getEnvironment();
  const nonEphemeral = [GovUkOnceEnvironments.Stag, GovUkOnceEnvironments.Prod];
  return !nonEphemeral.includes(environment as GovUkOnceEnvironments);
};

export const getResourceNamePrefix = (): string => {
  const environment = getEnvironment();
  const prefix = `${environment}-${serviceMetadata.serviceName}`.toLowerCase();
  return prefix.substring(0, 40);
};
