import { getEventSourceByCompositeKeys } from '@/services/eventSources';
import type { TravelAlertScheduleEvent } from '@/types';
import {
  getCountryChanges,
  getEventsFromCountry,
  getStartTime,
  getTravelChangesSince,
} from '@/utils';
import {
  sendIncomingEventToQueue,
  travelEventToIncomingEvent,
} from '@/utils/sqs';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger();

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
  }
};
