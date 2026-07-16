import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchCountryContent, fetchCountriesBatch } from './contentApi.js';

describe('contentApi', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('fetchCountryContent', () => {
    it('returns content on success', async () => {
      const mockContent = {
        content_id: 'abc123',
        title: 'Pakistan travel advice',
        base_path: '/foreign-travel-advice/pakistan',
        details: {
          change_history: [
            { note: 'Updated', public_timestamp: '2026-07-16T10:00:00Z' },
          ],
        },
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          text: () => Promise.resolve(JSON.stringify(mockContent)),
        }),
      );

      const result = await fetchCountryContent('pakistan');
      expect(result).toEqual(mockContent);
      expect(fetch).toHaveBeenCalledWith(
        'https://www.gov.uk/api/content/foreign-travel-advice/pakistan',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('throws on non-retryable error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        }),
      );

      await expect(fetchCountryContent('unknown')).rejects.toThrow(
        'Content API returned 404',
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('retries on 500 errors', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'ISE' })
        .mockResolvedValueOnce({
          ok: true,
          text: () =>
            Promise.resolve(JSON.stringify({
              content_id: 'abc',
              title: 'Test',
              base_path: '/test',
              details: {},
            })),
        });

      vi.stubGlobal('fetch', mockFetch);

      const promise = fetchCountryContent('pakistan');
      await vi.advanceTimersByTimeAsync(500);
      const result = await promise;

      expect(result.content_id).toBe('abc');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchCountriesBatch', () => {
    it('calls onError for failed fetches and continues', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          text: () =>
            Promise.resolve(JSON.stringify({
              content_id: '1',
              title: 'France',
              base_path: '/test',
              details: {},
            })),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'ISE',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'ISE',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'ISE',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'ISE',
        });

      vi.stubGlobal('fetch', mockFetch);

      const errors: { slug: string; error: Error }[] = [];
      const promise = fetchCountriesBatch(['france', 'spain'], (slug, error) => {
        errors.push({ slug, error });
      });

      await vi.advanceTimersByTimeAsync(10000);
      const results = await promise;

      expect(results.has('france')).toBe(true);
      expect(results.has('spain')).toBe(false);
      expect(errors.length).toBe(1);
      expect(errors[0].slug).toBe('spain');
    });
  });
});
