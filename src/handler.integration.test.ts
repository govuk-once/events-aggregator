import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ScheduledEvent } from 'aws-lambda';
import { handler } from './handler.js';

const PAKISTAN_CONTENT_ID = 'ea339677-8843-4a8a-b5ad-dff327d70ce3';
const FRANCE_CONTENT_ID = '05a8e85c-5a65-406e-923d-79c04a4433f6';
const UNKNOWN_CONTENT_ID = 'deadbeef-dead-beef-dead-beefdeadbeef';

const KNOWN_COUNTRIES: Record<string, { slug: string; name: string }> = {
  [PAKISTAN_CONTENT_ID]: { slug: 'pakistan', name: 'Pakistan' },
  [FRANCE_CONTENT_ID]: { slug: 'france', name: 'France' },
};

function recentTimestamp(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
}

const mockSearchResponse = (contentIds: string[]) => ({
  results: contentIds.map((id) => {
    const entry = KNOWN_COUNTRIES[id];
    return {
      link: entry
        ? `/foreign-travel-advice/${entry.slug}`
        : '/foreign-travel-advice/unknown',
      title: entry ? `${entry.name} travel advice` : 'Unknown travel advice',
      public_timestamp: '2026-07-16T14:30:00Z',
      content_id: id,
    };
  }),
  total: contentIds.length,
});

const mockContentResponse = (slug: string, changeTimestamp: string) => ({
  content_id: Object.entries(KNOWN_COUNTRIES).find(
    ([, v]) => v.slug === slug,
  )?.[0],
  title: `${slug.charAt(0).toUpperCase() + slug.slice(1)} travel advice`,
  base_path: `/foreign-travel-advice/${slug}`,
  details: {
    change_history: [
      {
        note: `Updated safety information for ${slug}`,
        public_timestamp: changeTimestamp,
      },
      {
        note: 'Old change that should be filtered out',
        public_timestamp: '2020-01-01T00:00:00Z',
      },
    ],
    country: { name: slug, slug },
  },
});

function createScheduledEvent(schedule: string): ScheduledEvent {
  return {
    schedule,
    version: '0',
    id: 'test-id',
    'detail-type': 'Scheduled Event',
    source: 'aws.events',
    account: '123456789012',
    time: '2026-07-16T15:00:00Z',
    region: 'eu-west-2',
    resources: [],
    detail: {},
  } as unknown as ScheduledEvent;
}

