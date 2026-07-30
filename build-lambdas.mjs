import { build } from 'esbuild';
import glob from 'fast-glob';

const entryPoints = await glob('src/**/*.ts');

await build({
  entryPoints: entryPoints,
  outbase: 'src',
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  tsconfig: 'tsconfig.json',
}).catch(() => process.exit(1));
