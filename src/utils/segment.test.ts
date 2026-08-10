import type { Tracer } from '@aws-lambda-powertools/tracer';
import { describe, expect, it, vi } from 'vitest';

import { segment } from './segment';

describe('segment', () => {
  it('executes the callback, closes the subsegment and returns the result', async () => {
    const parentSegment = {};

    const subsegment = {
      parent: parentSegment,
      addError: vi.fn(),
      close: vi.fn(),
    };

    const tracer = {
      getSegment: vi.fn(() => ({
        addNewSubsegment: vi.fn(() => subsegment),
      })),
      setSegment: vi.fn(),
    } as unknown as Tracer;

    const result = await segment(
      tracer,
      'TestOperation',
      async () => 'success',
    );

    expect(result).toBe('success');
    expect(subsegment.close).toHaveBeenCalledTimes(1);
    expect(tracer.setSegment).toHaveBeenLastCalledWith(parentSegment);
  });

  it('adds the error to the subsegment, closes it and rethrows', async () => {
    const parentSegment = {};
    const error = new Error('Something failed');

    const subsegment = {
      parent: parentSegment,
      addError: vi.fn(),
      close: vi.fn(),
    };

    const tracer = {
      getSegment: vi.fn(() => ({
        addNewSubsegment: vi.fn(() => subsegment),
      })),
      setSegment: vi.fn(),
    } as unknown as Tracer;

    await expect(
      segment(tracer, 'TestOperation', async () => {
        throw error;
      }),
    ).rejects.toThrow(error);

    expect(subsegment.addError).toHaveBeenCalledWith(error);
    expect(subsegment.close).toHaveBeenCalledTimes(1);
    expect(tracer.setSegment).toHaveBeenLastCalledWith(parentSegment);
  });

  it('throws when a subsegment cannot be created', async () => {
    const tracer = {
      getSegment: vi.fn(() => undefined),
      setSegment: vi.fn(),
    } as unknown as Tracer;

    await expect(
      segment(tracer, 'TestOperation', async () => 'success'),
    ).rejects.toThrow('Failed to initialize segment: TestOperation');
  });
});
