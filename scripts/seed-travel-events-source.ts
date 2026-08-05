import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { v5 as uuidv5 } from 'uuid';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  BatchGetCommand,
  PutCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { ServiceEnvironmentNamingProvider } from '../cdk/cdk_constructs/namingProviders/ServiceEnvironmentNamingProvider';

// ── Config ──────────────────────────────────────────────────────────────────

const SOURCE_URL = 'https://www.gov.uk/api/content/foreign-travel-advice';

/** Namespace every seeded row is filed under. */
const SOURCE_NAMESPACE = 'travel';

/**
 * uuidv5 namespace for `sourceID`. NEVER CHANGE THIS. It is the identity of
 * every row this script has ever written — a new value silently inserts a
 * second, parallel set of 226 rows rather than recognising the existing ones.
 * It is a hardcoded constant, not configuration, for the same reason.
 */
const SEED_NAMESPACE = 'c0538897-dde0-4016-b1a5-c7ef92167b71';

/**
 * Upstream currently publishes ~226 countries. If a fetch returns far fewer we
 * assume the response is degraded rather than that the world shrank, and abort
 * instead of seeding a partial list.
 */
const MIN_EXPECTED_COUNTRIES = 150;

const FETCH_TIMEOUT_MS = 15_000;
const FETCH_ATTEMPTS = 3;
const BATCH_GET_SIZE = 100; // DynamoDB BatchGetItem hard limit
const WRITE_CHUNK_SIZE = 25; // concurrency window, not an API limit
const MAX_BATCH_RETRIES = 5;
const TABLE_ACTIVE_TIMEOUT_MS = 120_000;
const MAX_SCAN_PAGES = 20;

/**
 * Mirrors the `Source` type owned by the consuming service. Kept local so this
 * script stays a single drop-in file; replace with an import once it lands
 * alongside the real type.
 */
export type Source = {
  sourceID: string;
  sourceNamespace: string;
  sourceGroup: string;
  accessMethod: 'api' | 'other';
  URL: string;
  sourceEnabled: boolean;
  keyARN?: string;
  lastUpdated: string;
};

export interface Config {
  tableName: string;
  region: string;
  dryRun: boolean;
  checkOrphans: boolean;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

/** Thrown for bad or absent arguments, carrying the exit code to use. */
export class UsageError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = 'UsageError';
  }
}

export function usageText(): string {
  return `
Usage: npx tsx seed-travel-events-source.ts [OPTIONS]

Target table (one of):
 --table <name> Explicit table name, skips derivation (env TABLE_NAME)
 --service <name> Service segment, combined with the Environment env var
 to derive \${Environment}-\${service}-\${table-name}
 (env SERVICE_NAME)

Options:
 --table-name <name> Bare table name used when deriving (env SOURCE_TABLE_NAME,
 default: sources)
 --region <region> AWS region (env AWS_REGION, default: eu-west-2)
 --dry-run Report the plan without writing anything (env SEED_DRY_RUN)
 --check-orphans Scan for seeded rows no longer published upstream (report only)
 --help Show this message
`;
}

/**
 * Resolve the physical table name, mirroring how CDK names it so the seed and
 * the deploy cannot disagree.
 */
export function resolveTableName(options: {
  table?: string;
  service?: string;
  tableName: string;
}): string {
  if (options.table) return options.table;

  if (!options.service) {
    throw new UsageError(
      `Error: one of --table or --service is required\n${usageText()}`,
      1,
    );
  }

  // EnvironmentNamingProvider falls back to $USER (and then to an empty
  // prefix) when `Environment` is unset. That is right for a developer running
  // cdk deploy, but a script that writes data must never guess which
  // environment it is pointed at.
  if (!process.env.Environment) {
    throw new UsageError(
      'Error: the Environment variable must be set to derive the table name (or pass --table explicitly)',
      1,
    );
  }

  return new ServiceEnvironmentNamingProvider(options.service).getResourceName(
    options.tableName,
  );
}

