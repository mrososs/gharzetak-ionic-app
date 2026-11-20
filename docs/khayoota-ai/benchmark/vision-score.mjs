// Scores the transcripts written by vision-compare.mjs: parser outcome (the real Smart Parser via the app's own
// previewFromTranscript), structural integrity, and — when a LOCAL reference exists — text fidelity.
// Reads only git-ignored files in results/. Prints metrics; never prints transcript text beyond short mismatch examples.
//   node docs/khayoota-ai/benchmark/vision-score.mjs --label r1 [--reference results/giraffe-reference.json]
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadProduction } from './lib/production.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const RES = join(HERE, 'results');
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const label = opt('--label', 'r1');
const refPath = opt('--reference', join(RES, 'giraffe-reference.json'));

const require = createRequire(join(REPO, 'package.json'));
const esbuild = require('esbuild');
mkdirSync(join(RES, '.cache'), { recursive: true });
const out = join(RES, '.cache', 'transcript-draft.mjs');
await esbuild.build({ entryPoints: [join(REPO, 'src/app/core/ai/transcript-draft.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { previewFromTranscript } = await import(`file:///${out.replace(/\\/g, '/')}?t=${Date.now()}`);
const prod = await loadProduction();

/** Letters-only comparison: Arabic digits → latin, tashkeel/alef/ya variants folded, punctuation and spaces removed. */
const norm = (s) =>
  String(s)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
const lev = (a, b) => {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
};
const sim = (a, b) => (a.length || b.length ? 1 - lev(a, b) / Math.max(a.length, b.length) : 1);

function load(c, m) {
  const f = join(RES, `vision-${label}-${c}-${m}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}

function transcriptOf(row) {
  if (!row?.json) return null;
  try {
    return prod.toTranscript(prod.modelTranscript.parse(row.json));
  } catch {
    return null;
  }
}

function structural(t) {
  const lines = t.lines;
  const unbalanced = lines.filter((l) => l.kind === 'round' && ((l.text.match(/[(\[]/g) ?? []).length !== (l.text.match(/[)\]]/g) ?? []).length)).length;
  return {
    lines: lines.length,
    partHeadings: lines.filter((l) => l.kind === 'part-heading').length,
    rounds: lines.filter((l) => l.kind === 'round').length,
    notes: lines.filter((l) => l.kind === 'note' || l.kind === 'assembly').length,
    pages: [...new Set(lines.map((l) => l.page))].sort(),
    unbalancedRoundLines: unbalanced,
    legibility: lines.reduce((a, x) => ((a[x.legibility] = (a[x.legibility] ?? 0) + 1), a), {}),
    sourceClass: t.sourceClass,
    title: t.title,
    warnings: t.warnings.map((w) => w.code),
  };
}

function parser(t) {
  const pv = previewFromTranscript(t, 'x');
  if (!pv) return null;
  return { parts: pv.parts.map((p) => `${p.name.slice(0, 22)}×${p.quantity}`), rounds: pv.counts.rounds, validated: pv.counts.validated, needsReview: pv.counts.needsReview, unsupported: pv.counts.unsupported, unbalanced: pv.parts.flatMap((p) => p.rounds).filter((r) => r.codes.includes('ai-unbalanced')).length };
}

/** Fidelity of a transcript against a LOCAL provisional reference (list of strings). */
function fidelity(t, refLines) {
  const model = t.lines.filter((l) => l.kind !== 'title' && l.kind !== 'other').map((l) => norm(l.text)).filter(Boolean);
  const cands = [];
  for (let i = 0; i < model.length; i++) for (let k = 1; k <= 3 && i + k <= model.length; k++) cands.push(model.slice(i, i + k).join(''));
  const refs = refLines.map(norm).filter(Boolean);
  const best = refs.map((r) => Math.max(...cands.map((c) => sim(r, c))));
  const refCands = [];
  for (let i = 0; i < refs.length; i++) for (let k = 1; k <= 3 && i + k <= refs.length; k++) refCands.push(refs.slice(i, i + k).join(''));
  const modelBest = model.map((m) => Math.max(...refCands.map((r) => sim(m, r))));
  const mean = best.reduce((a, b) => a + b, 0) / (best.length || 1);
  return {
    refLines: refs.length,
    meanSimilarity: +mean.toFixed(3),
    exact: best.filter((s) => s >= 0.98).length,
    misread: best.filter((s) => s >= 0.6 && s < 0.98).length,
    missing: best.filter((s) => s < 0.6).length,
    unmatchedModelLines: modelBest.filter((s) => s < 0.55).length,
  };
}

const report = {};
for (const c of ['giraffe', 'chicken']) {
  for (const m of ['gemma-4-26b-a4b-it', 'qwen3.8-27b']) {
    const row = load(c, m);
    if (!row) continue;
    const t = transcriptOf(row);
    const e = { ok: row.ok, valid: row.valid, ms: row.latencyMs, tokens: row.usage ? `${row.usage.input}/${row.usage.output}` : null, neurons: row.neurons, finish: row.finish };
    if (t) {
      e.structure = structural(t);
      e.parser = parser(t);
      if (c === 'giraffe' && existsSync(refPath)) {
        const ref = JSON.parse(readFileSync(refPath, 'utf8'));
        const refLines = ref.parts.flatMap((p) => [p.name, ...p.rounds, ...p.notes]);
        e.fidelity = fidelity(t, refLines);
      }
    }
    report[`${c}/${m}`] = e;
  }
}

// Chicken cross-model agreement (no reference): round lines present in one but not the other.
const g = transcriptOf(load('chicken', 'gemma-4-26b-a4b-it'));
const q = transcriptOf(load('chicken', 'qwen3.8-27b'));
if (g && q) {
  const rl = (t) => t.lines.filter((l) => l.kind === 'round').map((l) => norm(l.text));
  const gs = rl(g), qs = rl(q);
  report['chicken/agreement'] = { gemmaRounds: gs.length, qwenRounds: qs.length, onlyGemma: gs.filter((x) => !qs.some((y) => sim(x, y) > 0.9)).length, onlyQwen: qs.filter((x) => !gs.some((y) => sim(x, y) > 0.9)).length };
}

for (const m of ['gemma-4-26b-a4b-it', 'qwen3.8-27b']) {
  const row = load('photo', m);
  if (row) report[`photo/${m}`] = { ok: row.ok, valid: row.valid, ms: row.latencyMs, tokens: row.usage ? `${row.usage.input}/${row.usage.output}` : null, neurons: row.neurons, text: row.json?.text, observations: row.json?.observations, cannotConfirm: row.json?.cannotConfirm, hypotheses: row.json?.hypotheses, actions: row.json?.actions };
}
writeFileSync(join(RES, `vision-score-${label}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
