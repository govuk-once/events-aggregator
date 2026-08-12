import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Logger } from '@aws-lambda-powertools/logger';
import { MetricUnit } from '@aws-lambda-powertools/metrics';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import nock from 'nock';
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';

import { metrics } from '../utils/observability';
import type { DynamoEvent, DigestScheduleEvent } from '../types/event';
import {
  buildCountryDigestMarkdown,
  buildDigestPayload,
  getDigestStartTime,
  groupEventsByCountry,
  handler,
} from '.';

vi.stubEnv('EVENT_STORE_TABLE_NAME', 'event-store-table');
vi.stubEnv('SSM_PREFIX', 'prefix');
vi.stubEnv('UNS_API_KEY_ARN', 'api-key');

const dynamoMock = mockClient(DynamoDBDocumentClient);

const { ssmSendMock } = vi.hoisted(() => ({ ssmSendMock: vi.fn() }));

vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class {
    send = ssmSendMock;
  },
  GetParametersByPathCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

vi.mock('@aws-lambda-powertools/parameters/secrets', () => ({
  getSecret: vi.fn(),
}));

const mockGetSecret = vi.mocked(getSecret) as ReturnType<typeof vi.fn>;

const { segmentMock, subsegmentMock } = vi.hoisted(() => {
  const subsegmentMock = {
    addAnnotation: vi.fn(),
    addMetadata: vi.fn(),
  };

  const segmentMock = vi.fn(
    async <T>(
      _tracer: unknown,
      _name: string,
      fn: (seg: typeof subsegmentMock) => Promise<T> | T,
    ): Promise<T> => fn(subsegmentMock),
  );

  return { segmentMock, subsegmentMock };
});

vi.mock('../utils/segment', () => ({ segment: segmentMock }));

const { mockSendToSubscribers } = vi.hoisted(() => ({
  mockSendToSubscribers: vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, data: undefined }),
}));

vi.mock('../utils/uns-client', () => ({
  createUnsMtlsClientFromSecrets: vi.fn().mockResolvedValue({
    notification: {
      sendToSubscribers: mockSendToSubscribers,
    },
  }),
}));

const loggerInfoSpy = vi
  .spyOn(Logger.prototype, 'info')
  .mockImplementation(() => {});
const loggerErrorSpy = vi
  .spyOn(Logger.prototype, 'error')
  .mockImplementation(() => {});

const metricsAddSpy = vi.spyOn(metrics, 'addMetric');
const metricsPublishSpy = vi
  .spyOn(metrics, 'publishStoredMetrics')
  .mockImplementation(() => metrics);

const makeEvent = (overrides: Partial<DynamoEvent> = {}): DynamoEvent => ({
  eventID: 'evt-1',
  compositeKey: 'travel/spain',
  eventTimestamp: '2026-08-10T12:00:00.000Z',
  namespace: 'travel',
  group: 'spain',
  eventNote: 'Safety conditions have changed.',
  processingStatus: {},
  ...overrides,
});

const dailyScheduleEvent: DigestScheduleEvent = {
  triggeredAt: '2026-08-11T00:00:00.000Z',
  schedule: 'daily',
};

const setupSsmResponse = () => {
  ssmSendMock.mockResolvedValueOnce({
    Parameters: [
      { Name: '/prefix/uns-api-url', Value: 'https://uns.example.com' },
      { Name: '/prefix/uns-mtls-cert-arn', Value: 'arn::cert' },
      { Name: '/prefix/uns-mtls-key-arn', Value: 'arn::key' },
    ],
  });
  mockGetSecret.mockResolvedValue('-----BEGIN');
};

// ---------------------------------------------------------------------------
// Pure-function unit tests
// ---------------------------------------------------------------------------

describe('getDigestStartTime', () => {
  it('subtracts 24 hours for daily', () => {
    expect(getDigestStartTime('2026-08-11T00:00:00.000Z', 'daily')).toBe(
      '2026-08-10T00:00:00.000Z',
    );
  });

  it('subtracts 7 days for weekly', () => {
    expect(getDigestStartTime('2026-08-11T00:00:00.000Z', 'weekly')).toBe(
      '2026-08-04T00:00:00.000Z',
    );
  });
});

describe('groupEventsByCountry', () => {
  it('groups events by their group field', () => {
    const events = [
      makeEvent({ group: 'spain', eventID: 'evt-1' }),
      makeEvent({ group: 'france', eventID: 'evt-2' }),
      makeEvent({ group: 'spain', eventID: 'evt-3' }),
    ];

    const grouped = groupEventsByCountry(events);

    expect(grouped.size).toBe(2);
    expect(grouped.get('spain')).toHaveLength(2);
    expect(grouped.get('france')).toHaveLength(1);
  });

  it('returns an empty map for an empty array', () => {
    expect(groupEventsByCountry([])).toEqual(new Map());
  });
});

