#!/usr/bin/env node
// Khayoota AI — model benchmark runner.
//
// SAFE BY DEFAULT: without --execute this script only validates the case manifest, reports
// which fixtures are missing and prints a token / Neuron / cost estimate. It makes NO network
// calls in that mode.
//
// Live execution lives in live-pilot.mjs (bounded per UTC day, ledgered, production prompts). This file validates the
// manifest, lists missing fixtures and estimates the cost of the FULL 52-case run.
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

// ---- 4. Execution ------------------------------------------------------------------------
// The live path moved to live-pilot.mjs (2026-11-18): it uses the production prompts/contracts, the native Workers AI
// endpoint (same shape as the Worker binding), per-model request profiles, a per-UTC-day request/Neuron ledger and
// a Wrangler-login token held in memory. To run more cases live, add them to pilot.json (production request format).
throw new Error('Use live-pilot.mjs for live runs (see benchmark-plan.md §8 and benchmark-results.md).');
