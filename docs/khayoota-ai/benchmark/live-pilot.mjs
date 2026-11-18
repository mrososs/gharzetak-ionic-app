#!/usr/bin/env node
// Khayoota AI — bounded LIVE pilot against Workers AI (PRELIMINARY; not the full 52-case benchmark).
//
// SAFETY
//  - Dry run by default: prints the planned requests and their worst-case Neuron cost, makes no network call.
//  - --execute needs KHAYOOTA_BENCH_APPROVED=yes, an account id, and a token (CLOUDFLARE_API_TOKEN, or --wrangler <path to
//    an authenticated wrangler.js>, read in memory only and never printed or stored).
//  - Hard daily caps from pilot.json (requests and ESTIMATED Neurons), persisted per UTC day in results/ledger-<day>.json,
//    checked BEFORE every request against a worst-case estimate (input estimate + max_tokens of output).
//  - No unattended retries: one retry on capacity (3040), none otherwise. 3036 (free allocation used up) stops everything;
//    5035 (model needs Workers Paid) stops that model.
//  - Output (incl. raw model text) is written to results/ (git-ignored). Only sanitised summaries are committed by hand.
//
// Usage:
//   node docs/khayoota-ai/benchmark/live-pilot.mjs --models @cf/google/gemma-4-26b-a4b-it
//   KHAYOOTA_BENCH_APPROVED=yes CLOUDFLARE_ACCOUNT_ID=... node docs/khayoota-ai/benchmark/live-pilot.mjs --execute \
//     --models @cf/google/gemma-4-26b-a4b-it --wrangler <path>/wrangler.js [--cases P-AR,P-EN] [--probe-error]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCalc, loadSmartParser, resolveText, summarize } from './lib/parser.mjs';
import { loadProduction } from './lib/production.mjs';
import { MODEL_PROFILES, NEURONS_PER_USD, estimateNeurons, runModel, wranglerToken } from './lib/workers-ai.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, 'results');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] ?? d : d);
const flag = (n) => args.includes(n);

const manifest = JSON.parse(readFileSync(join(HERE, 'cases.json'), 'utf8'));
const pilot = JSON.parse(readFileSync(join(HERE, 'pilot.json'), 'utf8'));
const prod = await loadProduction();
const { convertPatternText, normalizeLine } = await loadSmartParser();
const { calcFacts } = await loadCalc();
const noCalc = flag('--no-calc');

const models = (opt('--models', '') || '').split(',').filter(Boolean);
if (!models.length) throw new Error('--models is required');
const onlyCases = opt('--cases', null)?.split(',');
const cases = pilot.cases.filter((c) => !onlyCases || onlyCases.includes(c.id));
const execute = flag('--execute');

const modelCfg = (id) => {
  const m = manifest.models.find((x) => x.id === id);
  if (!m) throw new Error(`unknown model ${id} (add it to cases.json with its catalogue price)`);
  if (m.requiresWorkersPaid) throw new Error(`${id} requires Workers Paid — not allowed in the free pilot`);
  if (!MODEL_PROFILES[id]) throw new Error(`no request profile for ${id}`);
  return m;
};

/* ---------- request building (production contracts + prompts) ---------- */
const b64 = (file) => readFileSync(join(HERE, 'fixtures', file)).toString('base64');
const mimeOf = (f) => (f.endsWith('.png') ? 'image/png' : f.endsWith('.webp') ? 'image/webp' : 'image/jpeg');

function buildInputs(c, modelId) {
  const images = (c.images ?? []).map((f) => ({ mime: mimeOf(f), data: b64(f) }));
  let messages;
  let schema;
  if (c.kind === 'extract') {
    const req = prod.extractRequest.parse({ v: 1, lang: c.lang, ...(images.length ? { images } : { text: resolveText(manifest, c.sourceText) }) });
    messages = prod.buildExtractMessages(req);
    schema = prod.TRANSCRIPT_JSON_SCHEMA;
  } else {
    const req = prod.chatRequest.parse({ v: 1, lang: c.lang, message: c.message, ...(images.length ? { images } : {}), ...(c.context ? { context: pilot.contexts[c.context] } : {}), ...(c.intent ? { intent: c.intent } : {}), ...(!noCalc && calcFacts(c.message).length ? { calc: calcFacts(c.message) } : {}) });
    messages = prod.buildChatMessages(req);
    schema = prod.REPLY_JSON_SCHEMA;
  }
  const profile = MODEL_PROFILES[modelId];
  const response_format =
    profile.family === 'openai' ? { type: 'json_schema', json_schema: { name: c.kind === 'extract' ? 'pattern_transcript' : 'khayoota_reply', schema, strict: false } } : { type: 'json_schema', json_schema: schema };
  const max_tokens = pilot.maxTokens[c.kind === 'extract' ? 'extract' : 'chat'];
  return { inputs: { messages, max_tokens, temperature: 0.2, response_format, ...profile.extras }, estIn: prod.estimateInputTokens(messages), maxOut: max_tokens };
}

