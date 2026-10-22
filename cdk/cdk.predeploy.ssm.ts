import {
  PutSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import {
  DeleteParametersCommand,
  GetParameterCommand,
  PutParameterCommand,
  SSMClient,
} from '@aws-sdk/client-ssm';
import {
  alertsNotificationSsmKeys,
  getEnvironment,
  ISlackChannelSsmKeys,
  releaseNotificationSsmKeys,
  serviceMetadata,
  ssmPlaceholderValue,
} from './constants/environments.js';

const unwrap = async <Result>(
  promise: Promise<Result>,
): Promise<[Result, undefined] | [undefined, Error]> => {
  try {
    return [await promise, undefined];
  } catch (error) {
    return [undefined, error as Error];
  }
};

const env = getEnvironment();
const namespace = `ea-runner`;

// A Slack channel is identified by a workspace id and a channel id.  Both are
// seeded with a placeholder - the CDK stack holds the Slack integration back
// until the real values are supplied through SSM_PARAMETERS_TO_UPDATE.
const slackChannelParameters = (
  keys: ISlackChannelSsmKeys,
): Record<string, string> =>
  Object.fromEntries(
    Object.values(keys).map((key) => [key, ssmPlaceholderValue(key)]),
  );

export const configurableParameters: Record<string, string> = {
  'govuk-feed-url': 'https://www.gov.uk/api/search.json',
  'uns-mtls-cert-arn': 'uns-mtls-cert-arn-placeholder',
  'uns-mtls-key-arn': 'uns-mtls-key-arn-placeholder',
  'uns-api-url': 'uns-api-url-placeholder',
  'uns-kms-key-arn': 'uns-kms-key-arn-placeholder',
  ...slackChannelParameters(releaseNotificationSsmKeys),
  ...slackChannelParameters(alertsNotificationSsmKeys),
};

// uns-api-key was previously seeded as an SSM parameter but the runtime reads
// it from Secrets Manager via UNS_API_KEY_ARN.  Remove it from SSM.
export const parametersForDeletion: string[] = ['uns-api-key'];

// Secrets Manager secrets that can be updated via SM_SECRETS_TO_UPDATE.
// Keys are short names; values are the full SM secret names created by CDK.
export const configurableSecrets: Record<string, string> = {
  'uns-api-key': `ea-${env}/uns-api-key`,
};

const SSM_PARAMETERS_TO_UPDATE = JSON.parse(
  process.env.SSM_PARAMETERS_TO_UPDATE || '{}',
) as Record<string, string>;

const SM_SECRETS_TO_UPDATE = JSON.parse(
  process.env.SM_SECRETS_TO_UPDATE || '{}',
) as Record<string, string>;

await (async () => {
  const ssmClient = new SSMClient();
  console.log(`Checking SSM Parameter existence`);

  for (const [key, defaultValue] of Object.entries(configurableParameters)) {
    const fullKey = `/${namespace}/${key}`;

    process.stdout.write(`Checking ${fullKey}  `.padEnd(96, ' '));

    const [getParamResult] = await unwrap(
      ssmClient.send(
        new GetParameterCommand({
          Name: fullKey,
          WithDecryption: true,
        }),
      ),
    );

    if (getParamResult?.Parameter?.Value !== undefined) {
      console.log(` - Exists`);

      if (SSM_PARAMETERS_TO_UPDATE[key]) {
        console.log(`SSM_PARAMETERS_TO_UPDATE contains entry - updating`);

        const [, putParameterError] = await unwrap(
          ssmClient.send(
            new PutParameterCommand({
              Name: fullKey,
              Value: SSM_PARAMETERS_TO_UPDATE[key],
              Type: 'String',
              Overwrite: true,
              Description: `Note: This parameter has been created post CDK deployment - ${env}`,
            }),
          ),
        );

        if (putParameterError) {
          console.error(` - Failed to update param`);
        } else {
          console.log(` - Param updated`);
        }
      }
    }

    if (getParamResult?.Parameter?.Value === undefined) {
      console.log(` - Does not exists... creating`);

      const [, putParameterError] = await unwrap(
        ssmClient.send(
          new PutParameterCommand({
            Name: fullKey,
            Value: SSM_PARAMETERS_TO_UPDATE[key] ?? defaultValue,
            Type: 'String',
            Overwrite: false,
            Description: `Note: This parameter has been created post CDK deployment - ${env}`,
            Tags: Object.entries({
              ServiceName: serviceMetadata.serviceName,
              Environment: env,
              ManagedBy: 'predeploy-script',
            }).map(([Key, Value]) => ({ Key, Value })),
          }),
        ),
      );

      if (putParameterError) {
        console.error(` - Failed to create param`);
      } else {
        console.log(` - Param created`);
      }
    }
  }

  const keysToDelete: string[] = [];
  for (const deprecatedKey of parametersForDeletion) {
    const fullKey = `/${namespace}/${deprecatedKey}`;
    try {
      console.log(`Checking if ${deprecatedKey} still exist in namespace.`);
      await ssmClient.send(
        new GetParameterCommand({
          Name: fullKey,
          WithDecryption: true,
        }),
      );
      console.log(`Parameter ${deprecatedKey} still exist in namespace.`);
      keysToDelete.push(fullKey);
    } catch (error) {
      if (!(error instanceof Error && error.name === 'ParameterNotFound')) {
        throw error;
      }
    }
  }

  if (keysToDelete.length > 0) {
    console.log(`Deleting deprecated parameters from namespace.`);
    await ssmClient.send(
      new DeleteParametersCommand({
        Names: keysToDelete,
      }),
    );
  }

  console.log(`\nProcessing Secrets Manager updates`);
  const smClient = new SecretsManagerClient();

  for (const [key, newValue] of Object.entries(SM_SECRETS_TO_UPDATE)) {
    const secretName = configurableSecrets[key];

    if (!secretName) {
      console.warn(
        `SM_SECRETS_TO_UPDATE contains unknown key: ${key} - skipping`,
      );
      continue;
    }

    process.stdout.write(`Updating ${secretName}  `.padEnd(96, ' '));

    const [, putSecretError] = await unwrap(
      smClient.send(
        new PutSecretValueCommand({
          SecretId: secretName,
          SecretString: newValue,
        }),
      ),
    );

    if (putSecretError) {
      console.error(` - Failed to update secret: ${key}`);
    } else {
      console.log(` - Secret updated: ${key}`);
    }
  }
})();
