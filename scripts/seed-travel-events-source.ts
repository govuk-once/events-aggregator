/* eslint-disable @typescript-eslint/no-explicit-any */

import { DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { v5 as uuidv5 } from 'uuid';
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
  compositeKey: string;
  accessMethod: 'api' | 'other';
  URL: string;
  sourceEnabled: boolean;
  keyARN?: string;
  lastUpdated: string;
  sourceDetail: Record<string, any>;
};

export interface Config {
  tableName: string;
  region: string;
  dryRun: boolean;
  checkOrphans: boolean;
  /**
   * When non-null, `sourceEnabled` is script-controlled: slugs in the set are
   * enabled, all others are disabled. When null, all sources are enabled and
   * `sourceEnabled` is treated as operator-owned (never overwritten).
   */
  enabledSlugs: Set<string> | null;
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

Env (not flags):
 COUNTRY_SOURCES_ENABLED JSON string array of country slugs to enable.
 When set, every source is enabled iff its slug is in the
 array; absent slugs are disabled and sourceEnabled is
 patched accordingly. When unset, all sources are enabled
 and sourceEnabled is treated as operator-owned (never
 overwritten).
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
      table: { type: 'string', default: process.env.SOURCE_TABLE_NAME },
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

  const rawEnabled = process.env.COUNTRY_SOURCES_ENABLED?.trim();
  let enabledSlugs: Set<string> | null = null;
  if (rawEnabled) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawEnabled);
    } catch {
      throw new UsageError(
        'COUNTRY_SOURCES_ENABLED must be a valid JSON array of strings',
        1,
      );
    }
    if (!Array.isArray(parsed) || parsed.some((s) => typeof s !== 'string')) {
      throw new UsageError(
        'COUNTRY_SOURCES_ENABLED must be a JSON array of strings',
        1,
      );
    }
    enabledSlugs = new Set(parsed as string[]);
  }

  return {
    tableName: resolveTableName({
      table: values.table,
      service: values.service,
      tableName: values['table-name']!,
    }),
    region: values.region!,
    dryRun: values['dry-run']!,
    checkOrphans: values['check-orphans']!,
    enabledSlugs,
  };
}

// ── Source data ─────────────────────────────────────────────────────────────

