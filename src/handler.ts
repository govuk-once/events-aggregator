import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import type { ScheduledEvent } from 'aws-lambda';
import { getChangesForWindow } from './changes/getChangesForWindow.js';
import { getTimeWindow, getUnsConfig, isValidSchedule } from './config.js';
import { buildMessage } from './notifications/messageBuilder.js';
import { publishToUns } from './notifications/unsClient.js';

const REDACTED_FIELDS = new Set([
  'Authorization',
  'x-api-key',
  'x-amz-security-token',
  'sessionToken',
  'accessKeyId',
  'secretAccessKey',
]);

const logger = new Logger({
  serviceName: 'events-aggregator',
  jsonReplacerFn: (key, value) => (REDACTED_FIELDS.has(key) ? '******' : value),
});
const tracer = new Tracer({ serviceName: 'events-aggregator' });

interface HandlerInput {
  schedule?: string;
  dryRun?: boolean;
  country?: string;
  windowStart?: string;
}

interface ResolvedInput {
  schedule: 'asap' | 'daily' | 'weekly';
  dryRun: boolean;
  country: string | undefined;
  windowStart: string;
  unsConfig: ReturnType<typeof getUnsConfig> | undefined;
}

function resolveInput(event: ScheduledEvent): ResolvedInput {
  const input = event as unknown as HandlerInput;

  if (!isValidSchedule(input.schedule)) {
    const sanitised = String(input.schedule ?? '')
      .slice(0, 50)
      .replace(/[\n\r]/g, '');
    throw new Error(`Invalid schedule: ${sanitised}`);
  }

  const schedule = input.schedule;
  const isEphemeral = !['prod', 'stag'].includes(
    process.env.ENVIRONMENT ?? '',
  );
  const dryRun = isEphemeral ? (input.dryRun ?? false) : false;
  const country = isEphemeral ? input.country : undefined;
  const windowStart = isEphemeral
    ? (input.windowStart ?? getTimeWindow(schedule))
    : getTimeWindow(schedule);
  const unsConfig = dryRun ? undefined : getUnsConfig();

  return { schedule, dryRun, country, windowStart, unsConfig };
}

export const handler = async (event: ScheduledEvent): Promise<void> => {
  const segment = tracer.getSegment()!;
  const subsegment = segment.addNewSubsegment('## handler');
  tracer.setSegment(subsegment);

  try {
    const { schedule, dryRun, country, windowStart, unsConfig } =
      resolveInput(event);
    logger.info('Starting poll', { schedule, windowStart, dryRun, country });

    const countryChanges = await getChangesForWindow(
      windowStart,
      logger,
      country,
    );

    if (countryChanges.length === 0) {
      logger.info('No changes detected, exiting');
      return;
    }

    let published = 0;
    for (const { slug, title, changes } of countryChanges) {
      const message = buildMessage(title, slug, schedule, changes, windowStart);

      if (!message) continue;

      const topic = `travel-advice/${slug}/${schedule}`;

      if (dryRun) {
        logger.info('DRY RUN — would publish', {
          topic,
          NotificationTitle: message.NotificationTitle,
          NotificationBody: message.NotificationBody,
          MessageBody: message.MessageBody,
          NotificationID: message.NotificationID,
        });
        published++;
        continue;
      }

      try {
        await publishToUns({ topic, message }, unsConfig!);
        published++;
      } catch (error) {
        logger.error('Failed to publish to UNS', {
          slug,
          topic,
          error: (error as Error).message,
        });
      }
    }

    logger.info('Poll complete', { schedule, published, dryRun: !!dryRun });
    tracer.putAnnotation('schedule', schedule);
    tracer.putAnnotation('published', published);
  } catch (error) {
    subsegment.addError(error as Error);
    throw error;
  } finally {
    subsegment.close();
    tracer.setSegment(segment);
  }
};
