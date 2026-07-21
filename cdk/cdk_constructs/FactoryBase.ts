import { INamingProvider } from './namingProviders/INamingProvider';
import { ServiceEnvironmentNamingProvider } from './namingProviders/ServiceEnvironmentNamingProvider';

export abstract class FactoryBase {
  private readonly namingProvider: INamingProvider;

  protected constructor(serviceName: string, namingProvider?: INamingProvider) {
    this.namingProvider =
      namingProvider ?? new ServiceEnvironmentNamingProvider(serviceName);
  }

  getResourceId(id?: string): string {
    return this.namingProvider.getResourceId(id) ?? 'not set';
  }

  getResourceName(name: string): string {
    return this.namingProvider.getResourceName(name);
  }
}
