#!/usr/bin/env node
// Khayoota AI — model benchmark runner.
//
// SAFE BY DEFAULT: without --execute this script only validates the case manifest, reports
// which fixtures are missing and prints a token / Neuron / cost estimate. It makes NO network
// calls in that mode.
//
// With --execute it calls the Workers AI OpenAI-compatible REST endpoint. That consumes Neurons
// (free daily allocation first, then billable on Workers Paid). It therefore refuses to run
// unless ALL of these are true:
//   - KHAYOOTA_BENCH_APPROVED=yes          (the owner approved a benchmark run)
//   - CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are set (token scope: Workers AI - Read/Run)
//   - --max-neurons <n> is given            (hard budget; the run stops before exceeding it)
//
// STATUS: the dry-run path was exercised on 2026-11-18. The --execute path has NEVER been run
// (planning task: no inference allowed) and must be reviewed before its first use.
//
// Usage:
//   node docs/khayoota-ai/benchmark/run-benchmark.mjs
//   node docs/khayoota-ai/benchmark/run-benchmark.mjs --only extract --models @cf/google/gemma-4-26b-a4b-it
//   KHAYOOTA_BENCH_APPROVED=yes node docs/khayoota-ai/benchmark/run-benchmark.mjs --execute --max-neurons 4000 --runs 1

import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const manifest = JSON.parse(readFileSync(join(HERE, 'cases.json'), 'utf8'));
const NEURON_USD = 0.011 / 1000; // Workers AI: $0.011 per 1,000 Neurons (pricing page, 2026-11-12)
const IMAGE_TOKENS_ASSUMED = manifest.assumptions.imageTokens; // per image, ASSUMPTION until measured

const only = opt('--only', null); // chat | vision | extract | action | security
const modelFilter = opt('--models', null)?.split(',');
const runs = Number(opt('--runs', '1'));
const maxNeurons = Number(opt('--max-neurons', '0'));
const execute = flag('--execute');

const models = manifest.models.filter((m) => !modelFilter || modelFilter.includes(m.id));
const cases = manifest.cases.filter((c) => !only || c.capability === only);

// ---- 1. Manifest validation -------------------------------------------------------------
const problems = [];
const seen = new Set();
for (const c of manifest.cases) {
  if (seen.has(c.id)) problems.push(`duplicate id ${c.id}`);
  seen.add(c.id);
  for (const k of ['id', 'category', 'capability', 'lang', 'prompt', 'expect']) {
    if (c[k] === undefined) problems.push(`${c.id}: missing "${k}"`);
  }
  if (!['chat', 'vision', 'extract', 'action', 'security'].includes(c.capability)) {
    problems.push(`${c.id}: unknown capability ${c.capability}`);
  }
}
if (problems.length) {
  console.error('Manifest problems:\n - ' + problems.join('\n - '));
  process.exit(1);
}

// ---- 2. Fixture inventory ---------------------------------------------------------------
const fixturePath = (f) => resolve(HERE, 'fixtures', f);
const missing = [];
for (const c of cases) for (const f of c.images ?? []) if (!existsSync(fixturePath(f))) missing.push(`${c.id}: ${f}`);

// ---- 3. Estimate ------------------------------------------------------------------------
const roughTokens = (s) => Math.ceil((s ?? '').length / 3); // conservative for Arabic + English
const estimate = (c, m) => {
  const input =
    manifest.assumptions.systemPromptTokens +
    roughTokens(c.prompt) +
    roughTokens(c.context ? JSON.stringify(c.context) : '') +
    (c.images?.length ?? 0) * IMAGE_TOKENS_ASSUMED;
  const output = manifest.assumptions.outputTokens[c.capability];
  const usd = (input * m.usdPerMInput + output * m.usdPerMOutput) / 1e6;
  return { input, output, usd, neurons: usd / NEURON_USD };
};