/* ---------- ledger (per UTC day) ---------- */
mkdirSync(RESULTS, { recursive: true });
const day = new Date().toISOString().slice(0, 10);
const ledgerFile = join(RESULTS, `ledger-${day}.json`);
const ledger = existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, 'utf8')) : { day, requests: 0, estNeurons: 0, entries: [] };
const saveLedger = () => writeFileSync(ledgerFile, JSON.stringify(ledger, null, 1));
const caps = pilot.budget;

/* ---------- scoring (automatic only; human-rated metrics are NOT produced here) ---------- */
function lev(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
function scoreExtract(c, parsed) {
  const src = resolveText(manifest, c.sourceText);
  const lines = parsed.lines.filter((l) => l.kind !== 'other').map((l) => l.text);
  const got = lines.join('\n');
  const norm = (t) => t.split('\n').map((l) => normalizeLine(l)).filter(Boolean).join('\n');
  const truth = summarize(convertPatternText(src));
  const conv = summarize(convertPatternText(got));
  const tr = truth.parts.flatMap((p) => p.rounds);
  const cr = conv.parts.flatMap((p) => p.rounds);
  const truthByN = new Map(tr.map((r) => [r.n, r]));
  const sameNormalized = cr.filter((r) => truthByN.get(r.n)?.normalized === r.normalized).length;
  const invented = cr.filter((r) => !truthByN.has(r.n)).length;
  return {
    sourceClass: parsed.sourceClass,
    cer: +(lev(norm(got), norm(src)) / Math.max(1, norm(src).length)).toFixed(3),
    roundsTruth: tr.length,
    roundsGot: cr.length,
    sameNormalized,
    inventedRounds: invented,
    statusesGot: conv.counts,
    uncertainLines: parsed.lines.filter((l) => l.legibility !== 'clear').length,
  };
}
function scoreChat(c, reply) {
  const t = (reply.text + ' ' + [...(reply.observations ?? []), ...(reply.hypotheses ?? []), ...(reply.cannotConfirm ?? [])].join(' ')).toLowerCase();
  const k = c.checks ?? {};
  const res = {};
  if (k.mentions) res.mentions = k.mentions.every((m) => t.includes(m.toLowerCase()));
  if (k.mentionsAny) res.mentionsAny = k.mentionsAny.some((m) => t.includes(m.toLowerCase()));
  if (k.mustNotMention) res.mustNotMention = !k.mustNotMention.some((m) => t.includes(m.toLowerCase()));
  if (k.action) res.action = reply.actions.some((a) => a.id === k.action && Object.entries(k.payload ?? {}).every(([kk, vv]) => a.payload[kk] === vv));
  if (k.needsCannotConfirm) res.cannotConfirm = (reply.cannotConfirm?.length ?? 0) > 0;
  if (k.noExactCountClaim) res.noExactCountClaim = !/\b(1[0-9]|[2-9][0-9])\s*(sc|stitches|غرز|غرزة)/i.test(reply.text);
  return res;
}

/* ---------- plan / execute ---------- */
const plan = [];
for (const m of models) {
  const cfg = modelCfg(m);
  for (const c of cases) {
    const { inputs, estIn, maxOut } = buildInputs(c, m);
    const worst = ((estIn * cfg.usdPerMInput + maxOut * cfg.usdPerMOutput) / 1e6) * NEURONS_PER_USD;
    plan.push({ model: m, cfg, c, inputs, worst, bytes: JSON.stringify(inputs).length });
  }
}
console.log(`PRELIMINARY pilot — ${plan.length} request(s). Ledger ${day}: ${ledger.requests} requests, ~${Math.round(ledger.estNeurons)} est. Neurons so far (caps ${caps.maxRequestsPerDay} / ${caps.maxEstimatedNeuronsPerDay}).`);
for (const p of plan) console.log(`  ${p.model.padEnd(42)} ${p.c.id.padEnd(8)} ${String(p.bytes).padStart(7)} B  worst ≤ ${Math.round(p.worst)} Neurons`);
console.log(`  worst-case total ≤ ${Math.round(plan.reduce((a, p) => a + p.worst, 0))} Neurons`);
if (!execute) {
  console.log('\nDry run. No network calls were made.');
  process.exit(0);
}

if (process.env.KHAYOOTA_BENCH_APPROVED !== 'yes') throw new Error('Refusing: set KHAYOOTA_BENCH_APPROVED=yes');
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!account) throw new Error('Refusing: CLOUDFLARE_ACCOUNT_ID not set');
const token = wranglerToken(opt('--wrangler', null));

const record = (entry) => {
  ledger.requests++;
  ledger.estNeurons += entry.estNeurons ?? entry.worst;
  ledger.entries.push({ at: new Date().toISOString(), model: entry.model, case: entry.case, status: entry.status, code: entry.code, usage: entry.usage, estNeurons: entry.estNeurons ?? null });
  saveLedger();
};

