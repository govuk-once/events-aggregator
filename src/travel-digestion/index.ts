import { getEventSourceByCompositeKeys } from '@/services/eventSources';
import type { TravelAlertScheduleEvent } from '@/types';
import {
  getCountryChanges,
  getEventsFromCountry,
  getStartTime,
  getTravelChangesSince,
} from '@/utils';
import { logger, metrics, tracer } from '@/utils/observability';
import { segment } from '@/utils/segment';
import { getParameter, SsmParameters } from '@/utils/ssm-client';
import { createUnsMtlsClientFromSecrets } from '@/utils/uns-client';
import { MetricUnit } from '@aws-lambda-powertools/metrics';
import type { Context } from 'aws-lambda';
import {
  sendIncomingEventToQueue,
  travelEventToIncomingEvent,
} from '@/utils/sqs';
import { Logger } from '@aws-lambda-powertools/logger';

export const handler = async (
  event: TravelAlertScheduleEvent,
  context: Context,
) => {
  logger.addContext(context);

  try {
    const startTime = getStartTime(event.triggeredAt, event.schedule);

    const travelChanges = await segment(
      tracer,
      'GetTravelChanges',
      async (subsegment) => {
        subsegment.addAnnotation('Schedule', event.schedule);

        return getTravelChangesSince(startTime);
      },
    );

    const resultCount = travelChanges.results.length;

    metrics.addMetric(
      'TravelAdviceResultsRetrieved',
      MetricUnit.Count,
      resultCount,
    );

    if (resultCount === 0) {
      logger.info({
        message: 'No travel changes found',
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

    if (unsPayload.length === 0) {
      logger.info({
        message: 'No country changes detected in content API',
        triggeredAt: event.triggeredAt,
        schedule: event.schedule,
        startTime,
      });

// Derived from the utils rather than re-declared, so these cannot drift.
// Swap in the named types from '@/types' if they are exported.
type StartTime = ReturnType<typeof getStartTime>;
type Country = Awaited<ReturnType<typeof getCountryChanges>>;
type CountryChanges = NonNullable<ReturnType<typeof getEventsFromCountry>>;
type EventSource = Awaited<
  ReturnType<typeof getEventSourceByCompositeKeys>
>[number];

/** Context repeated on every log line so a scheduled run can be traced. */
const scheduleContext = (
  event: TravelAlertScheduleEvent,
  startTime: StartTime,
) => ({
  triggeredAt: event.triggeredAt,
  schedule: event.schedule,
  startTime,
});

type ScheduleContext = ReturnType<typeof scheduleContext>;

/** `/foreign-travel-advice/myanmar` -> `travel/myanmar`. */
const compositeKeyFromLink = (link: string): string =>
  `travel/${link.split('/').at(-1)}`;

/**
 * Published one at a time on purpose: the queue is the slow path and a burst
 * of parallel sends buys nothing here.
 */
const publishCountryChanges = async (
  changes: CountryChanges,
  countryDetails: Country['details'],
): Promise<void> => {
  for (const change of changes) {
    const incomingEvent = travelEventToIncomingEvent(change, countryDetails);
    await sendIncomingEventToQueue(
      incomingEvent,
      process.env.INCOMING_EVENTS_QUEUE_URL as string,
    );
  }
};

/** Fetch one country's advice and queue whatever changed since `startTime`. */
const processSource = async (
  source: EventSource,
  startTime: StartTime,
  context: ScheduleContext,
): Promise<void> => {
  const country = await getCountryChanges(source.URL);
  const countryChanges = getEventsFromCountry(country, startTime);

  if (!countryChanges?.length) {
    logger.info({
      message: 'No country changes detected in content API',
      ...context,
    });
    return;
  }

  await publishCountryChanges(countryChanges, country.details);
};

export const handler = async (event: TravelAlertScheduleEvent) => {
  try {
    const startTime = getStartTime(event.triggeredAt, event.schedule);
    const context = scheduleContext(event, startTime);
    const travelChanges = await getTravelChangesSince(startTime);

    if (travelChanges.results.length < 1) {
      logger.info({ message: 'No travel changes found', ...context });
      return false;
    }

    const compositeKeys = travelChanges.results.map(({ link }) =>
      compositeKeyFromLink(link),
    );

    const sources = await getEventSourceByCompositeKeys(
      compositeKeys,
      process.env.SOURCE_TABLE_NAME as string,
    );

    if (sources.length < 1) {
      logger.info({ message: 'No sources detected', ...context });
      return false;
    }

    const result = await segment(
      tracer,
      'SubmitNotifications',
      async (subsegment) => {
        subsegment.addAnnotation('NotificationCount', unsPayload.length);

        return uns.notification.sendToSubscribers(unsPayload);
      },
    );

    if (!result.ok) {
      metrics.addMetric('NotificationSubmissionFailures', MetricUnit.Count, 1);

      logger.error({
        message: 'Error from uns api',
        result,
        triggeredAt: event.triggeredAt,
        schedule: event.schedule,
      });

      throw new Error('UNS error');
    // A disabled or empty source skips that country only — it must not stop
    // the countries queued behind it.
    for (const source of sources) {
      if (source.sourceEnabled) {
        await processSource(source, startTime, context);
      }
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

    tracer.addErrorAsMetadata(handledError);

    logger.error({
      message: handledError.message,
    logger.error({
      message: error instanceof Error ? error.message : 'Unknown error',
      triggeredAt: event.triggeredAt,
      schedule: event.schedule,
    });

    throw error;
  } finally {
    metrics.publishStoredMetrics();
  }
};