export function parseConfig(argv: string[] = process.argv.slice(2)): Config {
  const { values } = parseArgs({
    args: argv,
    options: {
      table: { type: 'string', default: process.env.TABLE_NAME },
      service: { type: 'string', default: process.env.SERVICE_NAME },
      'table-name': {
        type: 'string',
        default: process.env.SOURCE_TABLE_NAME ?? 'sources',
      },
      region: {
        type: 'string',
        default: process.env.AWS_REGION ?? 'eu-west-2',
      },
      'dry-run': {
        type: 'boolean',
        default: process.env.SEED_DRY_RUN === 'true',
      },
      'check-orphans': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });

  if (values.help) throw new UsageError(usageText(), 0);

  return {
    tableName: resolveTableName({
      table: values.table,
      service: values.service,
      tableName: values['table-name']!,
    }),
    region: values.region!,
    dryRun: values['dry-run']!,
    checkOrphans: values['check-orphans']!,
  };
}

// ── Source data ─────────────────────────────────────────────────────────────

interface GovUkChild {
  details?: {
    country?: { name?: string; slug?: string; synonyms?: string[] };
  };
}

/**
 * The upstream view of a country. `name` and `synonyms` never reach DynamoDB
 * (see {@link buildSource}) but are kept for log lines and validation.
 */
export interface CountryItem {
  slug: string;
  name: string;
  synonyms: string[];
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function toCountryItem(child: GovUkChild): CountryItem | null {
  const country = child.details?.country;
  // A child without a slug cannot be keyed, so it is not seedable.
  if (!country?.slug || !country.name) return null;

  return {
    slug: country.slug,
    name: country.name,
    synonyms: country.synonyms ?? [],
  };
}

export function dedupeBySlug(countries: CountryItem[]): CountryItem[] {
  const bySlug = new Map<string, CountryItem>();
  for (const country of countries) bySlug.set(country.slug, country);
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Parse and validate an upstream payload. Split out so the guard is testable. */
export function parseCountriesPayload(body: unknown): CountryItem[] {
  const children =
    (body as { links?: { children?: GovUkChild[] } } | null)?.links?.children ??
    [];

  const countries = children
    .map(toCountryItem)
    .filter((country): country is CountryItem => country !== null);

  if (countries.length < MIN_EXPECTED_COUNTRIES) {
    throw new Error(
      `only ${countries.length} countries returned, expected at least ${MIN_EXPECTED_COUNTRIES}`,
    );
  }

  return dedupeBySlug(countries);
}

export async function fetchCountries(): Promise<CountryItem[]> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(SOURCE_URL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      return parseCountriesPayload(await response.json());
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        ` fetch attempt ${attempt}/${FETCH_ATTEMPTS} failed: ${message}`,
      );
      if (attempt < FETCH_ATTEMPTS) await sleep(1000 * 2 ** (attempt - 1));
    }
  }

  throw new Error(
    `Failed to fetch countries from ${SOURCE_URL}: ${
      lastError instanceof Error ? lastError.message : lastError
    }`,
  );
}

// ── Item building ───────────────────────────────────────────────────────────

export function contentUrlForSlug(slug: string): string {
  return `${SOURCE_URL}/${slug}`;
}

export function sourceIdFor(
  namespace: string,
  group: string,
  url: string,
): string {
  return uuidv5(`${namespace}#${group}#${url}`, SEED_NAMESPACE);
}

export function buildSource(slug: string, now: string): Source {
  const URL = contentUrlForSlug(slug);

  // `name` and `synonyms` from GOV.UK are deliberately dropped: Source has no
  // home for them, and a consumer can recover them at runtime by fetching URL.
  // `keyARN` is intentionally absent, not undefined — it is operator-owned.
  return {
    sourceID: sourceIdFor(SOURCE_NAMESPACE, slug, URL),
    sourceNamespace: SOURCE_NAMESPACE,
    sourceGroup: slug,
    accessMethod: 'api',
    URL,
    sourceEnabled: true,
    lastUpdated: now,
  };
}

export function buildDesiredSources(
  countries: CountryItem[],
  now: string,
): Source[] {
  return countries.map((country) => buildSource(country.slug, now));
}

// ── Current state ───────────────────────────────────────────────────────────

export interface ExistingSource {
  sourceID: string;
  sourceGroup: string;
  sourceEnabled?: boolean;
  keyARN?: string;
}

/** Composite identity of a row, used to key the existing-state map. */
export function keyOf(source: {
  sourceID: string;
  sourceGroup: string;
}): string {
  return `${source.sourceID}#${source.sourceGroup}`;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Waits for a freshly-deployed table to leave CREATING. A table that does not
 * exist at all is a deployment error, not something to wait out.
 */
export async function assertTableActive(
  client: DynamoDBClient,
  tableName: string,
): Promise<void> {
  const deadline = Date.now() + TABLE_ACTIVE_TIMEOUT_MS;

  for (;;) {
    let status: string | undefined;

    try {
      const result = await client.send(
        new DescribeTableCommand({ TableName: tableName }),
      );
      status = result.Table?.TableStatus;
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === 'ResourceNotFoundException'
      ) {
        throw new Error(
          `Table '${tableName}' does not exist — has the stack been deployed?`,
        );
      }
      throw error;
    }

    if (status === 'ACTIVE') return;
    if (Date.now() >= deadline) {
      throw new Error(`Table '${tableName}' still ${status} after timeout`);
    }

    console.log(` table status ${status}, waiting...`);
    await sleep(5000);
  }
}

