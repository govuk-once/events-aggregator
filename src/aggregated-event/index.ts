import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import type { NotificationPayload } from '@/types';
import type {
  DigestCadence,
  DigestScheduleEvent,
  DynamoEvent,
} from '@/types/event';
import { getSmmSecret } from '@/utils';
import { logger, metrics, tracer } from '@/utils/observability';
import { segment } from '@/utils/segment';
import { getParameter, SsmParameters } from '@/utils/ssm-client';
import { createUnsMtlsClientFromSecrets } from '@/utils/uns-client';

const CADENCE_KEY_MAP: Record<DigestCadence, 'DAILY' | 'WEEKLY'> = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
};

const client = tracer.captureAWSv3Client(new DynamoDBClient({}));

const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});

/** Timestamp cutoff for the given digest cadence. */
export const getDigestStartTime = (
  now: string,
  cadence: DigestCadence,
): string => {
  const date = new Date(now);

  switch (cadence) {
    case 'daily':
      date.setUTCDate(date.getUTCDate() - 1);
      break;
    case 'weekly':
      date.setUTCDate(date.getUTCDate() - 7);
      break;
  }

  return date.toISOString();
};

/**
 * Query eventStore for travel events within the requested time window
 * that have not yet been processed for this digest cadence.
 */
export const queryUnprocessedEvents = async (
  tableName: string,
  namespace: string,
  since: string,
  cadence: DigestCadence,
): Promise<DynamoEvent[]> => {
  const cadenceKey = CADENCE_KEY_MAP[cadence];
  const events: DynamoEvent[] = [];

  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'namespace-timestamp-query',
        KeyConditionExpression:
          '#namespace = :namespace AND #eventTimestamp >= :since',
        FilterExpression: 'attribute_not_exists(#processingStatus.#cadence)',
        ExpressionAttributeNames: {
          '#namespace': 'namespace',
          '#eventTimestamp': 'eventTimestamp',
          '#processingStatus': 'processingStatus',
          '#cadence': cadenceKey,
        },
        ExpressionAttributeValues: {
          ':namespace': namespace,
          ':since': since,
        },
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    events.push(...((result.Items ?? []) as DynamoEvent[]));
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return events;
};

/** Group events by country slug. */
export const groupEventsByCountry = (
  events: DynamoEvent[],
): Map<string, DynamoEvent[]> => {
  const grouped = new Map<string, DynamoEvent[]>();

  for (const event of events) {
    const existing = grouped.get(event.group) ?? [];
    existing.push(event);
    grouped.set(event.group, existing);
  }

  return grouped;
};

/**
 * Build the Markdown body for one country's digest.
 */
export const buildCountryDigestMarkdown = (events: DynamoEvent[]): string =>
  [...events]
    .sort((a, b) => b.eventTimestamp.localeCompare(a.eventTimestamp))
    .map(
      (event) => `- ${event.eventNote}\n  _Updated: ${event.eventTimestamp}_`,
    )
    .join('\n');

/**
 * Build one UNS payload for one country.
 */
export const buildDigestPayload = (
  group: string,
  events: DynamoEvent[],
  cadence: DigestCadence,
): NotificationPayload => {
  const countryName = group
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  const title = `You have a new travel alert for ${countryName}`;

  return {
    Namespace: 'travel',
    Group: group,
    Subgroup: cadence,
    NotificationTitle: title,
    NotificationBody: `${events.length} new travel ${events.length === 1 ? 'alert' : 'alerts'} for ${countryName}`,
    MessageTitle: title,
    MessageBody: buildCountryDigestMarkdown(events),
  };
};

/**
 * Mark one event as processed for the requested digest cadence.
 * Stores the processing timestamp under processingStatus.DAILY or WEEKLY.
 */
