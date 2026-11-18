#!/usr/bin/env node
// Parser baseline: runs the CURRENT Smart Pattern Parser on every ground-truth text of the benchmark (no model involved).
// This is the ceiling any model transcript can reach. Usage: node docs/khayoota-ai/benchmark/parser-baseline.mjs [--json]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSmartParser, resolveText, summarize } from './lib/parser.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(HERE, 'cases.json'), 'utf8'));
const { convertPatternText } = await loadSmartParser();

const rows = [];
for (const [key, text] of Object.entries(manifest.sharedTexts)) rows.push({ id: `shared:${key}`, text });
for (const c of manifest.cases) if (c.sourceText && !c.sourceText.startsWith('@') && (c.capability === 'extract')) rows.push({ id: c.id, text: resolveText(manifest, c.sourceText) });

const out = rows.map(({ id, text }) => ({ id, ...summarize(convertPatternText(text)) }));
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out, null, 1));
} else {
  for (const r of out) {
    const rounds = r.parts.flatMap((p) => p.rounds);
    console.log(`${r.id.padEnd(22)} ${r.status.padEnd(12)} rounds=${String(r.counts.rounds).padStart(2)}  validated=${r.counts.validated} needsReview=${r.counts.needsReview} unsupported=${r.counts.unsupported}  parts=${r.parts.length}`);
    for (const x of rounds.filter((x) => x.status !== 'validated')) console.log(`    R${x.n} ${x.status} [${x.codes.join(',')}] ${x.normalized}`);
  }
}
