import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
import { z } from 'zod';

export const NonEmptyString = z.string().min(1);
export type NonEmptyString = z.output<typeof NonEmptyString>;

export function createConsumerConfigLoader<T>(schema: z.ZodType<T>) {
  return async function loadConsumerConfig(secretArn: string): Promise<T> {
    const config = await getSecret<T>(secretArn, {
      transform: 'json',
      maxAge: 600,
    });

    if (!config) {
      throw new Error('Consumer config not found');
    }

    return schema.parseAsync(config);
  };
}
const consumerConfigSchema = z.object({
  apiUrl: NonEmptyString,
  apiKey: NonEmptyString,
  roleArn: NonEmptyString,
  privateApiUrl: NonEmptyString,
  region: NonEmptyString,
});

export type ConsumerConfig = z.output<typeof consumerConfigSchema>;

export const getConsumerConfig =
  createConsumerConfigLoader(consumerConfigSchema);
