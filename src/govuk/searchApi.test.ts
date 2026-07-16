import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchChangedTravelAdvice } from './searchApi.js';

describe('fetchChangedTravelAdvice', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls search API with correct parameters', async () => {
    const mockResponse = { results: [], total: 0 };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    });
    vi.stubGlobal('fetch', mockFetch);

    await fetchChangedTravelAdvice('2026-07-16T14:00:00.000Z');

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('https://www.gov.uk/api/search.json?');
    expect(calledUrl).toContain('filter_content_store_document_type=travel_advice');
    expect(calledUrl).toContain('filter_public_timestamp=');
    expect(calledUrl).toContain('2026-07-16T14');
    expect(calledUrl).toContain('order=-public_timestamp');
    expect(calledUrl).toContain('count=300');
    expect(calledUrl).toContain('content_id');
  });

  it('returns parsed response on success', async () => {
    const mockResponse = {
      results: [{ link: '/test', title: 'Test', public_timestamp: '2026-07-16T14:00:00Z' }],
      total: 1,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(mockResponse)),
    }));

    const result = await fetchChangedTravelAdvice('2026-07-16T14:00:00.000Z');
    expect(result.total).toBe(1);
    expect(result.results[0].title).toBe('Test');
  });

  it('throws on non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    }));

    await expect(
      fetchChangedTravelAdvice('2026-07-16T14:00:00.000Z'),
    ).rejects.toThrow('Search API returned 500');
  });
});
