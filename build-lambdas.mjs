import { build } from 'esbuild';
import { globSync } from 'node:fs';

const entryPoints = [...globSync('src/**/*.ts')]
  .filter((name) => name.endsWith('test.unit.ts') == false)
  .sort();

await build({
  entryPoints: entryPoints,
  outbase: 'src',
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  tsconfig: 'tsconfig.json',
}).catch(() => process.exit(1));