export const markEventProcessed = async (
  tableName: string,
  eventID: string,
  compositeKey: string,
  cadence: DigestCadence,
  processedAt: string,
): Promise<void> => {
  const cadenceKey = CADENCE_KEY_MAP[cadence];

  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: {
        eventID,
        compositeKey,
      },
      UpdateExpression: 'SET #processingStatus.#cadence = :processedAt',
      ExpressionAttributeNames: {
        '#processingStatus': 'processingStatus',
        '#cadence': cadenceKey,
      },
      ExpressionAttributeValues: {
        ':processedAt': processedAt,
      },
    }),
  );
};

export const handler = async (event: DigestScheduleEvent): Promise<boolean> => {
  logger.info({
    message: `Request received`,
    event,
  });
  const { triggeredAt, schedule } = event;

  try {
    if (schedule !== 'daily' && schedule !== 'weekly') {
      throw new Error(`Unsupported digest cadence: ${schedule}`);
    }

    const cadence: DigestCadence = schedule;
    const tableName = process.env.EVENT_STORE_TABLE_NAME as string;

    const startTime = getDigestStartTime(triggeredAt, cadence);

    logger.info('aggregated-event: starting digest run', {
      triggeredAt,
      cadence,
      startTime,
    });

    // Query eventStore.
    const events = await segment(
      tracer,
      'QueryUnprocessedEvents',
      async (subsegment) => {
        subsegment.addAnnotation('Cadence', cadence);

        return queryUnprocessedEvents(tableName, 'travel', startTime, cadence);
      },
    );

    metrics.addMetric('DigestEventsRetrieved', MetricUnit.Count, events.length);

    if (events.length === 0) {
      logger.info('aggregated-event: no unprocessed events found', {
        triggeredAt,
        cadence,
        startTime,
      });

      return false;
    }

    // Group events by country.
    const grouped = groupEventsByCountry(events);

    metrics.addMetric('DigestCountriesGrouped', MetricUnit.Count, grouped.size);

    // Build one digest payload per country.
    const payloads = Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, countryEvents]) =>
        buildDigestPayload(group, countryEvents, cadence),
      );

    logger.info('aggregated-event: digest payloads formatted', {
      cadence,
      countryCount: grouped.size,
      eventCount: events.length,
      payloadCount: payloads.length,
    });

    // Initialise UNS.
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

    // Submit all country digests in one UNS request.
    const result = await segment(tracer, 'SubmitDigest', async (subsegment) => {
      subsegment.addAnnotation('Cadence', cadence);

      subsegment.addAnnotation('PayloadCount', payloads.length);

      return uns.notification.sendToSubscribers(payloads);
    });

    if (!result.ok) {
      metrics.addMetric('DigestSubmissionFailures', MetricUnit.Count, 1);

      logger.error('aggregated-event: UNS dispatch failed', {
        triggeredAt,
        cadence,
        error: result.error,
        result,
      });

      throw new Error(
        `UNS error: ${result.error.status} — ${result.error.message}`,
      );
    }

    metrics.addMetric(
      'DigestPayloadsSubmitted',
      MetricUnit.Count,
      payloads.length,
    );

    // Mark successfully submitted events as processed.
    const processedAt = new Date().toISOString();

    await segment(tracer, 'MarkEventsProcessed', async () => {
      for (const event of events) {
        await markEventProcessed(
          tableName,
          event.eventID,
          event.compositeKey,
          cadence,
          processedAt,
        );
      }
    });

    metrics.addMetric(
      'DigestEventsMarkedProcessed',
      MetricUnit.Count,
      events.length,
    );

    logger.info('aggregated-event: digest complete', {
      triggeredAt,
      cadence,
      eventCount: events.length,
      countryCount: grouped.size,
      payloadCount: payloads.length,
    });

    return true;
  } catch (error: unknown) {
    const handledError =
      error instanceof Error
        ? error
        : new Error('Unknown aggregated-event error', {
            cause: error,
          });

    logger.error('aggregated-event: handler failed', {
      error: handledError,
      triggeredAt,
      schedule,
    });

    throw handledError;
  } finally {
    metrics.publishStoredMetrics();
  }
};
