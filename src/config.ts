export type Schedule = 'hourly' | 'daily' | 'weekly';

const WINDOW_MS: Record<Schedule, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

export function getTimeWindow(schedule: Schedule, now: Date = new Date()): string {
  const from = new Date(now.getTime() - WINDOW_MS[schedule]);
  return from.toISOString();
}

export function isValidSchedule(value: unknown): value is Schedule {
  return value === 'hourly' || value === 'daily' || value === 'weekly';
}

export interface UnsClientConfig {
  apiUrl: string;
  region: string;
  sigv4Enabled: boolean;
}

export function getUnsConfig(): UnsClientConfig {
  const apiUrl = process.env.UNS_API_URL;
  if (!apiUrl) {
    throw new Error('UNS_API_URL environment variable is not set');
  }

  return {
    apiUrl,
    region: process.env.UNS_API_REGION || process.env.AWS_REGION || 'eu-west-2',
    sigv4Enabled: process.env.UNS_SIGV4_ENABLED === 'true',
  };
}
