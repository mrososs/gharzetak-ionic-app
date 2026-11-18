// Loads the app's REAL deterministic Smart Pattern Parser (src/app/core/domain/smart-parser.ts) for the benchmark scorer.
// It is bundled with the project's own esbuild into benchmark/results/.cache (git-ignored); nothing is reimplemented here.
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');

let cached = null;

/** @returns {Promise<typeof import('../../../../src/app/core/domain/smart-parser')>} */
export async function loadSmartParser() {
  if (cached) return cached;
  const require = createRequire(join(REPO, 'package.json'));
  const esbuild = require('esbuild');
  const outDir = join(HERE, '..', 'results', '.cache');
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, 'smart-parser.mjs');
  await esbuild.build({ entryPoints: [join(REPO, 'src/app/core/domain/smart-parser.ts')], bundle: true, format: 'esm', outfile, logLevel: 'warning' });
  cached = await import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
  return cached;
}

let cachedCalc = null;
/** The app's calculator-facts helper (src/app/core/ai/calc.ts), which wraps the same Smart Pattern Parser. */
export async function loadCalc() {
  if (cachedCalc) return cachedCalc;
  const require = createRequire(join(REPO, 'package.json'));
  const esbuild = require('esbuild');
  const outDir = join(HERE, '..', 'results', '.cache');
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, 'calc.mjs');
  await esbuild.build({ entryPoints: [join(REPO, 'src/app/core/ai/calc.ts')], bundle: true, format: 'esm', outfile, logLevel: 'warning' });
  cachedCalc = await import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
  return cachedCalc;
}

/** Resolves `@name` references to the manifest's shared texts. */
export function resolveText(manifest, value) {
  if (typeof value !== 'string') return value;
  return value.replace(/@([A-Za-z][A-Za-z0-9]*)/g, (m, k) => (manifest.sharedTexts[k] !== undefined ? manifest.sharedTexts[k] : m));
}

/** Compact, comparable view of a conversion. */
export function summarize(conv) {
  return {
    status: conv.status,
    counts: conv.counts,
    parts: conv.parts.map((p) => ({
      name: p.name,
      quantity: p.quantity,
      notes: p.notes.length,
      rounds: p.rounds.map((r) => ({ n: r.n, status: r.status, calculated: r.calculated, expected: r.expected, normalized: r.normalized, codes: r.messages.map((m) => m.code) })),
    })),
  };
}
