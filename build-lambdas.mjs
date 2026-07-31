import { build } from 'esbuild';

await build({
  entryPoints: ['src/travel-digestion/index.ts'],
  outdir: 'dist/travel-alerts',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  tsconfig: 'tsconfig.json',
});
