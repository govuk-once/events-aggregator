import { parseArgs } from 'node:util';
import { isValidSchedule, type Schedule } from '../src/config.js';
import { handler } from '../src/handler.js';
import type { ScheduledEvent } from 'aws-lambda';
import type { ContentApiResponse } from '../src/govuk/types.js';

const { values } = parseArgs({
  strict: false,
  options: {
    schedule: { type: 'string', short: 's' },
    country: { type: 'string', short: 'c' },
  },
});

const ALL_SCHEDULES: Schedule[] = ['hourly', 'daily', 'weekly'];

const WINDOW_MS: Record<Schedule, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

process.env.UNS_API_URL = process.env.UNS_API_URL || 'https://uns.example.com';
process.env.UNS_SIGV4_ENABLED = 'false';

async function getAnchorTimestamp(slug: string): Promise<string> {
  const response = await fetch(
    `https://www.gov.uk/api/content/foreign-travel-advice/${slug}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch ${slug}: ${response.status}`);
  }
  const data = (await response.json()) as ContentApiResponse;
  const latest = data.details.change_history?.[0]?.public_timestamp;
  if (!latest) {
    throw new Error(`No change_history found for ${slug}`);
  }
  return latest;
}

async function main() {
  const schedules: Schedule[] = values.schedule && isValidSchedule(values.schedule)
    ? [values.schedule]
    : ALL_SCHEDULES;

  let anchor: Date | undefined;

  if (values.country) {
    console.log(`Anchoring to ${values.country}'s last change...`);
    const timestamp = await getAnchorTimestamp(values.country);
    anchor = new Date(timestamp);
    console.log(`Anchor: ${timestamp}\n`);
  }

  for (const schedule of schedules) {
    console.log(`${'═'.repeat(60)}`);
    console.log(`Invoking handler: schedule=${schedule}, dryRun=true${values.country ? `, country=${values.country}` : ''}`);
    console.log('═'.repeat(60) + '\n');

    const windowStart = anchor
      ? new Date(anchor.getTime() - WINDOW_MS[schedule]).toISOString()
      : undefined;

    const event = {
      schedule,
      dryRun: true,
      country: values.country,
      windowStart,
    } as unknown as ScheduledEvent;

    await handler(event);
    console.log('');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