describe('buildCountryDigestMarkdown', () => {
  it('renders each event as a bullet with note and timestamp', () => {
    const events = [
      makeEvent({
        eventNote: 'Note A',
        eventTimestamp: '2026-08-10T10:00:00.000Z',
      }),
    ];

    const md = buildCountryDigestMarkdown(events);

    expect(md).toContain('- Note A');
    expect(md).toContain('_Updated: 2026-08-10T10:00:00.000Z_');
  });

  it('orders events newest-first', () => {
    const events = [
      makeEvent({
        eventNote: 'Older',
        eventTimestamp: '2026-08-09T00:00:00.000Z',
      }),
      makeEvent({
        eventNote: 'Newer',
        eventTimestamp: '2026-08-10T00:00:00.000Z',
      }),
    ];

    const md = buildCountryDigestMarkdown(events);

    expect(md.indexOf('Newer')).toBeLessThan(md.indexOf('Older'));
  });
});

describe('buildDigestPayload', () => {
  it('sets the correct namespace, group, and subgroup', () => {
    const payload = buildDigestPayload('spain', [makeEvent()], 'daily');

    expect(payload.Namespace).toBe('travel');
    expect(payload.Group).toBe('spain');
    expect(payload.Subgroup).toBe('daily');
  });

  it('capitalises hyphenated country slugs in the title', () => {
    const payload = buildDigestPayload('saudi-arabia', [makeEvent()], 'daily');

    expect(payload.NotificationTitle).toContain('Saudi Arabia');
    expect(payload.MessageTitle).toContain('Saudi Arabia');
  });

  it('uses singular "alert" when there is one event', () => {
    const payload = buildDigestPayload('spain', [makeEvent()], 'weekly');

    expect(payload.NotificationBody).toContain('1 new travel alert for Spain');
  });

  it('uses plural "alerts" when there are multiple events', () => {
    const events = [makeEvent({ eventID: 'a' }), makeEvent({ eventID: 'b' })];
    const payload = buildDigestPayload('spain', events, 'daily');

    expect(payload.NotificationBody).toContain('2 new travel alerts for Spain');
  });

  it('sets MessageBody to the country markdown', () => {
    const events = [makeEvent({ eventNote: 'Advisory updated' })];
    const payload = buildDigestPayload('spain', events, 'daily');

    expect(payload.MessageBody).toContain('Advisory updated');
    expect(payload.MessageBody).toContain('_Updated:');
  });
});

