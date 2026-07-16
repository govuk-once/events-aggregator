export function requireEnvVars<T extends string>(
  ...names: T[]
): { [K in T]: string } {
  const missing: string[] = [];
  const values = {} as { [K in T]: string };

  for (const name of names) {
    const value = process.env[name];
    if (value === undefined || value === '') {
      missing.push(name);
    } else {
      values[name] = value;
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  return values;
}
