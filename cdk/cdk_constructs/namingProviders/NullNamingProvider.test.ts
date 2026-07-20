import { NullNamingProvider } from './NullNamingProvider';
import { describe, test, expect } from 'vitest';

describe('Null Naming Provider', () => {
  test('naming provider doesnt amend the id', () => {
    const env = (
      process.env.ENVIRONMENT ??
      process.env.USER ??
      'unkown'
    ).replace(/[^a-zA-Z0-9-]/g, '');

    const namingProvider = new NullNamingProvider();
    expect(namingProvider.getResourceId('fred')).toBe('fred');
    expect(namingProvider.getResourceId('fred')).not.toContain(env);
  });

  test('naming provider doesnt amend the name', () => {
    const env = (
      process.env.ENVIRONMENT ??
      process.env.USER ??
      'unkown'
    ).replace(/[^a-zA-Z0-9-]/g, '');

    const namingProvider = new NullNamingProvider();
    expect(namingProvider.getResourceName('fred')).toBe('fred');
    expect(namingProvider.getResourceName('fred')).not.toContain(env);
  });
});
