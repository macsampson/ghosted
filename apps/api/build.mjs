import { build } from 'esbuild';
import { readdirSync } from 'fs';

const handlers = readdirSync('./src/handlers')
  .filter(f => f.endsWith('.ts'))
  .map(f => `./src/handlers/${f}`);

await build({
  entryPoints: handlers,
  bundle: true,
  platform: 'node',
  target: 'node20',
  outdir: 'dist/handlers',
  format: 'cjs',
  sourcemap: true,
});