describe('aggregated-event handler', () => {
  beforeEach(() => {
    dynamoMock.reset();
    ssmSendMock.mockReset();
    mockGetSecret.mockReset();
    mockSendToSubscribers.mockReset();
    mockSendToSubscribers.mockResolvedValue({
      ok: true,
      status: 200,
      data: undefined,
    });
  });

  afterEach(() => {
    loggerInfoSpy.mockClear();
    loggerErrorSpy.mockClear();
    metricsAddSpy.mockClear();
    metricsPublishSpy.mockClear();
    segmentMock.mockClear();
    subsegmentMock.addAnnotation.mockClear();
  });

  afterAll(() => {
    nock.cleanAll();
  });

  it('returns false and logs when no events are found', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    const result = await handler(dailyScheduleEvent);

    expect(result).toBe(false);

    expect(loggerInfoSpy).toHaveBeenCalledWith(
      'aggregated-event: no unprocessed events found',
      expect.objectContaining({ cadence: 'daily' }),
    );

    expect(metricsAddSpy).toHaveBeenCalledWith(
      'DigestEventsRetrieved',
      MetricUnit.Count,
      0,
    );

    expect(metricsPublishSpy).toHaveBeenCalledTimes(1);
    expect(mockSendToSubscribers).not.toHaveBeenCalled();
  });

  it('builds one payload per country and dispatches all in a single UNS call', async () => {
    const spainEvent = makeEvent({ group: 'spain', eventID: 'evt-1' });
    const franceEvent = makeEvent({
      group: 'france',
      eventID: 'evt-2',
      compositeKey: 'travel/france',
    });

    dynamoMock.on(QueryCommand).resolves({ Items: [spainEvent, franceEvent] });
    dynamoMock.on(UpdateCommand).resolves({});
    setupSsmResponse();

    const result = await handler(dailyScheduleEvent);

    expect(result).toBe(true);

    expect(metricsAddSpy).toHaveBeenCalledWith(
      'DigestEventsRetrieved',
      MetricUnit.Count,
      2,
    );
    expect(metricsAddSpy).toHaveBeenCalledWith(
      'DigestCountriesGrouped',
      MetricUnit.Count,
      2,
    );
    expect(metricsAddSpy).toHaveBeenCalledWith(
      'DigestPayloadsSubmitted',
      MetricUnit.Count,
      2,
    );
    expect(metricsAddSpy).toHaveBeenCalledWith(
      'DigestEventsMarkedProcessed',
      MetricUnit.Count,
      2,
    );
    expect(metricsPublishSpy).toHaveBeenCalledTimes(1);
    expect(mockSendToSubscribers).toHaveBeenCalledTimes(1);
    const [sentPayloads] = mockSendToSubscribers.mock.calls[0] as [
      Array<{ Group: string; Subgroup: string; Namespace: string }>,
    ];
    expect(sentPayloads).toHaveLength(2);
    expect(sentPayloads[0].Group).toBe('france');
    expect(sentPayloads[1].Group).toBe('spain');
    expect(sentPayloads[0].Subgroup).toBe('daily');
    expect(sentPayloads[0].Namespace).toBe('travel');

    expect(dynamoMock.commandCalls(UpdateCommand)).toHaveLength(2);
  });

  it('paginates the DynamoDB query when LastEvaluatedKey is returned', async () => {
    const page1Event = makeEvent({ eventID: 'evt-1' });
    const page2Event = makeEvent({ eventID: 'evt-2' });

    dynamoMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [page1Event],
        LastEvaluatedKey: { eventID: 'evt-1' },
      })
      .resolvesOnce({ Items: [page2Event] });

    dynamoMock.on(UpdateCommand).resolves({});
    setupSsmResponse();

    const result = await handler(dailyScheduleEvent);

    expect(result).toBe(true);
    expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(2);
    expect(metricsAddSpy).toHaveBeenCalledWith(
      'DigestEventsRetrieved',
      MetricUnit.Count,
      2,
    );
  });

  it('annotates the QueryUnprocessedEvents segment with cadence only', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [] });

    await handler({
      triggeredAt: '2026-08-11T00:00:00.000Z',
      schedule: 'weekly',
    });

    const queryCalls = segmentMock.mock.calls.filter(
      ([, name]) => name === 'QueryUnprocessedEvents',
    );

    expect(queryCalls).toHaveLength(1);
    expect(subsegmentMock.addAnnotation).toHaveBeenCalledWith(
      'Cadence',
      'weekly',
    );
    expect(subsegmentMock.addAnnotation).not.toHaveBeenCalledWith(
      'StartTime',
      expect.any(String),
    );
  });

  it('annotates the SubmitDigest segment with cadence and payload count', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [makeEvent()] });
    dynamoMock.on(UpdateCommand).resolves({});
    setupSsmResponse();

    await handler(dailyScheduleEvent);

    expect(subsegmentMock.addAnnotation).toHaveBeenCalledWith(
      'Cadence',
      'daily',
    );
    expect(subsegmentMock.addAnnotation).toHaveBeenCalledWith(
      'PayloadCount',
      1,
    );
  });

  it('runs segments in the correct order on the happy path', async () => {
    dynamoMock
      .on(QueryCommand)
      .resolves({ Items: [makeEvent({ group: 'spain' })] });
    dynamoMock.on(UpdateCommand).resolves({});
    setupSsmResponse();

    await handler(dailyScheduleEvent);

    expect(segmentMock.mock.calls.map(([, name]) => name)).toEqual([
      'QueryUnprocessedEvents',
      'SubmitDigest',
      'MarkEventsProcessed',
    ]);
  });

  it('emits DigestSubmissionFailures, throws, and skips marking events when UNS fails', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [makeEvent()] });
    setupSsmResponse();

    mockSendToSubscribers.mockResolvedValue({
      ok: false,
      error: { status: 500, message: 'Internal Server Error' },
    });

    await expect(handler(dailyScheduleEvent)).rejects.toThrow('UNS error: 500');

    expect(metricsAddSpy).toHaveBeenCalledWith(
      'DigestSubmissionFailures',
      MetricUnit.Count,
      1,
    );

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'aggregated-event: UNS dispatch failed',
      expect.objectContaining({ cadence: 'daily' }),
    );

    expect(dynamoMock.commandCalls(UpdateCommand)).toHaveLength(0);

    expect(metricsPublishSpy).toHaveBeenCalledTimes(1);
  });

  it('throws on an unsupported cadence and logs with schedule in context', async () => {
    const badEvent = {
      triggeredAt: '2026-08-11T00:00:00.000Z',
      schedule: 'hourly',
    } as unknown as DigestScheduleEvent;

    await expect(handler(badEvent)).rejects.toThrow(
      'Unsupported digest cadence: hourly',
    );

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'aggregated-event: handler failed',
      expect.objectContaining({ schedule: 'hourly' }),
    );

    expect(metricsPublishSpy).toHaveBeenCalledTimes(1);
  });

  it('throws and logs on unexpected DynamoDB errors', async () => {
    dynamoMock
      .on(QueryCommand)
      .rejects(new Error('DynamoDB connection refused'));

    await expect(handler(dailyScheduleEvent)).rejects.toThrow(
      'DynamoDB connection refused',
    );

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'aggregated-event: handler failed',
      expect.objectContaining({ error: expect.any(Error) }),
    );

    expect(metricsPublishSpy).toHaveBeenCalledTimes(1);
  });
});
