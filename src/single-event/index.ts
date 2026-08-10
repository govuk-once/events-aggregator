// import { getSmmSecret } from '@/utils';
// import { getParameter, SsmParameters } from '@/utils/ssm-client';
// import { createUnsMtlsClientFromSecrets } from '@/utils/uns-client';
import { MetricUnit } from '@aws-lambda-powertools/metrics';
import type { DynamoDBStreamEvent } from 'aws-lambda';

import { logger, metrics } from '@/utils/observability';

export const handler = async (event: DynamoDBStreamEvent) => {
  try {
    const recordCount = event.Records.length;

    logger.info('single-event', { event });

    metrics.addMetric(
      'EventStoreRecordsReceived',
      MetricUnit.Count,
      recordCount,
    );

    // temp commented out copied from the original solution this will prob be part of this solution
    // const [apiUrl, certSecretArn, keySecretArn] = await Promise.all([
    //   getParameter(SsmParameters.UnsApiUrl),
    //   getParameter(SsmParameters.UnsMtlsCertArn),
    //   getParameter(SsmParameters.UnsMtlsKeyArn),
    // ]);

    // const apiKeySecretArn = process.env.UNS_API_KEY_ARN as string;
    // const apiKey = await getSmmSecret(apiKeySecretArn);

    // const uns = await createUnsMtlsClientFromSecrets({
    //   apiUrl,
    //   certSecretArn,
    //   keySecretArn,
    //   apiKey,
    // });

    // const result = await uns.notification.sendToSubscribers([]);
    // if (!result.ok) {
    //   logger.error({
    //     message: `Error from uns api`,
    //     result: result,
    //     triggeredAt: event.triggeredAt,
    //     schedule: event.schedule,
    //   });
    //   throw new Error('UNS error');
    // }

    return true;
  } catch (error: unknown) {
    const handledError =
      error instanceof Error
        ? error
        : new Error('Unknown EventStore processing error', {
            cause: error,
          });

    logger.error('Failed to process EventStore stream records', {
      error: handledError,
    });

    throw error;
  } finally {
    metrics.publishStoredMetrics();
  }
};