/**
 * Read which of the desired rows already exist. Every key is computable up
 * front (sourceID is deterministic), so this is a handful of BatchGets rather
 * than a Scan of the whole table.
 */
export async function readExistingSources(
  documentClient: DynamoDBDocumentClient,
  config: Config,
  desired: Source[],
): Promise<Map<string, ExistingSource>> {
  const existing = new Map<string, ExistingSource>();

  for (const keys of chunk(desired, BATCH_GET_SIZE)) {
    let request = {
      Keys: keys.map((source) => ({
        sourceID: source.sourceID,
        sourceGroup: source.sourceGroup,
      })),
      // A stale read would print a lying plan, and this output is the deploy
      // record of what was seeded.
      ConsistentRead: true,
      ProjectionExpression: '#sourceID, #sourceGroup, #sourceEnabled, #keyARN',
      ExpressionAttributeNames: {
        '#sourceID': 'sourceID',
        '#sourceGroup': 'sourceGroup',
        '#sourceEnabled': 'sourceEnabled',
        '#keyARN': 'keyARN',
      },
    };

    for (let attempt = 0; ; attempt++) {
      if (attempt > MAX_BATCH_RETRIES) {
        throw new Error(
          `${request.Keys.length} keys still unprocessed after ${MAX_BATCH_RETRIES} retries`,
        );
      }
      if (attempt > 0) await sleep(200 * 2 ** (attempt - 1));

      const result = await documentClient.send(
        new BatchGetCommand({ RequestItems: { [config.tableName]: request } }),
      );

      for (const item of result.Responses?.[config.tableName] ?? []) {
        const source = item as ExistingSource;
        existing.set(keyOf(source), source);
      }

      const unprocessed = result.UnprocessedKeys?.[config.tableName];
      if (!unprocessed?.Keys?.length) break;
      request = unprocessed as typeof request;
    }
  }

  return existing;
}

// ── Diff ────────────────────────────────────────────────────────────────────

export interface SeedPlan {
  toInsert: Source[];
  unchanged: number;
  disabled: string[];
}

export function buildPlan(
  desired: Source[],
  existing: Map<string, ExistingSource>,
): SeedPlan {
  const toInsert: Source[] = [];
  const disabled: string[] = [];
  let unchanged = 0;

  for (const source of desired) {
    const current = existing.get(keyOf(source));

    if (!current) {
      toInsert.push(source);
      continue;
    }

    unchanged++;
    // Reported, never corrected — `sourceEnabled` is operator-owned.
    if (current.sourceEnabled === false) disabled.push(source.sourceGroup);
  }

  return { toInsert, unchanged, disabled };
}

// ── Write ───────────────────────────────────────────────────────────────────

export interface WriteResult {
  written: number;
  skipped: number;
}

function isNamedError(error: unknown, names: string[]): boolean {
  return error instanceof Error && names.includes(error.name);
}

const isConditionalCheckFailed = (error: unknown): boolean =>
  isNamedError(error, ['ConditionalCheckFailedException']);

const isThrottle = (error: unknown): boolean =>
  isNamedError(error, [
    'ProvisionedThroughputExceededException',
    'ThrottlingException',
    'RequestLimitExceeded',
  ]);

/**
 * Insert the missing rows. The condition — not the preceding read — is what
 * guarantees an existing row is never overwritten; BatchWriteItem cannot carry
 * one, which is why this issues individual puts.
 */
export async function insertSources(
  documentClient: DynamoDBDocumentClient,
  config: Config,
  sources: Source[],
): Promise<WriteResult> {
  const result: WriteResult = { written: 0, skipped: 0 };

  const putOne = async (source: Source): Promise<void> => {
    for (let attempt = 0; ; attempt++) {
      try {
        await documentClient.send(
          new PutCommand({
            TableName: config.tableName,
            Item: source,
            // On a composite-key table this means "no item at this exact
            // (sourceID, sourceGroup)", not "nothing in this partition".
            ConditionExpression: 'attribute_not_exists(#sourceID)',
            ExpressionAttributeNames: { '#sourceID': 'sourceID' },
          }),
        );
        result.written++;
        return;
      } catch (error) {
        // Someone else inserted it between the read and now. Not a failure.
        if (isConditionalCheckFailed(error)) {
          result.skipped++;
          return;
        }
        if (!isThrottle(error) || attempt >= MAX_BATCH_RETRIES) throw error;
        await sleep(200 * 2 ** attempt);
      }
    }
  };

  for (const window of chunk(sources, WRITE_CHUNK_SIZE)) {
    await Promise.all(window.map(putOne));
    console.log(
      ` written ${result.written + result.skipped}/${sources.length}`,
    );
  }

  return result;
}

