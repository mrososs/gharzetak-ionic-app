// Controlled Gemma 4 vs Qwen 3.8 comparison on IDENTICAL image inputs, through the PRODUCTION prompts, JSON schemas and
// output sanitising (apps/api/src/services/ai). Real inference — never run by ordinary tests.
//
// Safety (same rules as live-pilot.mjs):
//  - dry-run by default; --execute needs KHAYOOTA_BENCH_APPROVED=yes, CLOUDFLARE_ACCOUNT_ID and --wrangler <wrangler.js>
//  - hard caps: --max-requests (default 8) and --max-neurons (default 3500, ESTIMATED) with a worst-case reservation before
//    every call (max output tokens × price), so one call can never push past the cap; no retries at all
//  - stops on 3036 (free allocation exhausted) and on any paid-only / retired answer; never upgrades anything
//  - images are read from a git-ignored local JSON (results/local-images.json): { "giraffe": "C:/…jpeg", "chicken": [4 paths], "photo": "C:/…" }
//  - raw transcripts are written to results/ (git-ignored). Only metrics are printed.
//
//   node docs/khayoota-ai/benchmark/vision-compare.mjs --cases giraffe,chicken,photo --models gemma,qwen            (dry run)
//   KHAYOOTA_BENCH_APPROVED=yes CLOUDFLARE_ACCOUNT_ID=… node …/vision-compare.mjs --execute --wrangler …/wrangler.js …
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_PROFILES, runModel, wranglerToken } from './lib/workers-ai.mjs';
import { loadProduction } from './lib/production.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RES = join(HERE, 'results');
mkdirSync(RES, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const execute = args.includes('--execute');
const MODELS = { gemma: '@cf/google/gemma-4-26b-a4b-it', qwen: '@cf/qwen/qwen3.8-27b' };
/** Neurons per million tokens (Workers AI pricing page; same table as apps/api config.ts). */
const PRICE = { [MODELS.gemma]: [9091, 27273], [MODELS.qwen]: [40909, 290909] };
const models = opt('--models', 'gemma,qwen').split(',').map((m) => MODELS[m] ?? m);
const cases = opt('--cases', 'giraffe,chicken,photo').split(',');
const maxReq = Number(opt('--max-requests', 8));
const maxNeurons = Number(opt('--max-neurons', 3500));
const label = opt('--label', 'run');
/** Experiment only: text appended to the extraction system prompt (production prompt is untouched). */
const extraSystem = opt('--extra-system', '');

const imgFile = join(RES, 'local-images.json');
if (!existsSync(imgFile)) throw new Error('results/local-images.json missing (local, git-ignored): { giraffe, chicken:[…], photo }');
const local = JSON.parse(readFileSync(imgFile, 'utf8'));
const dataUri = (p) => ({ mime: 'image/jpeg', data: readFileSync(p).toString('base64') });
const images = {
  giraffe: [dataUri(local.giraffe)],
  chicken: local.chicken.map(dataUri),
  photo: [dataUri(local.photo)],
};

const prod = await loadProduction();
const ctxBunny = {
  v: 1, viewTerms: 'us',
  project: { id: 'prj_bench', name: 'الارنوبة بالفستان', kind: 'collection' },
  part: { instanceId: 'inst_body', name: 'الجسم', index: 1, of: 1 },
  pattern: { source: 'snapshot', rev: 3, outdated: false, terms: 'us' },
  round: { n: 31, text: 'R31: dec [6]', declaredTotal: 6, calculatedTotal: 1, consumed: 2, mismatch: true, joins: [], position: { done: 1, of: 1 } },
};

function plan(c) {
  if (c === 'photo') {
    const req = prod.chatRequest.parse({ v: 1, lang: 'ar', message: 'خيوطة، أنا واقفة عند الدور ده ومش عارفة أكمل. ممكن تشوفي الصورة وتقولي أعمل إيه؟', images: images.photo, intent: 'diagnose-photo', context: ctxBunny });
    return { kind: 'chat', messages: prod.buildChatMessages(req), schema: prod.REPLY_JSON_SCHEMA, name: 'khayoota_reply', maxOut: 700, req };
  }
  const req = prod.extractRequest.parse({ v: 1, lang: 'ar', images: images[c] });
  const messages = prod.buildExtractMessages(req);
  if (extraSystem) messages[0] = { ...messages[0], content: `${messages[0].content}
${extraSystem}` };
  return { kind: 'extract', messages, schema: prod.TRANSCRIPT_JSON_SCHEMA, name: 'pattern_transcript', maxOut: 4000, req };
}

const jobs = cases.flatMap((c) => models.map((m) => ({ c, m })));
if (jobs.length > maxReq) throw new Error(`${jobs.length} jobs > --max-requests ${maxReq}`);
let worst = 0;
for (const j of jobs) {
  const p = plan(j.c);
  const estIn = prod.estimateInputTokens(p.messages);
  const [pi, po] = PRICE[j.m];
  j.worst = Math.ceil((estIn * pi + p.maxOut * po) / 1e6);
  worst += j.worst;
}
console.log(`${jobs.length} job(s): ${jobs.map((j) => `${j.c}/${j.m.split('/').pop()}(≤${j.worst}N)`).join(' ')}`);
console.log(`worst-case total ${worst} Neurons (cap ${maxNeurons}); actual use is normally far lower`);
if (!execute) {
  console.log('DRY RUN — nothing sent.');
  process.exit(0);
}
if (process.env.KHAYOOTA_BENCH_APPROVED !== 'yes') throw new Error('Refusing: KHAYOOTA_BENCH_APPROVED=yes required');
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!account) throw new Error('Refusing: CLOUDFLARE_ACCOUNT_ID not set');
const token = wranglerToken(opt('--wrangler', null));

