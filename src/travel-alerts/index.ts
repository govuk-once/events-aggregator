import z from 'zod';
import { ScheduleFrequency } from './types';
import {
  getCountryChanges,
  getNotificationPayload,
  getStartTime,
  getTravelChangesSince,
} from './utils';
import { getConsumerConfig, NonEmptyString } from './utils/config';
import { createUnsRemoteClient } from './utils/uns-client';

const configSchema = z.object({
  AWS_REGION: NonEmptyString,
  FLEX_UNS_CONSUMER_CONFIG_SECRET_ARN: NonEmptyString,
});

export const handler = async (event: {
  triggeredAt: string;
  schedule: ScheduleFrequency;
}) => {
  const startTime = getStartTime(event.triggeredAt, event.schedule);
  const travelChanges = await getTravelChangesSince(startTime);

  if (travelChanges.results.length <= 0) {
    return;
  }
  const unsPayload = [];
  for (const { link } of travelChanges.results) {
    const country = await getCountryChanges(link);

    const countryPayload = getNotificationPayload(
      country,
      startTime,
      event.schedule,
    );

    unsPayload.push(countryPayload);
  }

  const config = configSchema.parse(process.env);

  const consumerConfig = await getConsumerConfig(
    config.FLEX_UNS_CONSUMER_CONFIG_SECRET_ARN,
  );

  const unsClient = createUnsRemoteClient(consumerConfig);

  await unsClient.notification.sendToSubscribers(unsPayload);

  return '';
};