interface GovUkChild {
  public_updated_at?: string;
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
  /** ISO-8601 timestamp sourced from the upstream `public_updated_at` field. */
  lastUpdated: string;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function toCountryItem(
  child: GovUkChild,
  fallbackDate: string,
): CountryItem | null {
  const country = child.details?.country;
  // A child without a slug cannot be keyed, so it is not seedable.
  if (!country?.slug || !country.name) return null;

  return {
    slug: country.slug,
    name: country.name,
    synonyms: country.synonyms ?? [],
    lastUpdated: child.public_updated_at ?? fallbackDate,
  };
}

export function dedupeBySlug(countries: CountryItem[]): CountryItem[] {
  const bySlug = new Map<string, CountryItem>();
  for (const country of countries) bySlug.set(country.slug, country);
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Parse and validate an upstream payload. Split out so the guard is testable. */
export function parseCountriesPayload(
  body: unknown,
  fallbackDate = new Date().toISOString(),
): CountryItem[] {
  const children =
    (body as { links?: { children?: GovUkChild[] } } | null)?.links?.children ??
    [];

  const countries = children
    .map((child) => toCountryItem(child, fallbackDate))
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

export function buildSource(
  slug: string,
  country: string,
  synonyms: string[],
  lastUpdated: string,
  enabled: boolean,
): Source {
  const URL = contentUrlForSlug(slug);

  // `name` and `synonyms` from GOV.UK are deliberately dropped: Source has no
  // home for them, and a consumer can recover them at runtime by fetching URL.
  // `keyARN` is intentionally absent, not undefined — it is operator-owned.
  return {
    sourceID: sourceIdFor(SOURCE_NAMESPACE, slug, URL),
    sourceNamespace: SOURCE_NAMESPACE,
    sourceGroup: slug,
    compositeKey: `${SOURCE_NAMESPACE}/${slug}`,
    accessMethod: 'api',
    URL,
    sourceEnabled: enabled,
    sourceDetail: {
      slug,
      country,
      synonyms: synonyms ? synonyms : [],
    },
    lastUpdated,
  };
}

export function buildDesiredSources(
  countries: CountryItem[],
  enabledSlugs: Set<string> | null,
): Source[] {
  return countries.map((country) =>
    buildSource(
      country.slug,
      country.name,
      country.synonyms,
      country.lastUpdated,
      enabledSlugs === null || enabledSlugs.has(country.slug),
    ),
  );
}

// ── Current state ───────────────────────────────────────────────────────────

export interface ExistingSource {
  sourceID: string;
  sourceGroup: string;
  sourceEnabled?: boolean;
  keyARN?: string;
  lastUpdated?: string;
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
        compositeKey: `${source.sourceNamespace}/${source.sourceGroup}`,
      })),
      // A stale read would print a lying plan, and this output is the deploy
      // record of what was seeded.
      ConsistentRead: true,
      ProjectionExpression:
        '#sourceID, #sourceGroup, #sourceEnabled, #keyARN, #lastUpdated',
      ExpressionAttributeNames: {
        '#sourceID': 'sourceID',
        '#sourceGroup': 'sourceGroup',
        '#sourceEnabled': 'sourceEnabled',
        '#keyARN': 'keyARN',
        '#lastUpdated': 'lastUpdated',
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
  toUpdate: Source[];
  unchanged: number;
  disabled: string[];
  /** Existing rows whose `sourceEnabled` will flip to `true`. */
  toEnable: string[];
  /** Existing rows whose `sourceEnabled` will flip to `false`. */
  toDisable: string[];
}

export function buildPlan(
  desired: Source[],
  existing: Map<string, ExistingSource>,
  enabledSlugs: Set<string> | null,
): SeedPlan {
  const toInsert: Source[] = [];
  const toUpdate: Source[] = [];
  const disabled: string[] = [];
  const toEnable: string[] = [];
  const toDisable: string[] = [];
  let unchanged = 0;

  for (const source of desired) {
    const current = existing.get(keyOf(source));

    if (!current) {
      toInsert.push(source);
      if (!source.sourceEnabled) disabled.push(source.sourceGroup);
      continue;
    }

    // `sourceEnabled` is operator-owned unless enabledSlugs is set, in which
    // case the script is authoritative for that field.
    const enabledDrifted =
      enabledSlugs !== null && current.sourceEnabled !== source.sourceEnabled;

    if (enabledDrifted) {
      if (source.sourceEnabled) toEnable.push(source.sourceGroup);
      else toDisable.push(source.sourceGroup);
    } else if (current.sourceEnabled === false) {
      disabled.push(source.sourceGroup);
    }

    // Never advance a stored timestamp — only patch when the upstream date is
    // earlier than what is already in the DB (or the field is absent on an old row).
    const dateDrifted =
      !current.lastUpdated || source.lastUpdated < current.lastUpdated;

    if (dateDrifted || enabledDrifted) {
      toUpdate.push(source);
    } else {
      unchanged++;
    }
  }

  return { toInsert, toUpdate, unchanged, disabled, toEnable, toDisable };
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

// ── Patch ────────────────────────────────────────────────────────────────────

/**
 * Patch `lastUpdated` on rows that already exist but whose upstream timestamp
 * has drifted. Only this field is touched; all operator-owned fields are left
 * as-is.
 */
export async function patchSources(
  documentClient: DynamoDBDocumentClient,
  config: Config,
  sources: Source[],
  patchEnabled: boolean,
): Promise<WriteResult> {
  const result: WriteResult = { written: 0, skipped: 0 };

  const patchOne = async (source: Source): Promise<void> => {
    for (let attempt = 0; ; attempt++) {
      try {
        await documentClient.send(
          new UpdateCommand({
            TableName: config.tableName,
            Key: {
              sourceID: source.sourceID,
              compositeKey: source.compositeKey,
            },
            UpdateExpression: patchEnabled
              ? 'SET #lastUpdated = :lastUpdated, #sourceEnabled = :sourceEnabled'
              : 'SET #lastUpdated = :lastUpdated',
            ExpressionAttributeNames: patchEnabled
              ? {
                  '#lastUpdated': 'lastUpdated',
                  '#sourceEnabled': 'sourceEnabled',
                }
              : { '#lastUpdated': 'lastUpdated' },
            ExpressionAttributeValues: patchEnabled
              ? {
                  ':lastUpdated': source.lastUpdated,
                  ':sourceEnabled': source.sourceEnabled,
                }
              : { ':lastUpdated': source.lastUpdated },
          }),
        );
        result.written++;
        return;
      } catch (error) {
        if (!isThrottle(error) || attempt >= MAX_BATCH_RETRIES) throw error;
        await sleep(200 * 2 ** attempt);
      }
    }
  };

  for (const window of chunk(sources, WRITE_CHUNK_SIZE)) {
    await Promise.all(window.map(patchOne));
    console.log(
      ` patched ${result.written + result.skipped}/${sources.length}`,
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
  const desired = buildDesiredSources(countries, config.enabledSlugs);

  if (config.enabledSlugs !== null) {
    const enabledCount = desired.filter((s) => s.sourceEnabled).length;
    const disabledCount = desired.length - enabledCount;
    console.log(
      `Enabled filter: ${config.enabledSlugs.size} slug(s) → ${enabledCount} enabled, ${disabledCount} disabled`,
    );
  }

  console.log('Reading current state...');
  const existing = await readExistingSources(documentClient, config, desired);
  console.log(` ${existing.size} of ${desired.length} already present`);

  const plan = buildPlan(desired, existing, config.enabledSlugs);
  const orphans = config.checkOrphans
    ? await scanOrphans(documentClient, config, desired)
    : [];

  console.log('');
  console.log('Plan:');
  console.log(` missing (will insert): ${plan.toInsert.length}`);
  if (plan.toInsert.length > 0 && config.enabledSlugs !== null) {
    const insertEnabled = plan.toInsert.filter((s) => s.sourceEnabled).length;
    const insertDisabled = plan.toInsert.length - insertEnabled;
    console.log(`   → ${insertEnabled} enabled, ${insertDisabled} disabled`);
  }
  console.log(` will patch: ${plan.toUpdate.length}`);
  if (plan.toEnable.length > 0) {
    console.log(
      `   → will enable (${plan.toEnable.length}): ${plan.toEnable.join(', ')}`,
    );
  }
  if (plan.toDisable.length > 0) {
    console.log(
      `   → will disable (${plan.toDisable.length}): ${plan.toDisable.join(', ')}`,
    );
  }
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

  if (plan.toInsert.length === 0 && plan.toUpdate.length === 0) {
    console.log('Nothing to do — table is already up-to-date.');
    return;
  }

  if (config.dryRun) {
    for (const source of plan.toInsert) {
      const enabledTag =
        config.enabledSlugs !== null
          ? ` [${source.sourceEnabled ? 'enabled' : 'disabled'}]`
          : '';
      console.log(` would insert: ${source.sourceGroup}${enabledTag}`);
    }
    const toEnableSet = new Set(plan.toEnable);
    const toDisableSet = new Set(plan.toDisable);
    for (const source of plan.toUpdate) {
      const parts: string[] = [`lastUpdated → ${source.lastUpdated}`];
      if (toEnableSet.has(source.sourceGroup))
        parts.push('sourceEnabled → true');
      if (toDisableSet.has(source.sourceGroup))
        parts.push('sourceEnabled → false');
      console.log(` would patch: ${source.sourceGroup} (${parts.join(', ')})`);
    }
    console.log('');
    console.log(
      `Dry run — ${plan.toInsert.length} row(s) would be inserted, ${plan.toUpdate.length} row(s) would be patched.`,
    );
    return;
  }

  let inserted = 0;
  let insertSkipped = 0;
  if (plan.toInsert.length > 0) {
    console.log(`Inserting ${plan.toInsert.length} row(s)...`);
    const r = await insertSources(documentClient, config, plan.toInsert);
    inserted = r.written;
    insertSkipped = r.skipped;
  }

  let patched = 0;
  if (plan.toUpdate.length > 0) {
    console.log(`Patching ${plan.toUpdate.length} row(s)...`);
    const r = await patchSources(
      documentClient,
      config,
      plan.toUpdate,
      config.enabledSlugs !== null,
    );
    patched = r.written;
  }

  console.log('');
  const parts: string[] = [];
  if (inserted > 0 || insertSkipped > 0) {
    parts.push(
      `${inserted} row(s) inserted${insertSkipped > 0 ? ` (${insertSkipped} already present)` : ''}`,
    );
  }
  if (patched > 0) parts.push(`${patched} row(s) patched`);
  console.log(`Seed complete — ${parts.join(', ')}.`);
}

/**
 * Only run when invoked directly, so the module can be imported by tests.
 * Matched on the entry filename rather than `import.meta`, which is not
 * available when this file is loaded as CommonJS.
 */
function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return (
    basename(entry).replace(/\.[cm]?[jt]s$/, '') === 'seed-travel-events-source'
  );
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