describe('handler integration', () => {
  let fetchCalls: { url: string; options?: RequestInit }[];

  beforeEach(() => {
    fetchCalls = [];
    process.env.UNS_API_URL = 'https://uns.example.com';
    process.env.UNS_SIGV4_ENABLED = 'false';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.UNS_API_URL;
    delete process.env.UNS_SIGV4_ENABLED;
  });

  it('full flow: search → content → publish for supported countries', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string | URL, options?: RequestInit) => {
      const urlStr = url.toString();
      fetchCalls.push({ url: urlStr, options });

      if (urlStr.includes('/api/search.json')) {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify(mockSearchResponse([PAKISTAN_CONTENT_ID, FRANCE_CONTENT_ID])),
            ),
        });
      }

      if (urlStr.includes('/api/content/foreign-travel-advice/pakistan')) {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify(mockContentResponse('pakistan', recentTimestamp(10))),
            ),
        });
      }

      if (urlStr.includes('/api/content/foreign-travel-advice/france')) {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify(mockContentResponse('france', recentTimestamp(5))),
            ),
        });
      }

      if (urlStr.includes('uns.example.com/messages')) {
        return Promise.resolve({ ok: true });
      }

      return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
    });

    vi.stubGlobal('fetch', mockFetch);

    await handler(createScheduledEvent('hourly'));

    const searchCall = fetchCalls.find((c) => c.url.includes('/api/search.json'));
    expect(searchCall).toBeDefined();
    expect(searchCall!.url).toContain('filter_content_store_document_type=travel_advice');
    expect(searchCall!.url).toContain('filter_public_timestamp=from');

    const contentCalls = fetchCalls.filter((c) =>
      c.url.includes('/api/content/foreign-travel-advice/'),
    );
    expect(contentCalls).toHaveLength(2);

    const unsCalls = fetchCalls.filter((c) =>
      c.url.includes('uns.example.com/messages'),
    );
    expect(unsCalls).toHaveLength(2);

    const pakistanPublish = JSON.parse(unsCalls[0].options?.body as string);
    expect(pakistanPublish.topic).toBe('travel-advice/pakistan/hourly');
    expect(pakistanPublish.NotificationTitle).toBe('Pakistan travel advice updated');
    expect(pakistanPublish.NotificationBody).toContain('Updated safety information');
    expect(pakistanPublish.NotificationID).toMatch(/^[a-f0-9]{64}$/);

    const francePublish = JSON.parse(unsCalls[1].options?.body as string);
    expect(francePublish.topic).toBe('travel-advice/france/hourly');
  });

  it('skips unknown countries and logs warning', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string | URL, options?: RequestInit) => {
      const urlStr = url.toString();
      fetchCalls.push({ url: urlStr, options });

      if (urlStr.includes('/api/search.json')) {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify(mockSearchResponse([UNKNOWN_CONTENT_ID, PAKISTAN_CONTENT_ID])),
            ),
        });
      }

      if (urlStr.includes('/api/content/foreign-travel-advice/pakistan')) {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify(mockContentResponse('pakistan', recentTimestamp(10))),
            ),
        });
      }

      if (urlStr.includes('uns.example.com/messages')) {
        return Promise.resolve({ ok: true });
      }

      return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
    });

    vi.stubGlobal('fetch', mockFetch);

    await handler(createScheduledEvent('hourly'));

    const contentCalls = fetchCalls.filter((c) =>
      c.url.includes('/api/content/foreign-travel-advice/'),
    );
    expect(contentCalls).toHaveLength(1);
    expect(contentCalls[0].url).toContain('pakistan');

    const unsCalls = fetchCalls.filter((c) =>
      c.url.includes('uns.example.com/messages'),
    );
    expect(unsCalls).toHaveLength(1);
  });

  it('does nothing when no changes detected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string | URL) => {
        const urlStr = url.toString();
        fetchCalls.push({ url: urlStr });
        if (urlStr.includes('/api/search.json')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(JSON.stringify({ results: [], total: 0 })),
          });
        }
        return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
      }),
    );

    await handler(createScheduledEvent('daily'));

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain('/api/search.json');
  });

  it('continues publishing other countries when one content fetch fails', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string | URL, options?: RequestInit) => {
      const urlStr = url.toString();
      fetchCalls.push({ url: urlStr, options });

      if (urlStr.includes('/api/search.json')) {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify(mockSearchResponse([PAKISTAN_CONTENT_ID, FRANCE_CONTENT_ID])),
            ),
        });
      }

      if (urlStr.includes('/api/content/foreign-travel-advice/pakistan')) {
        return Promise.resolve({ ok: false, status: 500, statusText: 'ISE' });
      }

      if (urlStr.includes('/api/content/foreign-travel-advice/france')) {
        return Promise.resolve({
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify(mockContentResponse('france', recentTimestamp(5))),
            ),
        });
      }

      if (urlStr.includes('uns.example.com/messages')) {
        return Promise.resolve({ ok: true });
      }

      return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
    });

    vi.stubGlobal('fetch', mockFetch);
    vi.useFakeTimers();

    const promise = handler(createScheduledEvent('weekly'));
    await vi.advanceTimersByTimeAsync(30000);
    await promise;

    vi.useRealTimers();

    const unsCalls = fetchCalls.filter((c) =>
      c.url.includes('uns.example.com/messages'),
    );
    expect(unsCalls).toHaveLength(1);

    const francePublish = JSON.parse(unsCalls[0].options?.body as string);
    expect(francePublish.topic).toBe('travel-advice/france/weekly');
  });

  it('uses correct time window for each schedule', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string | URL) => {
        const urlStr = url.toString();
        fetchCalls.push({ url: urlStr });
        if (urlStr.includes('/api/search.json')) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(JSON.stringify({ results: [], total: 0 })),
          });
        }
        return Promise.resolve({ ok: false, status: 404, statusText: 'Not Found' });
      }),
    );

    await handler(createScheduledEvent('hourly'));
    await handler(createScheduledEvent('daily'));
    await handler(createScheduledEvent('weekly'));

    const searchCalls = fetchCalls.filter((c) => c.url.includes('/api/search.json'));
    expect(searchCalls).toHaveLength(3);

    for (const call of searchCalls) {
      expect(call.url).toContain('filter_public_timestamp=from');
    }
  });

  it('throws on invalid schedule', async () => {
    await expect(
      handler(createScheduledEvent('monthly')),
    ).rejects.toThrow('Invalid schedule: monthly');
  });
});
