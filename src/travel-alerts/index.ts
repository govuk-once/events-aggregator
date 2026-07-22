import { NotificationPayload, TravelAlertScheduleEvent } from './types';
import {
  getCountryChanges,
  getNotificationPayload,
  getStartTime,
  getTravelChangesSince,
} from './utils';
import { createUnsRemoteClient, loadConsumerConfig } from './utils/uns-client';
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
      return;
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
      return;
    }

    const config = await loadConsumerConfig(
      process.env.UNS_CONSUMER_CONFIG_SECRET_ARN as string,
    );
    const uns = createUnsRemoteClient(config);

    const result = await uns.subscription.sendToSubscribers(unsPayload);
    if (!result.ok) {
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
    }

    logger.error({
      message: 'Unknown error',
      triggeredAt: event.triggeredAt,
      schedule: event.schedule,
    });
  }
};
