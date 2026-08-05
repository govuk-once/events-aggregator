/* eslint-disable @typescript-eslint/no-explicit-any */

import { vi, expect, describe, beforeEach, afterEach, it } from 'vitest';

import { mockClient } from 'aws-sdk-client-mock';
import { DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  assertTableActive,
  buildSource,
  contentUrlForSlug,
  fetchCountries,
  main,
  parseConfig,
  parseCountriesPayload,
  resolveTableName,
  sourceIdFor,
  UsageError,
} from './seed-travel-events-source';

const dynamoMock = mockClient(DynamoDBDocumentClient);
const clientMock = mockClient(DynamoDBClient);

const getCommandCall = (command: any, callNumber: number) =>
  dynamoMock.commandCalls(command)[callNumber - 1].args[0].input;

const TABLE = 'test-travel-sources';

/** Upstream payload with `count` synthetic countries. */
const makeChildren = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    details: {
      country: { name: `Country ${i}`, slug: `country-${i}`, synonyms: [] },
    },
  }));

const stubFetch = (children: unknown[]) => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ links: { children } }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

/** The projected shape BatchGet returns for an already-seeded row. */
const existingRow = (slug: string, extra: Record<string, unknown> = {}) => {
  const source = buildSource(slug, 'ignored');
  return {
    sourceID: source.sourceID,
    sourceGroup: source.sourceGroup,
    ...extra,
  };
};

/**
 * Drive a promise that parks on `sleep`. Only `setTimeout` is faked so
 * `AbortSignal.timeout` inside fetchCountries keeps its native behaviour.
 */
const withFakeSleep = async <T>(
  run: () => Promise<T>,
  advanceMs: number,
): Promise<T> => {
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  try {
    // Settle into a thunk so the rejection handler is attached before the
    // clock advances; awaiting later would surface as an unhandled rejection.
    const settled = run().then(
      (value) => () => value,
      (error: unknown) => () => {
        throw error;
      },
    );
    await vi.advanceTimersByTimeAsync(advanceMs);

    return (await settled)();
  } finally {
    vi.useRealTimers();
  }
};

const originalEnv = { ...process.env };

