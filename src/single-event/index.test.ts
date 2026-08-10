import { Logger } from '@aws-lambda-powertools/logger';
import { MetricUnit } from '@aws-lambda-powertools/metrics';
import type { DynamoDBStreamEvent } from 'aws-lambda';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { metrics } from '../utils/observability';
import { handler } from '.';

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

const makeDynamoEvent = (recordCount: number): DynamoDBStreamEvent => ({
  Records: Array.from({ length: recordCount }, (_, i) => ({
    eventID: `event-${i}`,
    eventVersion: '1.1',
    eventSource: 'aws:dynamodb',
    awsRegion: 'eu-west-2',
    eventName: 'INSERT' as const,
    dynamodb: {},
    eventSourceARN:
      'arn:aws:dynamodb:eu-west-2:123456789012:table/test/stream/2026-01-01T00:00:00.000',
  })),
});

describe('single-event handler', () => {
  afterEach(() => {
    loggerInfoSpy.mockClear();
    loggerErrorSpy.mockClear();
    metricsAddSpy.mockClear();
    metricsPublishSpy.mockClear();
  });

  it('processes records, emits a metric and returns true', async () => {
    const event = makeDynamoEvent(3);

    const result = await handler(event);

    expect(result).toBe(true);

    expect(metricsAddSpy).toHaveBeenCalledWith(
      'EventStoreRecordsReceived',
      MetricUnit.Count,
      3,
    );

    expect(metricsPublishSpy).toHaveBeenCalledTimes(1);
  });

  it('logs the event on each invocation', async () => {
    const event = makeDynamoEvent(1);

    await handler(event);

    expect(loggerInfoSpy).toHaveBeenCalledWith('single-event', { event });
  });

  it('logs and rethrows on unexpected errors', async () => {
    // Force an error by passing a malformed event that will throw when Records
    // is accessed — cast to bypass type check since we are testing the catch path.
    const badEvent = null as unknown as DynamoDBStreamEvent;

    await expect(handler(badEvent)).rejects.toThrow();

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Failed to process EventStore stream records',
      expect.objectContaining({ error: expect.any(Error) }),
    );

    expect(metricsPublishSpy).toHaveBeenCalledTimes(1);
  });
});
