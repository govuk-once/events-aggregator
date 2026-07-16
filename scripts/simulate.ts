import { parseArgs } from 'node:util';
import { isValidSchedule, type Schedule } from '../src/config.js';
import { handler } from '../src/handler.js';
import type { ScheduledEvent } from 'aws-lambda';
import type { ContentApiResponse } from '../src/govuk/types.js';

const WINDOW_MS: Record<Schedule, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

const { values } = parseArgs({
  strict: false,
  options: {
    schedule: { type: 'string', short: 's' },
    country: { type: 'string', short: 'c' },
  },
});

if (!values.schedule || !isValidSchedule(values.schedule)) {
  console.error('Usage: pnpm run simulate --schedule <hourly|daily|weekly> [--country <slug>]');
  process.exit(1);
}

const schedule: Schedule = values.schedule;

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
  let windowStart: string | undefined;

  if (values.country) {
    const timestamp = await getAnchorTimestamp(values.country);
    const anchor = new Date(timestamp);
    windowStart = new Date(anchor.getTime() - WINDOW_MS[schedule]).toISOString();
  }

  const event = {
    schedule,
    dryRun: true,
    country: values.country,
    windowStart,
  } as unknown as ScheduledEvent;

  await handler(event);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