describe('seed-countries', () => {
  beforeEach(() => {
    dynamoMock.reset();
    clientMock.reset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    process.env = { ...originalEnv };
  });

  describe('sourceIdFor', () => {
    const myanmarUrl =
      'https://www.gov.uk/api/content/foreign-travel-advice/myanmar';

    // Golden value. It pins SEED_NAMESPACE, the composition order and the
    // separator: change any of them and the next deploy silently inserts a
    // second, parallel set of rows instead of recognising the existing ones.
    it('produces the pinned id for a known country', () => {
      expect(sourceIdFor('travel', 'myanmar', myanmarUrl)).toBe(
        'f94d09a5-6da5-5d27-b829-56215f36dce3',
      );
    });

    it('is stable across calls and distinct per country', () => {
      expect(sourceIdFor('travel', 'myanmar', myanmarUrl)).toBe(
        sourceIdFor('travel', 'myanmar', myanmarUrl),
      );
      expect(sourceIdFor('travel', 'france', contentUrlForSlug('france'))).toBe(
        '11bb4696-85cb-5fe9-99c8-eb0e037edd19',
      );
    });

    it('changes with the namespace', () => {
      expect(sourceIdFor('other', 'myanmar', myanmarUrl)).not.toBe(
        sourceIdFor('travel', 'myanmar', myanmarUrl),
      );
    });
  });

  describe('buildSource', () => {
    it('builds the Source shape and nothing else', () => {
      const source = buildSource('myanmar', '2026-08-05T09:14:22.031Z');

      expect(source).toEqual({
        sourceID: 'f94d09a5-6da5-5d27-b829-56215f36dce3',
        sourceNamespace: 'travel',
        sourceGroup: 'myanmar',
        accessMethod: 'api',
        URL: 'https://www.gov.uk/api/content/foreign-travel-advice/myanmar',
        sourceEnabled: true,
        lastUpdated: '2026-08-05T09:14:22.031Z',
      });
    });

    it('omits keyARN entirely rather than setting it undefined', () => {
      // Absence must not depend on the document client's removeUndefinedValues.
      expect('keyARN' in buildSource('myanmar', 'now')).toBe(false);
    });
  });

  describe('resolveTableName', () => {
    it('derives the CDK name from Environment and service', () => {
      process.env.Environment = 'stag';
      process.env.USER = 'stag';

      expect(resolveTableName({ service: 'udp', tableName: 'sources' })).toBe(
        'stag-udp-sources',
      );
    });

    it('refuses to guess when Environment is unset', () => {
      delete process.env.Environment;
      delete process.env.User;

      expect(() =>
        resolveTableName({ service: 'udp', tableName: 'sources' }),
      ).toThrow(UsageError);
    });

    it('requires one of --table or --service', () => {
      expect(() => resolveTableName({ tableName: 'sources' })).toThrow(
        /--table or --service/,
      );
    });

    it('prefers an explicit table over derivation', () => {
      process.env.Environment = 'stag';
      process.env.USER = 'stag';

      expect(
        resolveTableName({
          table: 'explicit-table',
          service: 'udp',
          tableName: 'sources',
        }),
      ).toBe('explicit-table');
    });
  });

  describe('parseConfig', () => {
    it('exits 0 for --help and 1 for a missing target', () => {
      delete process.env.TABLE_NAME;
      delete process.env.SERVICE_NAME;

      expect(() => parseConfig(['--help'])).toThrow(
        expect.objectContaining({ exitCode: 0 }),
      );
      expect(() => parseConfig([])).toThrow(
        expect.objectContaining({ exitCode: 1 }),
      );
    });

    it('rejects unknown flags', () => {
      expect(() => parseConfig(['--table', TABLE, '--nope'])).toThrow();
    });

    it('honours env fallbacks', () => {
      process.env.TABLE_NAME = TABLE;
      process.env.AWS_REGION = 'eu-west-1';
      process.env.SEED_DRY_RUN = 'true';

      expect(parseConfig([])).toEqual({
        tableName: TABLE,
        region: 'eu-west-1',
        dryRun: true,
        checkOrphans: false,
      });
    });
  });

  describe('parseCountriesPayload', () => {
    it('rejects a degraded response', () => {
      expect(() =>
        parseCountriesPayload({ links: { children: makeChildren(149) } }),
      ).toThrow(/only 149 countries/);
      expect(() => parseCountriesPayload({})).toThrow(/only 0 countries/);
    });

    it('accepts a response at the threshold', () => {
      expect(
        parseCountriesPayload({ links: { children: makeChildren(150) } }),
      ).toHaveLength(150);
    });

    it('drops children without a country slug, guard included', () => {
      const children = [...makeChildren(150), { details: {} }, {}];

      expect(parseCountriesPayload({ links: { children } })).toHaveLength(150);

      // Dropping enough entries to fall under the threshold still throws.
      expect(() =>
        parseCountriesPayload({
          links: { children: [...makeChildren(149), { details: {} }] },
        }),
      ).toThrow(/only 149 countries/);
    });
  });

  describe('fetchCountries', () => {
    it('retries a failing fetch before succeeding', async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Busy' })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ links: { children: makeChildren(226) } }),
        });
      vi.stubGlobal('fetch', fetchMock);

      const countries = await withFakeSleep(() => fetchCountries(), 3000);

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(countries).toHaveLength(226);
    });

    it('throws after exhausting its attempts', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));

      await expect(withFakeSleep(() => fetchCountries(), 3000)).rejects.toThrow(
        /Failed to fetch countries/,
      );
    });
  });

  describe('assertTableActive', () => {
    const client = new DynamoDBClient({});

    it('returns as soon as the table is ACTIVE', async () => {
      clientMock
        .on(DescribeTableCommand)
        .resolves({ Table: { TableStatus: 'ACTIVE' } });

      await assertTableActive(client, TABLE);

      expect(clientMock.commandCalls(DescribeTableCommand)).toHaveLength(1);
    });

    it('waits out CREATING', async () => {
      clientMock
        .on(DescribeTableCommand)
        .resolvesOnce({ Table: { TableStatus: 'CREATING' } })
        .resolves({ Table: { TableStatus: 'ACTIVE' } });

      vi.useFakeTimers();
      const promise = assertTableActive(client, TABLE);
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      expect(clientMock.commandCalls(DescribeTableCommand)).toHaveLength(2);
    });

    it('reports a missing table as a deployment error', async () => {
      const missing = new Error('nope');
      missing.name = 'ResourceNotFoundException';
      clientMock.on(DescribeTableCommand).rejects(missing);

      await expect(assertTableActive(client, TABLE)).rejects.toThrow(
        /does not exist/,
      );
    });

    it('gives up once the deadline passes', async () => {
      clientMock
        .on(DescribeTableCommand)
        .resolves({ Table: { TableStatus: 'CREATING' } });

      vi.useFakeTimers();
      const promise = assertTableActive(client, TABLE).then(
        () => new Error('expected the wait to time out'),
        (error: Error) => error,
      );
      await vi.advanceTimersByTimeAsync(130_000);

      expect((await promise).message).toMatch(/still CREATING after timeout/);
    });
  });

  describe('main', () => {
    const runMain = (extraArgs: string[] = []) =>
      main(['--table', TABLE, ...extraArgs]);

    beforeEach(() => {
      delete process.env.TABLE_NAME;
      delete process.env.SEED_DRY_RUN;
      clientMock
        .on(DescribeTableCommand)
        .resolves({ Table: { TableStatus: 'ACTIVE' } });
      dynamoMock.on(PutCommand).resolves({});
    });

    it('writes nothing when every source already exists', async () => {
      const children = makeChildren(226);
      stubFetch(children);
      dynamoMock.on(BatchGetCommand).callsFake((input) => ({
        Responses: {
          [TABLE]: input.RequestItems[TABLE].Keys.map(
            (key: { sourceGroup: string }) => existingRow(key.sourceGroup),
          ),
        },
      }));

      await runMain();

      expect(dynamoMock.commandCalls(PutCommand)).toHaveLength(0);
    });

    it('splits the state check into batches of 100', async () => {
      stubFetch(makeChildren(226));
      dynamoMock.on(BatchGetCommand).resolves({});

      await runMain();

      const calls = dynamoMock.commandCalls(BatchGetCommand);
      expect(calls).toHaveLength(3);
      expect(
        calls.map(
          (call: any) => call.args[0].input.RequestItems[TABLE].Keys.length,
        ),
      ).toEqual([100, 100, 26]);
      expect(
        getCommandCall(BatchGetCommand, 1).RequestItems[TABLE].ConsistentRead,
      ).toBe(true);
    });

    it('re-issues unprocessed keys and merges the results', async () => {
      stubFetch(makeChildren(150));
      const firstFifty = Array.from({ length: 50 }, (_, i) =>
        existingRow(`country-${i}`),
      );
      dynamoMock
        .on(BatchGetCommand)
        .resolvesOnce({
          Responses: { [TABLE]: firstFifty },
          UnprocessedKeys: {
            [TABLE]: {
              Keys: Array.from({ length: 50 }, (_, i) =>
                existingRow(`country-${i + 50}`),
              ),
            },
          },
        })
        .resolves({});

      await withFakeSleep(() => runMain(), 1000);

      // 2 chunks + 1 retry of the first chunk.
      expect(dynamoMock.commandCalls(BatchGetCommand)).toHaveLength(3);
      // 150 desired, 50 found -> 100 inserted.
      expect(dynamoMock.commandCalls(PutCommand)).toHaveLength(100);
    });

    it('inserts only the missing rows, guarded by a condition', async () => {
      stubFetch(makeChildren(153));
      dynamoMock.on(BatchGetCommand).callsFake((input) => ({
        Responses: {
          [TABLE]: input.RequestItems[TABLE].Keys.filter(
            (key: { sourceGroup: string }) =>
              !['country-0', 'country-1', 'country-2'].includes(
                key.sourceGroup,
              ),
          ).map((key: { sourceGroup: string }) => existingRow(key.sourceGroup)),
        },
      }));

      await runMain();

      const puts = dynamoMock.commandCalls(PutCommand);
      expect(puts).toHaveLength(3);
      expect(getCommandCall(PutCommand, 1)).toMatchObject({
        TableName: TABLE,
        ConditionExpression: 'attribute_not_exists(#sourceID)',
        ExpressionAttributeNames: { '#sourceID': 'sourceID' },
      });
      expect(
        puts
          .map((put: any) => put.args[0].input.Item.sourceGroup)
          .sort((a: string, b: string) => a.localeCompare(b)),
      ).toEqual(['country-0', 'country-1', 'country-2']);
    });

    it('treats a lost race as skipped rather than a failure', async () => {
      stubFetch(makeChildren(150));
      dynamoMock.on(BatchGetCommand).resolves({});
      const conflict = new Error('exists');
      conflict.name = 'ConditionalCheckFailedException';
      dynamoMock.on(PutCommand).rejects(conflict);

      await expect(runMain()).resolves.toBeUndefined();

      expect(dynamoMock.commandCalls(PutCommand)).toHaveLength(150);
    });

    it('never touches a row an operator disabled', async () => {
      stubFetch(makeChildren(150));
      dynamoMock.on(BatchGetCommand).callsFake((input) => ({
        Responses: {
          [TABLE]: input.RequestItems[TABLE].Keys.map(
            (key: { sourceGroup: string }) =>
              existingRow(key.sourceGroup, {
                sourceEnabled: key.sourceGroup === 'country-7' ? false : true,
                keyARN: 'arn:aws:kms:eu-west-2:111122223333:key/abc',
              }),
          ),
        },
      }));

      await runMain();

      expect(dynamoMock.commandCalls(PutCommand)).toHaveLength(0);
    });

    it('writes nothing in dry-run mode', async () => {
      stubFetch(makeChildren(226));
      dynamoMock.on(BatchGetCommand).resolves({});

      await runMain(['--dry-run']);

      expect(dynamoMock.commandCalls(PutCommand)).toHaveLength(0);
    });

    it('reports orphans without deleting them', async () => {
      stubFetch(makeChildren(150));
      dynamoMock.on(BatchGetCommand).resolves({});
      dynamoMock.on(ScanCommand).resolves({
        Items: [
          { sourceID: 'stale-id', sourceGroup: 'atlantis' },
          existingRow('country-0'),
        ],
      });

      await runMain(['--check-orphans']);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('atlantis'),
      );
      expect(dynamoMock.commandCalls(DeleteCommand)).toHaveLength(0);
    });

    it('does not scan unless orphan checking is asked for', async () => {
      stubFetch(makeChildren(150));
      dynamoMock.on(BatchGetCommand).resolves({});

      await runMain();

      expect(dynamoMock.commandCalls(ScanCommand)).toHaveLength(0);
    });
  });
});