// ── Orphans ─────────────────────────────────────────────────────────────────

/**
 * Rows previously seeded under this namespace that upstream no longer
 * publishes. Report only — removing data is not a deploy script's call.
 */
export async function scanOrphans(
  documentClient: DynamoDBDocumentClient,
  config: Config,
  desired: Source[],
): Promise<string[]> {
  const desiredKeys = new Set(desired.map(keyOf));
  const orphans: string[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  let pages = 0;

  do {
    if (pages >= MAX_SCAN_PAGES) {
      console.warn(
        ` orphan check stopped after ${MAX_SCAN_PAGES} pages — results are incomplete`,
      );
      break;
    }

    const result = await documentClient.send(
      new ScanCommand({
        TableName: config.tableName,
        FilterExpression: '#sourceNamespace = :namespace',
        ProjectionExpression: '#sourceID, #sourceGroup',
        ExpressionAttributeNames: {
          '#sourceNamespace': 'sourceNamespace',
          '#sourceID': 'sourceID',
          '#sourceGroup': 'sourceGroup',
        },
        ExpressionAttributeValues: { ':namespace': SOURCE_NAMESPACE },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    for (const item of result.Items ?? []) {
      const source = item as ExistingSource;
      if (!desiredKeys.has(keyOf(source))) orphans.push(source.sourceGroup);
    }

    exclusiveStartKey = result.LastEvaluatedKey;
    pages++;
  } while (exclusiveStartKey);

  return orphans;
}

// ── Main ────────────────────────────────────────────────────────────────────

export async function main(argv?: string[]): Promise<void> {
  const config = parseConfig(argv);

  console.log('============================================');
  console.log('Seed travel-advice sources');
  console.log('============================================');
  console.log(`Table: ${config.tableName}`);
  console.log(`Region: ${config.region}`);
  console.log(`Namespace: ${SOURCE_NAMESPACE}`);
  console.log(`Mode: ${config.dryRun ? 'dry-run' : 'write'}`);
  console.log('');

  const client = new DynamoDBClient({ region: config.region });
  const documentClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });

  console.log('Checking table...');
  await assertTableActive(client, config.tableName);

  console.log(`Fetching countries from ${SOURCE_URL}...`);
  const countries = await fetchCountries();
  console.log(` ${countries.length} countries published upstream`);

  // Desired rows are built first: their keys are the input to the state check.
  const desired = buildDesiredSources(countries, new Date().toISOString());

  console.log('Reading current state...');
  const existing = await readExistingSources(documentClient, config, desired);
  console.log(` ${existing.size} of ${desired.length} already present`);

  const plan = buildPlan(desired, existing);
  const orphans = config.checkOrphans
    ? await scanOrphans(documentClient, config, desired)
    : [];

  console.log('');
  console.log('Plan:');
  console.log(` missing (will insert): ${plan.toInsert.length}`);
  console.log(` unchanged (skipped): ${plan.unchanged}`);
  if (plan.disabled.length > 0) {
    console.log(
      ` existing but disabled (left alone): ${plan.disabled.join(', ')}`,
    );
  }
  if (orphans.length > 0) {
    console.log(` no longer published upstream: ${orphans.join(', ')}`);
  }
  console.log('');

  if (plan.toInsert.length === 0) {
    console.log('Nothing to do — table is already seeded.');
    return;
  }

  if (config.dryRun) {
    for (const source of plan.toInsert) {
      console.log(` would insert: ${source.sourceGroup}`);
    }
    console.log('');
    console.log(`Dry run — ${plan.toInsert.length} row(s) would be inserted.`);
    return;
  }

  console.log(`Inserting ${plan.toInsert.length} row(s)...`);
  const { written, skipped } = await insertSources(
    documentClient,
    config,
    plan.toInsert,
  );

  console.log('');
  console.log(
    `Seed complete — ${written} row(s) inserted${
      skipped > 0 ? `, ${skipped} already present` : ''
    }.`,
  );
}

/**
 * Only run when invoked directly, so the module can be imported by tests.
 * Matched on the entry filename rather than `import.meta`, which is not
 * available when this file is loaded as CommonJS.
 */
function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return basename(entry).replace(/\.[cm]?[jt]s$/, '') === 'seed-travel-events-source';
}

if (isEntrypoint()) {
  main().catch((error) => {
    if (error instanceof UsageError) {
      const log = error.exitCode === 0 ? console.log : console.error;
      log(error.message);
      process.exit(error.exitCode);
    }
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}


