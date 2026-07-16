import { Logger } from '@aws-lambda-powertools/logger';
import type { ScheduledEvent } from 'aws-lambda';
import { getTimeWindow, getUnsConfig, isValidSchedule } from './config.js';
import { resolveCountry } from './countries/mapping.js';
import { fetchCountriesBatch } from './govuk/contentApi.js';
import { fetchChangedTravelAdvice } from './govuk/searchApi.js';
import { buildMessage } from './notifications/messageBuilder.js';
import { publishToUns } from './notifications/unsClient.js';

const logger = new Logger({ serviceName: 'events-aggregator' });

interface HandlerInput {
  schedule?: string;
  dryRun?: boolean;
  country?: string;
  windowStart?: string;
}

export const handler = async (event: ScheduledEvent): Promise<void> => {
  const input = event as unknown as HandlerInput;

  if (!isValidSchedule(input.schedule)) {
    const sanitised = String(input.schedule ?? '').slice(0, 50).replace(/[\n\r]/g, '');
    logger.error('Invalid schedule input', { schedule: sanitised });
    throw new Error(`Invalid schedule: ${sanitised}`);
  }

  const schedule = input.schedule;
  const isEphemeral = !['prod', 'stag'].includes(process.env.ENVIRONMENT ?? '');
  const dryRun = isEphemeral ? (input.dryRun ?? false) : false;
  const country = isEphemeral ? input.country : undefined;
  const windowStart = isEphemeral
    ? (input.windowStart ?? getTimeWindow(schedule))
    : getTimeWindow(schedule);
  const unsConfig = dryRun ? undefined : getUnsConfig();
  logger.info('Starting poll', { schedule, windowStart, dryRun, country });

  const searchResponse = await fetchChangedTravelAdvice(windowStart);
  logger.info('Search API returned results', {
    total: searchResponse.total,
    count: searchResponse.results.length,
  });

  if (searchResponse.results.length === 0) {
    logger.info('No changes detected, exiting');
    return;
  }

  const supportedSlugs: string[] = [];
  for (const result of searchResponse.results) {
    const contentId = result.content_id;
    if (!contentId) continue;

    const resolved = resolveCountry(contentId);

    if (resolved.status === 'unknown') {
      logger.warn('Unknown country detected', {
        event: 'unknown_country',
        content_id: contentId,
        title: result.title,
        link: result.link,
      });
      continue;
    }

    if (resolved.status === 'unsupported') continue;

    if (country && resolved.country.slug !== country) continue;

    supportedSlugs.push(resolved.country.slug);
  }

  if (supportedSlugs.length === 0) {
    logger.info('No supported countries changed, exiting');
    return;
  }

  logger.info('Fetching content for changed countries', {
    count: supportedSlugs.length,
  });

  const contentResults = await fetchCountriesBatch(
    supportedSlugs,
    (slug, error) => {
      logger.error('Failed to fetch content', {
        slug,
        error: error.message,
      });
    },
  );

  let published = 0;
  for (const [slug, content] of contentResults) {
    const changeHistory = content.details.change_history ?? [];
    const message = buildMessage(
      content.title,
      slug,
      schedule,
      changeHistory,
      windowStart,
    );

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
};
