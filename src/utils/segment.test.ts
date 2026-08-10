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

  it('rethrows a non-Error throw without calling addError', async () => {
    const parentSegment = {};
    const nonError = { code: 'UNEXPECTED', detail: 'not an Error instance' };

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
        throw nonError;
      }),
    ).rejects.toStrictEqual(nonError);

    expect(subsegment.addError).not.toHaveBeenCalled();
    expect(subsegment.close).toHaveBeenCalledTimes(1);
    expect(tracer.setSegment).toHaveBeenLastCalledWith(parentSegment);
  });
});