console.log(`Khayoota benchmark — ${cases.length} case(s), ${models.length} model(s), ${runs} run(s) each`);
console.log(`Fixtures missing: ${missing.length}${missing.length ? '\n  ' + missing.join('\n  ') : ''}`);
let grandNeurons = 0;
for (const m of models) {
  let usd = 0;
  let neurons = 0;
  for (const c of cases) {
    const e = estimate(c, m);
    usd += e.usd * runs;
    neurons += e.neurons * runs;
  }
  grandNeurons += neurons;
  console.log(`  ${m.id.padEnd(46)} ~${Math.round(neurons).toString().padStart(6)} Neurons  ~$${usd.toFixed(3)}  (estimate, not measured)`);
}
console.log(`Total estimate: ~${Math.round(grandNeurons)} Neurons (~$${(grandNeurons * NEURON_USD).toFixed(2)}). Free allocation: 10,000 Neurons/day.`);

if (!execute) {
  console.log('\nDry run only. No network calls were made. See benchmark-plan.md §8 for the approval steps.');
  process.exit(0);
}

// ---- 4. Execution (never run during planning) -------------------------------------------
const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token, KHAYOOTA_BENCH_APPROVED: approved } = process.env;
if (approved !== 'yes') throw new Error('Refusing to run: set KHAYOOTA_BENCH_APPROVED=yes after the owner approves the run.');
if (!account || !token) throw new Error('Refusing to run: CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN not set.');
if (!maxNeurons) throw new Error('Refusing to run: pass --max-neurons <n> as a hard budget.');
if (missing.length) throw new Error('Refusing to run: fixtures are missing (see list above).');

const outDir = join(HERE, 'results', new Date().toISOString().replace(/[:.]/g, '-'));
const system = readFileSync(join(HERE, 'system-prompt.txt'), 'utf8');
const dataUri = (f) => {
  const p = fixturePath(f);
  if (statSync(p).size > 1_500_000) throw new Error(`${f} is larger than 1.5 MB; resize it first (benchmark-plan.md §4).`);
  const mime = p.endsWith('.png') ? 'image/png' : p.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${readFileSync(p).toString('base64')}`;
};

let spentNeurons = 0;
for (const m of models) {
  for (const c of cases) {
    for (let r = 1; r <= runs; r++) {
      const next = estimate(c, m).neurons;
      if (spentNeurons + next > maxNeurons) {
        console.log(`Budget reached (${Math.round(spentNeurons)} / ${maxNeurons} Neurons). Stopping.`);
        process.exit(0);
      }
      const content = [{ type: 'text', text: (c.context ? `CONTEXT (trusted, from the app):\n${JSON.stringify(c.context)}\n\n` : '') + c.prompt }];
      for (const f of c.images ?? []) content.push({ type: 'image_url', image_url: { url: dataUri(f) } });
      const body = {
        model: m.id,
        messages: [{ role: 'system', content: system }, { role: 'user', content }],
        temperature: manifest.assumptions.temperature,
        max_tokens: manifest.assumptions.outputTokens[c.capability] * 2,
        ...(m.requestExtras ?? {}),
      };
      const started = Date.now();
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({ parseError: true }));
      const usage = json.usage ?? {};
      const usd = ((usage.prompt_tokens ?? 0) * m.usdPerMInput + (usage.completion_tokens ?? 0) * m.usdPerMOutput) / 1e6;
      spentNeurons += usd ? usd / NEURON_USD : next;
      const dir = join(outDir, m.id.replace(/[@/]/g, '_'));
      mkdirSync(dir, { recursive: true });
      // The stored record holds model output and usage only; fixture images are never copied.
      writeFileSync(join(dir, `${c.id}.run${r}.json`), JSON.stringify({ case: c.id, model: m.id, status: res.status, latencyMs: Date.now() - started, usage, response: json }, null, 2));
      console.log(`${m.id} ${c.id} run ${r}: HTTP ${res.status}, ${Date.now() - started} ms`);
    }
  }
}
console.log(`Done. Results in ${outDir}. Score them with the rubric in benchmark-plan.md §6.`);
