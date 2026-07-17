import type { Logger } from '@aws-lambda-powertools/logger';

export interface CountryChanges {
  slug: string;
  title: string;
  changes: { note: string; timestamp: string }[];
}

export type ChangesAdapter = (
  windowStart: string,
  logger: Logger,
  countryFilter?: string,
) => Promise<CountryChanges[]>;
