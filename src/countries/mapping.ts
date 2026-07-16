export interface CountryEntry {
  slug: string;
  name: string;
  supported: boolean;
}

export type ResolveResult =
  | { status: 'found'; country: CountryEntry }
  | { status: 'unknown' }
  | { status: 'unsupported' };

type CountryMapping = Record<string, CountryEntry>;

const COUNTRY_MAPPING: CountryMapping = {
  'ea339677-8843-4a8a-b5ad-dff327d70ce3': {
    slug: 'pakistan',
    name: 'Pakistan',
    supported: true,
  },
  '05a8e85c-5a65-406e-923d-79c04a4433f6': {
    slug: 'france',
    name: 'France',
    supported: true,
  },
  '34dafa2b-24e5-4625-b542-bf5e0bb8cd80': {
    slug: 'mexico',
    name: 'Mexico',
    supported: true,
  },
};

export function resolveCountry(contentId: string): ResolveResult {
  const entry = COUNTRY_MAPPING[contentId];
  if (!entry) return { status: 'unknown' };
  if (!entry.supported) return { status: 'unsupported' };
  return { status: 'found', country: entry };
}
