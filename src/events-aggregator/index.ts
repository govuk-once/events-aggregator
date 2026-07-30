// import { getSmmSecret } from '@/utils';
// import { getParameter, SsmParameters } from '@/utils/ssm-client';
// import { createUnsMtlsClientFromSecrets } from '@/utils/uns-client';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger();

export const handler = async (event: unknown) => {
  logger.info('events-aggregator', { event });
  // const [apiUrl, certSecretArn, keySecretArn] = await Promise.all([
  //       getParameter(SsmParameters.UnsApiUrl),
  //       getParameter(SsmParameters.UnsMtlsCertArn),
  //       getParameter(SsmParameters.UnsMtlsKeyArn),
  //     ]);
  //     const apiKeySecretArn = process.env.UNS_API_KEY_ARN as string;
  //     const apiKey = await getSmmSecret(apiKeySecretArn);
  //     const uns = await createUnsMtlsClientFromSecrets({
  //       apiUrl,
  //       certSecretArn,
  //       keySecretArn,
  //       apiKey,
  //     });
  //     const result = await uns.notification.sendToSubscribers([]);
  //     if (!result.ok) {
  //       logger.error({
  //         message: `Error from uns api`,
  //         result: result,
  //         triggeredAt: event.triggeredAt,
  //         schedule: event.schedule,
  //       });
  //       throw new Error('UNS error');
  //     }
  //     return true;
};
