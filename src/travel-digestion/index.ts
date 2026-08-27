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
import {
  sendIncomingEventToQueue,
  travelEventToIncomingEvent,
} from '@/utils/sqs';
import { MetricUnit } from '@aws-lambda-powertools/metrics';

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
const TRAVEL_ADVICE_PREFIX = 'foreign-travel-advice';

/** `/foreign-travel-advice/myanmar?x=1#y` -> `travel/myanmar`; null if not a country page. */
const compositeKeyFromLink = (link: string): string | null => {
  const path = link.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  const segments = path.split('/').filter(Boolean);
  const index = segments.indexOf(TRAVEL_ADVICE_PREFIX);

  const slug = index === -1 ? undefined : segments[index + 1];

  return slug ? `travel/${slug}` : null;
};
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
  const country = await segment(tracer, 'GetCountryChanges', async () =>
    getCountryChanges(source.URL),
  );

  const countryChanges = getEventsFromCountry(country, startTime);

  if (!countryChanges?.length) {
    logger.info({
      message: 'No country changes detected in content API',
      ...context,
    });
    return;
  }

  await segment(tracer, 'PublishCountryChanges', async (subsegment) => {
    subsegment.addAnnotation('EventCount', countryChanges.length);

    await publishCountryChanges(countryChanges, country.details);
  });

  metrics.addMetric(
    'TravelEventsQueued',
    MetricUnit.Count,
    countryChanges.length,
  );
};

export const handler = async (event: TravelAlertScheduleEvent) => {
  try {
    const startTime = getStartTime(event.triggeredAt, event.schedule);
    const context = scheduleContext(event, startTime);
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

    if (resultCount < 1) {
      logger.info({ message: 'No travel changes found', ...context });
      return false;
    }

    const compositeKeys = [
      ...new Set(
        travelChanges.results
          .map(({ link }) => compositeKeyFromLink(link))
          .filter((key): key is string => key !== null),
      ),
    ];

    if (compositeKeys.length < 1) {
      logger.info({ message: 'No usable composite keys derived', ...context });
      return false;
    }

    const sources = await segment(tracer, 'GetEventSources', async () =>
      getEventSourceByCompositeKeys(
        compositeKeys,
        process.env.SOURCE_TABLE_NAME as string,
      ),
    );

    metrics.addMetric(
      'EventSourcesRetrieved',
      MetricUnit.Count,
      sources.length,
    );

    if (sources.length < 1) {
      logger.info({ message: 'No sources detected', ...context });
      return false;
    }

    // A disabled or empty source skips that country only — it must not stop
    // the countries queued behind it.
    for (const source of sources) {
      if (source.sourceEnabled) {
        await processSource(source, startTime, context);
      }
    }

    return true;
  } catch (error: unknown) {
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
