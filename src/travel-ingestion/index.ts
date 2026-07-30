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

    for (const { link } of travelChanges.results) {
      const country = await getCountryChanges(link);

      const countryChanges = getEventsFromCountry(country, startTime);

      if (!countryChanges || countryChanges?.length < 1) {
        logger.info({
          message: `No country changes detected in content API`,
          triggeredAt: event.triggeredAt,
          schedule: event.schedule,
          startTime,
        });
        return false;
      }

      const countryDetails = country.details;

      if (countryChanges && countryChanges?.length > 0) {
        for (const change of countryChanges) {
          const event = travelEventToIncomingEvent(change, countryDetails);
          await sendIncomingEventToQueue(
            event,
            process.env.INCOMING_EVENTS_QUEUE_URL as string,
          );
        }
      }
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
