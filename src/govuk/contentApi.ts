import type { ContentApiResponse } from './types.js';

const CONTENT_BASE = 'https://www.gov.uk/api/content';
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export async function fetchCountryContent(
  slug: string,
): Promise<ContentApiResponse> {
  const url = `${CONTENT_BASE}/foreign-travel-advice/${slug}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
    });

    if (response.ok) {
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) {
        throw new Error(
          `Content API response too large for ${slug}: ${text.length} bytes`,
        );
      }
      return JSON.parse(text) as ContentApiResponse;
    }

    if (attempt === MAX_RETRIES || response.status < 500) {
      throw new Error(
        `Content API returned ${response.status} for ${slug} after ${attempt + 1} attempt(s)`,
      );
    }

    const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
    await delay(backoff);
  }

  throw new Error(`Unreachable: exhausted retries for ${slug}`);
}

export async function fetchCountriesBatch(
  slugs: string[],
  onError: (slug: string, error: Error) => void,
): Promise<Map<string, ContentApiResponse>> {
  const results = new Map<string, ContentApiResponse>();
  const BATCH_SIZE = 10;
  const BATCH_DELAY_MS = 1000;

  for (let i = 0; i < slugs.length; i += BATCH_SIZE) {
    if (i > 0) {
      await delay(BATCH_DELAY_MS);
    }

    const batch = slugs.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map((slug) => fetchCountryContent(slug)),
    );

    for (let j = 0; j < batch.length; j++) {
      const result = settled[j];
      if (result.status === 'fulfilled') {
        results.set(batch[j], result.value);
      } else {
        onError(batch[j], result.reason as Error);
      }
    }
  }

  return results;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
