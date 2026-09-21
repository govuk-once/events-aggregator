import type {
  ChangeHistory,
  CountryResponse,
  NotificationPayload,
  ScheduleFrequency,
  SearchResponse,
} from '@/types';
import type { DynamoEvent } from '@/types/event';

import { getSecret } from '@aws-lambda-powertools/parameters/secrets';

export const SEARCH_BASE = 'https://www.gov.uk/api/search.json';
export const CONTENT_API = 'https://www.gov.uk/api/content';
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

function buildSearchUrl(fromTimestamp: string): string {
  const params = new URLSearchParams();
  params.set('filter_content_store_document_type', 'travel_advice');
  params.set('filter_public_timestamp', `from:${fromTimestamp}`);
  params.set('order', '-public_timestamp');
  params.set('count', '300');
  params.append('fields[]', 'link');
  params.append('fields[]', 'title');
  params.append('fields[]', 'public_timestamp');
  params.append('fields[]', 'content_id');
  return `${SEARCH_BASE}?${params.toString()}`;
}

export const getTravelChangesSince = async (
  timestamp: string,
): Promise<SearchResponse> => {
  const url = buildSearchUrl(timestamp);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Search api returned a ${response.status}`);
  }

  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error(
      `Search API response too large: ${text.length} bytes (max ${MAX_RESPONSE_BYTES})`,
    );
  }

  return JSON.parse(text);
};

export const getCountryChanges = async (
  url: string,
): Promise<CountryResponse> => {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Content api returned a ${response.status}`);
  }

  const text = await response.text();

  return JSON.parse(text);
};

export const getStartTime = (
  timestamp: string,
  schedule: ScheduleFrequency,
): string => {
  const date = new Date(timestamp);

  switch (schedule) {
    case 'hourly':
      date.setUTCHours(date.getUTCHours() - 1);
      break;
    case 'daily':
      date.setUTCDate(date.getUTCDate() - 1);
      break;
    case 'weekly':
      date.setUTCDate(date.getUTCDate() - 7);
      break;
  }

  return date.toISOString();
};

type InstantSchedule = 'instant';
type Frequency = ScheduleFrequency | InstantSchedule;

export const getFormattedDate = (iso8601Timestamp: string) => {
  function getOrdinalSuffix(day: number): string {
    if (day > 3 && day < 21) return 'th';
    switch (day % 10) {
      case 1:
        return 'st';
      case 2:
        return 'nd';
      case 3:
        return 'rd';
      default:
        return 'th';
    }
  }

  const date = new Date(iso8601Timestamp);

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((p) => [p.type, p.value]),
  );

  const dayNum = parseInt(parts.day, 10);
  const suffix = getOrdinalSuffix(dayNum);
  const period = parts.dayPeriod
    ? parts.dayPeriod.toLowerCase().replace(/[^a-z]/g, '')
    : '';
  const tz = parts.timeZoneName === 'BST' ? 'BST' : 'GMT';

  return `${parts.hour}:${parts.minute}${period}, ${dayNum}${suffix} ${parts.month} ${parts.year} (${tz})`;
};

const titleCase = (str: string) =>
  str
    .toLowerCase()
    .split(/([ -])/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');

export const getNotificationPayload = (
  dbEntry: DynamoEvent,
  schedule: Frequency,
): NotificationPayload | null => {
  const lines = (...lines: string[]) => lines.join(`\n`);
  const segments = (...segments: string[]) => segments.join(`\n\n`);
  const link = (url: string, label: string) => `[${label}](${url})`;

  return {
    Namespace: dbEntry.namespace,
    Group: dbEntry.group,
    Subgroup: schedule,
    NotificationTitle: `${titleCase(dbEntry.group)}: Travel advice alert`,
    NotificationBody: `There's been a change in country you are interested in`,
    MessageTitle: `${titleCase(dbEntry.group)}: Travel advice alert`,
    MessageBody: segments(
      link(`Go to latest`, `govuk://travel/${dbEntry.group})`),
      lines(`Changes made:`, dbEntry.eventNote),
      lines(`Time updated:`, getFormattedDate(dbEntry.eventTimestamp)),
      link(`Manage your countries`, dbEntry.eventNote),
    ),
    DeeplinkURL: `govuk://app.gov.uk/topics/travel-abroad`,
  };
};

/**
 * Read one secret as a raw PEM string. `maxAge` caches the value for 10 minutes
 * so we don't hit Secrets Manager on every warm invocation.
 */
export const getSmmSecret = async (secretArn: string): Promise<string> => {
  const value = await getSecret<string>(secretArn, { maxAge: 600 });

  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`secret is empty or not a string: ${secretArn}`);
  }

  return value;
};

export const getEventsFromCountry = (
  country: CountryResponse,
  timestamp: string,
): ChangeHistory[] | null => {
  const countryChanges = country.details.change_history.filter(
    ({ public_timestamp }) => public_timestamp >= timestamp,
  );

  return countryChanges;
};
