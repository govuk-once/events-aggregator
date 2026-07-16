import type { SearchResponse } from './types.js';

const SEARCH_BASE = 'https://www.gov.uk/api/search.json';
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

export async function fetchChangedTravelAdvice(
  fromTimestamp: string,
): Promise<SearchResponse> {
  const url = buildSearchUrl(fromTimestamp);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(
      `Search API returned ${response.status}: ${response.statusText}`,
    );
  }

  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error(
      `Search API response too large: ${text.length} bytes (max ${MAX_RESPONSE_BYTES})`,
    );
  }
  return JSON.parse(text) as SearchResponse;
}
