import type { NotificationPayload, TravelAlertScheduleEvent } from '@/types';
import {
  getCountryChanges,
  getNotificationPayload,
  getSmmSecret,
  getStartTime,
  getTravelChangesSince,
} from '@/utils';
import { logger, metrics, tracer } from '@/utils/observability';
import { getParameter, SsmParameters } from '@/utils/ssm-client';
import { createUnsMtlsClientFromSecrets } from '@/utils/uns-client';
import { MetricUnit } from '@aws-lambda-powertools/metrics';
import type { Context } from 'aws-lambda';

export const handler = async (
  event: TravelAlertScheduleEvent,
  context: Context,
) => {
  logger.addContext(context);

  const parentSegment = tracer.getSegment();
  const handlerSubsegment = parentSegment?.addNewSubsegment(
    'ProcessTravelChanges',
  );

  if (handlerSubsegment) {
    tracer.setSegment(handlerSubsegment);
    tracer.annotateColdStart();
    tracer.addServiceNameAnnotation();
    handlerSubsegment.addAnnotation('Schedule', event.schedule);
  }

  try {
    const startTime = getStartTime(event.triggeredAt, event.schedule);
    const travelChanges = await getTravelChangesSince(startTime);
    const resultCount = travelChanges.results.length;

    handlerSubsegment?.addAnnotation('TravelAdviceResultCount', resultCount);

    metrics.addMetric(
      'TravelAdviceResultsRetrieved',
      MetricUnit.Count,
      resultCount,
    );

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
        'instant',
      );

      if (countryPayload) {
        unsPayload.push(countryPayload);
      }
    }

    metrics.addMetric(
      'NotificationPayloadsCreated',
      MetricUnit.Count,
      unsPayload.length,
    );

    handlerSubsegment?.addAnnotation(
      'NotificationPayloadCount',
      unsPayload.length,
    );

    if (unsPayload.length < 1) {
      logger.info({
        message: `No country changes detected in content API`,
        triggeredAt: event.triggeredAt,
        schedule: event.schedule,
        startTime,
      });
      return false;
    }

    const [apiUrl, certSecretArn, keySecretArn] = await Promise.all([
      getParameter(SsmParameters.UnsApiUrl),
      getParameter(SsmParameters.UnsMtlsCertArn),
      getParameter(SsmParameters.UnsMtlsKeyArn),
    ]);

    const apiKeySecretArn = process.env.UNS_API_KEY_ARN as string;
    const apiKey = await getSmmSecret(apiKeySecretArn);

    const uns = await createUnsMtlsClientFromSecrets({
      apiUrl,
      certSecretArn,
      keySecretArn,
      apiKey,
    });

    const result = await uns.notification.sendToSubscribers(unsPayload);
    if (!result.ok) {
      metrics.addMetric('NotificationSubmissionFailures', MetricUnit.Count, 1);

      logger.error({
        message: `Error from uns api`,
        result: result,
        triggeredAt: event.triggeredAt,
        schedule: event.schedule,
      });
      throw new Error('UNS error');
    }

    metrics.addMetric(
      'NotificationsSubmitted',
      MetricUnit.Count,
      unsPayload.length,
    );

    return true;
  } catch (error: unknown) {
    const handledError =
      error instanceof Error
        ? error
        : new Error('Unknown travel digestion error', {
            cause: error,
          });

    handlerSubsegment?.addError(handledError);
    tracer.addErrorAsMetadata(handledError);

    logger.error({
      message: handledError.message,
      triggeredAt: event.triggeredAt,
      schedule: event.schedule,
    });

    throw error;
  } finally {
    handlerSubsegment?.close();

    if (parentSegment) {
      tracer.setSegment(parentSegment);
    }

    metrics.publishStoredMetrics();
  }
};
