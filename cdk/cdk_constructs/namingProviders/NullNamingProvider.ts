import { INamingProvider } from './INamingProvider';

export class NullNamingProvider implements INamingProvider {
  getPreFix(): string {
    return '';
  }

  getResourceId(id?: string): string | undefined {
    return id;
  }

  getResourceName(name: string): string {
    return name;
  }
}
