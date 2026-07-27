import type { NotificationPayload, TravelAlertScheduleEvent } from '@/types';
import {
  getCountryChanges,
  getNotificationPayload,
  getStartTime,
  getTravelChangesSince,
} from '@/utils';
import { getParameter, SsmParameters } from '@/utils/ssm-client';
import { createUnsMtlsClientFromSecrets } from '@/utils/uns-client';
import { Logger } from '@aws-lambda-powertools/logger';
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';

const logger = new Logger();

export const handler = async (event: TravelAlertScheduleEvent) => {
  try {
    const startTime = getStartTime(event.triggeredAt, event.schedule);
    const travelChanges = await getTravelChangesSince(startTime);

    if (travelChanges.results.length <= 0) {
      logger.info({
        message: `No travel changes found`,
        triggeredAt: event.triggeredAt,
        schedule: event.schedule,
        startTime,
      });
      return false;
    }
    const unsPayload: NotificationPayload[] = [];
    for (const { link } of travelChanges.results) {
      const country = await getCountryChanges(link);

      const countryPayload = getNotificationPayload(
        country,
        startTime,
        event.schedule,
      );

      if (countryPayload) {
        unsPayload.push(countryPayload);
      }
    }

    if (unsPayload.length < 1) {
      logger.info({
        message: `No country changes detected in content API`,
        triggeredAt: event.triggeredAt,
        schedule: event.schedule,
        startTime,
      });
      return false;
    }

    const [apiUrl, certSecretArn, keySecretArn, apiKeySecretArn] =
      await Promise.all([
        getParameter(SsmParameters.UnsApiUrl),
        getParameter(SsmParameters.UnsMtlsCertArn),
        getParameter(SsmParameters.UnsMtlsKeyArn),
        getParameter(SsmParameters.UnsApiKey),
      ]);

    const apiKey = await getSecret<string>(apiKeySecretArn);

    const uns = await createUnsMtlsClientFromSecrets({
      apiUrl,
      certSecretArn,
      keySecretArn,
      apiKey,
    });

    const result = await uns.notification.sendToSubscribers(unsPayload);
    if (!result.ok) {
      logger.error({
        message: `Error from uns api`,
        result: result,
        triggeredAt: event.triggeredAt,
        schedule: event.schedule,
      });
      throw new Error('UNS error');
    }

    return true;
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.error({
        message: error.message,
        triggeredAt: event.triggeredAt,
        schedule: event.schedule,
      });

      throw error;
    }

    logger.error({
      message: 'Unknown error',
      triggeredAt: event.triggeredAt,
      schedule: event.schedule,
    });

    throw error;
  }
};
