import { createHash } from 'node:crypto';
import type { Schedule } from '../config.js';

export interface ChangeEntry {
  note: string;
  timestamp: string;
}

export interface NotificationMessage {
  NotificationID: string;
  NotificationTitle: string;
  NotificationBody: string;
  MessageTitle: string;
  MessageBody: string;
}

export function buildMessage(
  countryName: string,
  countrySlug: string,
  schedule: Schedule,
  changes: ChangeEntry[],
  windowStart: string,
): NotificationMessage | null {
  const windowStartMs = new Date(windowStart).getTime();
  const relevantChanges = changes.filter(
    (entry) => new Date(entry.timestamp).getTime() >= windowStartMs,
  );

  if (relevantChanges.length === 0) return null;

  const dedupMarker = computeDedupMarker(
    countrySlug,
    schedule,
    relevantChanges,
  );

  const notificationTitle =
    relevantChanges.length === 1
      ? `${countryName} updated`
      : `${countryName}: ${relevantChanges.length} updates`;

  const notificationBody =
    relevantChanges.length === 1
      ? relevantChanges[0].note
      : `${relevantChanges.length} changes in the ${schedule} digest`;

  const messageBody = relevantChanges.map((c) => `- ${c.note}`).join('\n');

  return {
    NotificationID: dedupMarker,
    NotificationTitle: notificationTitle,
    NotificationBody: notificationBody,
    MessageTitle: notificationTitle,
    MessageBody: messageBody,
  };
}

function computeDedupMarker(
  slug: string,
  schedule: string,
  changes: ChangeEntry[],
): string {
  const payload = changes
    .map((c) => `${c.timestamp}:${c.note}`)
    .sort()
    .join('\n');

  return createHash('sha256')
    .update(`${slug}:${schedule}\n${payload}`)
    .digest('hex');
}
