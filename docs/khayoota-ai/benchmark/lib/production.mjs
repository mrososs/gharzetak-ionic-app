// Bundles the PRODUCTION Khayoota prompt + contract modules (apps/api/src/services/ai) so the benchmark exercises exactly
// the prompts, JSON schemas and output sanitising that the Worker uses. Output goes to results/.cache (git-ignored).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');
let cached = null;

export async function loadProduction() {
  if (cached) return cached;
  const require = createRequire(join(REPO, 'package.json'));
  const esbuild = require('esbuild');
  const outDir = join(HERE, '..', 'results', '.cache');
  mkdirSync(outDir, { recursive: true });
  const entry = join(REPO, 'apps/api/src/services/ai/bench-entry.gen.ts');
  writeFileSync(entry, "export * from './prompts';\nexport * from './contracts';\nexport * from './knowledge';\n");
  const outfile = join(outDir, 'khayoota-production.mjs');
  try {
    await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], outfile, logLevel: 'warning' });
  } finally {
    (await import('node:fs')).rmSync(entry, { force: true });
  }
  cached = await import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
  return cached;
}
