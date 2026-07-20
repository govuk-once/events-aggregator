import { ServiceEnvironmentNamingProvider } from './ServiceEnvironmentNamingProvider';
import { describe, test, expect } from 'vitest';

describe('Environment Naming Provider', () => {
  test('naming provider adds enviroment and service name the id', () => {
    const env = (
      process.env.ENVIRONMENT ??
      process.env.USER ??
      'unkown'
    ).replace(/[^a-zA-Z0-9-]/g, '');

    const serviceName = 'FishMaker';

    const namingProvider = new ServiceEnvironmentNamingProvider(serviceName);
    expect(namingProvider.getResourceId('fred')).toBe(
      `${env}-${serviceName.toLowerCase()}-fred`,
    );
  });

  test('naming provider doesnt double prefix', () => {
    const env = (
      process.env.ENVIRONMENT ??
      process.env.USER ??
      'unkown'
    ).replace(/[^a-zA-Z0-9-]/g, '');

    const serviceName = 'FishMaker';

    const namingProvider = new ServiceEnvironmentNamingProvider(serviceName);
    expect(
      namingProvider.getResourceName(
        `${env}-${serviceName.toLowerCase()}-fred`,
      ),
    ).toBe(`${env}-${serviceName.toLowerCase()}-fred`);
  });

  test('naming provider adds enviroment and service name the id truncates to 40 characts max', () => {
    const env = (
      process.env.ENVIRONMENT ??
      process.env.USER ??
      'unkown'
    ).replace(/[^a-zA-Z0-9-]/g, '');

    const serviceName = 'FishMaker';
    const resourceId =
      `${env}-${serviceName.toLowerCase()}-fred-this-is-the-most-amazing-web-site-ever`.substring(
        0,
        40,
      );

    const namingProvider = new ServiceEnvironmentNamingProvider(serviceName);
    expect(
      namingProvider.getResourceId(
        'fred-this-is-the-most-amazing-web-site-ever',
      ),
    ).toBe(resourceId);
  });

  test('naming provider adds enviroment and service name the name', () => {
    const env = (
      process.env.ENVIRONMENT ??
      process.env.USER ??
      'unkown'
    ).replace(/[^a-zA-Z0-9-]/g, '');

    const serviceName = 'FishMaker';

    const namingProvider = new ServiceEnvironmentNamingProvider(serviceName);
    expect(namingProvider.getResourceName('Clair')).toBe(
      `${env}-${serviceName.toLowerCase()}-Clair`,
    );
  });

  test('naming provider adds enviroment and service name the name doesnt truncate', () => {
    const env = (
      process.env.ENVIRONMENT ??
      process.env.USER ??
      'unkown'
    ).replace(/[^a-zA-Z0-9-]/g, '');

    const serviceName = 'FishMaker';

    const namingProvider = new ServiceEnvironmentNamingProvider(serviceName);
    expect(
      namingProvider.getResourceName(
        'Clair-this-is-the-most-amazing-web-site-ever',
      ),
    ).toBe(
      `${env}-${serviceName.toLowerCase()}-Clair-this-is-the-most-amazing-web-site-ever`,
    );
  });
});
