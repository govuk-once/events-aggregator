import type { SearchResponse } from './types.js';

const SEARCH_BASE = 'https://www.gov.uk/api/search.json';

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
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Search API returned ${response.status}: ${response.statusText}`,
    );
  }

  return (await response.json()) as SearchResponse;
}