const results = [];
if (flag('--probe-error')) {
  // API error handling: an invalid parameter must be rejected before any inference.
  const m = models[0];
  if (ledger.requests + 1 > caps.maxRequestsPerDay) throw new Error('request cap reached');
  const r = await runModel({ account, token, model: m, inputs: { messages: [{ role: 'user', content: 'hi' }], max_tokens: -5 } });
  results.push({ model: m, case: 'ERR-PROBE', status: r.status, code: r.code, message: r.message, latencyMs: r.latencyMs, usage: r.usage ?? null });
  record({ model: m, case: 'ERR-PROBE', status: r.status, code: r.code, usage: r.usage ?? null, estNeurons: r.ok ? estimateNeurons(modelCfg(m), r.usage) : 0 });
  console.log(`ERR-PROBE ${m}: HTTP ${r.status} code=${r.code} ${r.message ?? ''}`);
}

const skipModels = new Set();
for (const p of plan) {
  if (skipModels.has(p.model)) continue;
  if (ledger.requests + 1 > caps.maxRequestsPerDay) { console.log('STOP: daily request cap reached'); break; }
  if (ledger.estNeurons + p.worst > caps.maxEstimatedNeuronsPerDay) { console.log(`STOP: next request could exceed the daily Neuron cap (${Math.round(ledger.estNeurons)} + ≤${Math.round(p.worst)})`); break; }
  let r = await runModel({ account, token, model: p.model, inputs: p.inputs });
  let retried = false;
  let fallbackFormat = false;
  if (!r.ok && (r.code === 3040 || r.status === 429) && r.code !== 3036) {
    await new Promise((s) => setTimeout(s, 3000));
    r = await runModel({ account, token, model: p.model, inputs: p.inputs });
    retried = true;
  }
  if (!r.ok && r.status === 400 && r.code !== 3036) {
    // Compatibility: retry ONCE without response_format if the model rejects JSON mode (a rejected request is not inferred).
    const { response_format, ...rest } = p.inputs;
    const r2 = await runModel({ account, token, model: p.model, inputs: rest });
    if (r2.ok || r2.status !== 400) { r = r2; fallbackFormat = true; }
  }
  const est = r.ok ? estimateNeurons(p.cfg, r.usage) : 0;
  const entry = { model: p.model, case: p.c.id, from: p.c.from, area: p.c.area, kind: p.c.kind, status: r.status, code: r.code, message: r.message, latencyMs: r.latencyMs, inputBytes: p.bytes, usage: r.usage ?? null, estNeurons: est, retried, fallbackFormat, finish: r.finish ?? null };
  record({ ...entry, worst: p.worst });
  if (!r.ok) {
    console.log(`${p.model} ${p.c.id}: FAILED HTTP ${r.status} code=${r.code} ${r.message ?? ''}`);
    results.push(entry);
    if (r.code === 3036) { console.log('STOP: free allocation exhausted (3036)'); break; }
    if (r.code === 5035 || r.status === 403) { console.log(`skip ${p.model}: requires Workers Paid / forbidden`); skipModels.add(p.model); }
    continue;
  }
  entry.outputChars = r.text.length;
  entry.rawText = r.text;
  entry.reasoningChars = r.reasoning ? r.reasoning.length : 0;
  try {
    const json = prod.extractJson(r.text);
    if (p.c.kind === 'extract') {
      const t = prod.modelTranscript.parse(json);
      entry.jsonValid = true;
      entry.transcript = prod.toTranscript(t);
      entry.score = scoreExtract(p.c, entry.transcript);
    } else {
      const m = prod.modelReply.parse(json);
      entry.jsonValid = true;
      entry.unknownActions = (m.actions ?? []).filter((a) => !prod.ACTION_IDS.includes(a.id)).map((a) => a.id);
      entry.reply = prod.toChatReply(m, p.c.context ? pilot.contexts[p.c.context] : undefined, p.c.lang);
      entry.score = scoreChat(p.c, entry.reply);
      if (p.c.checks?.noUnknownActions) entry.score.noUnknownActions = entry.unknownActions.length === 0;
    }
  } catch (e) {
    entry.jsonValid = false;
    entry.jsonError = String(e.message).slice(0, 200);
  }
  results.push(entry);
  console.log(`${p.model} ${p.c.id}: HTTP ${r.status} ${r.latencyMs} ms in=${r.usage.input} out=${r.usage.output} ~${est?.toFixed(1)} Neurons json=${entry.jsonValid} ${JSON.stringify(entry.score ?? {})}`);
}

const out = join(RESULTS, `pilot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ day, models, promptVersion: prod.PROMPT_VERSION, calc: !noCalc, results }, null, 1));
console.log(`\nLedger ${day}: ${ledger.requests} requests, ~${Math.round(ledger.estNeurons)} est. Neurons. Results: ${out}`);