let spent = 0;
let sent = 0;
const out = [];
for (const j of jobs) {
  if (sent >= maxReq || spent + j.worst > maxNeurons) {
    console.log(`STOP before ${j.c}/${j.m}: cap (spent ${Math.round(spent)} + worst ${j.worst} > ${maxNeurons}, or requests)`);
    break;
  }
  const p = plan(j.c);
  const profile = MODEL_PROFILES[j.m];
  const response_format = { type: 'json_schema', json_schema: { name: p.name, schema: p.schema, strict: false } };
  const inputs = { messages: p.messages, max_tokens: p.maxOut, temperature: 0, response_format, ...profile.extras };
  sent++;
  const r = await runModel({ account, token, model: j.m, inputs, timeoutMs: 150_000 });
  const [pi, po] = PRICE[j.m];
  const used = r.ok && r.usage.input != null ? (r.usage.input * pi + r.usage.output * po) / 1e6 : j.worst; // unknown usage → keep the reservation
  spent += used;
  const row = { case: j.c, model: j.m, ok: r.ok, status: r.status, code: r.code, latencyMs: r.latencyMs, usage: r.usage ?? null, neurons: Math.round(used), finish: r.finish ?? null };
  if (r.ok) {
    let valid = false;
    try {
      const raw = prod.extractJson(r.text);
      valid = p.kind === 'extract' ? !!prod.modelTranscript.parse(raw) : !!prod.modelReply.parse(raw);
      row.json = raw;
    } catch (e) {
      row.parseError = String(e.message).slice(0, 120);
    }
    row.valid = valid;
    row.text = r.text;
  } else {
    row.message = r.message;
  }
  out.push(row);
  writeFileSync(join(RES, `vision-${label}-${j.c}-${j.m.split('/').pop()}.json`), JSON.stringify(row, null, 1));
  console.log(JSON.stringify({ case: row.case, model: row.model.split('/').pop(), ok: row.ok, status: row.status, ms: row.latencyMs, tokens: row.usage ? `${row.usage.input}/${row.usage.output}` : null, reasoning: r.usage?.reasoning ?? null, neurons: row.neurons, valid: row.valid, finish: row.finish, err: row.code ?? row.parseError ?? null }));
  if (r.code === 3036) { console.log('STOP: free allocation exhausted (3036)'); break; }
  if (r.code === 5035 || r.code === 5028) { console.log(`STOP: model not usable here (${r.code})`); break; }
}
console.log(`done: ${sent} request(s), ~${Math.round(spent)} Neurons (estimated from reported tokens)`);
