import { Tracer } from '@aws-lambda-powertools/tracer';
import type { Subsegment } from 'aws-xray-sdk-core';

export const segment = async <T = void>(
  tracer: Tracer,
  name: string,
  fn: (segment: Subsegment) => Promise<T> | T,
): Promise<T> => {
  const segment = tracer.getSegment()?.addNewSubsegment(name);

  if (segment === undefined) {
    throw new Error(`Failed to initialize segment: ${name}`);
  }

  tracer.setSegment(segment);

  try {
    return await fn(segment);
  } catch (error) {
    if (error instanceof Error) {
      segment.addError(error);
    }

    throw error;
  } finally {
    segment.close();
    tracer.setSegment(segment.parent);
  }
};
