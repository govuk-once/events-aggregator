import { describe, it, expect } from 'vitest';
import { resolveCountry } from './mapping.js';

describe('resolveCountry', () => {
  const knownContentId = 'ea339677-8843-4a8a-b5ad-dff327d70ce3';
  const unknownContentId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

  it('returns found with country for supported content_id', () => {
    const result = resolveCountry(knownContentId);
    expect(result).toEqual({
      status: 'found',
      country: { slug: 'pakistan', name: 'Pakistan', supported: true },
    });
  });

  it('returns unknown for unrecognised content_id', () => {
    const result = resolveCountry(unknownContentId);
    expect(result).toEqual({ status: 'unknown' });
  });
});
