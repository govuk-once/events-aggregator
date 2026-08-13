import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { updateEventStatus } from './event';

const ddb = mockClient(DynamoDBDocumentClient);
const key = { eventID: 'evt-1', compositeKey: 'travel/spain' };
const input = () => ddb.commandCalls(UpdateCommand)[0].args[0].input;

describe('updateEventStatus', () => {
  beforeEach(() => ddb.reset());

  it('throws when no usable timestamps are supplied', async () => {
    await expect(
      updateEventStatus('event-table', key, {
        instant: '   ',
        daily: undefined as never,
      }),
    ).rejects.toThrow('No timestamps supplied');

    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('throws on unknown cadences without calling dynamo', async () => {
    await expect(
      updateEventStatus('event-table', key, {
        yearly: '2026-08-10T09:14:22.031Z',
      } as never),
    ).rejects.toThrow('Unknown cadence(s): yearly');

    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('builds an if_not_exists expression per cadence by default', async () => {
    ddb.on(UpdateCommand).resolves({
      Attributes: { processingStatus: { instant: 'a', daily: 'b' } },
    });

    const result = await updateEventStatus('event-table', key, {
      instant: 'a',
      daily: 'b',
    });

    expect(input().UpdateExpression).toBe(
      'SET #status.#c0 = if_not_exists(#status.#c0, :t0), ' +
        '#status.#c1 = if_not_exists(#status.#c1, :t1)',
    );
    expect(input().ExpressionAttributeNames).toEqual({
      '#eventID': 'eventID',
      '#status': 'processingStatus',
      '#c0': 'instant',
      '#c1': 'daily',
    });
    expect(input().ExpressionAttributeValues).toEqual({
      ':t0': 'a',
      ':t1': 'b',
    });
    expect(result).toEqual({ instant: 'a', daily: 'b' });
  });

  it('overwrites unconditionally when asked', async () => {
    ddb.on(UpdateCommand).resolves({});

    await updateEventStatus(
      'event-table',
      key,
      { instant: 'a' },
      { overwrite: true },
    );

    expect(input().UpdateExpression).toBe('SET #status.#c0 = :t0');
  });

  it('returns an empty status when dynamo returns no attributes', async () => {
    ddb.on(UpdateCommand).resolves({});

    await expect(
      updateEventStatus('event-table', key, { instant: 'a' }),
    ).resolves.toEqual({});
  });

  it('translates a failed conditional check into a missing-event error', async () => {
    const cause = new Error('The conditional request failed');
    cause.name = 'ConditionalCheckFailedException';
    ddb.on(UpdateCommand).rejects(cause);

    await expect(
      updateEventStatus('event-table', key, { instant: 'a' }),
    ).rejects.toMatchObject({
      message: 'No event evt-1 / travel/spain to update',
      cause,
    });
  });

  it('rethrows any other dynamo error untouched', async () => {
    ddb.on(UpdateCommand).rejects(new Error('Throughput exceeded'));

    await expect(
      updateEventStatus('event-table', key, { instant: 'a' }),
    ).rejects.toThrow('Throughput exceeded');
  });
});
