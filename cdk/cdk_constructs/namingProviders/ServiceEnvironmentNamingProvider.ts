import { INamingProvider } from './INamingProvider';

export class ServiceEnvironmentNamingProvider implements INamingProvider {
  private readonly serviceName: string;

  constructor(serviceName?: string) {
    this.serviceName = serviceName ?? 'service name not set';
  }

  getPreFix(): string {
    const environment = this.getEnvironment();
    return `${environment}-${this.serviceName}`.toLowerCase();
  }

  getResourceName(name: string): string {
    if (name && !name.startsWith(this.getPreFix())) {
      return `${this.getPreFix()}-${name}`;
    }
    return name;
  }

  getResourceId(id?: string): string | undefined {
    if (id && !id.startsWith(this.getPreFix())) {
      const prefix = `${this.getPreFix()}-${id}`.toLowerCase();
      return prefix.substring(0, 40);
    }
    return id;
  }

  getEnvironment = (): string => {
    const env = process.env.ENVIRONMENT || process.env.USER;
    if (!env) {
      throw new Error(
        'Unable to determine environment: Neither ENVIRONMENT nor USER environment variables are set',
      );
    }
    return env.replace(/[^a-zA-Z0-9-]/g, '');
  };
}
