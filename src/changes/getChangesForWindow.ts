import { Logger } from '@aws-lambda-powertools/logger';
import { resolveCountry } from '../countries/mapping.js';
import { fetchCountriesBatch } from '../govuk/contentApi.js';
import { fetchChangedTravelAdvice } from '../govuk/searchApi.js';
import type { ChangesAdapter, CountryChanges } from './types.js';

export type { CountryChanges, ChangesAdapter } from './types.js';

/**
 * GOV.UK API adapter — polls the Search and Content APIs.
 *
 * This is the only adapter today. To add a second (e.g. DynamoDB),
 * implement the same ChangesAdapter signature and swap or compose
 * at the handler level.
 */
export const getChangesForWindow: ChangesAdapter = async (
  windowStart: string,
  logger: Logger,
  countryFilter?: string,
): Promise<CountryChanges[]> => {
  const searchResponse = await fetchChangedTravelAdvice(windowStart);
  logger.info('Search API returned results', {
    total: searchResponse.total,
    count: searchResponse.results.length,
  });

  if (searchResponse.results.length === 0) {
    return [];
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
    if (countryFilter && resolved.country.slug !== countryFilter) continue;

    supportedSlugs.push(resolved.country.slug);
  }

  if (supportedSlugs.length === 0) {
    return [];
  }

  logger.info('Fetching content for changed countries', {
    count: supportedSlugs.length,
  });

  const contentResults = await fetchCountriesBatch(supportedSlugs, (slug, error) => {
    logger.error('Failed to fetch content', { slug, error: error.message });
  });

  const changes: CountryChanges[] = [];
  for (const [slug, content] of contentResults) {
    const history = content.details.change_history ?? [];
    if (history.length > 0) {
      changes.push({
        slug,
        title: content.title,
        changes: history.map((entry) => ({
          note: entry.note,
          timestamp: entry.public_timestamp,
        })),
      });
    }
  }

  return changes;
};
