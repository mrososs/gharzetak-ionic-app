#!/usr/bin/env node
// Prints a sanitised markdown summary of all local pilot result files (results/pilot-*.json): metrics and model reply
// TEXT only (synthetic material) — no images, no tokens, no account data. Usage: node summarize-pilot.mjs [--texts]
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = join(HERE, 'results');
const files = readdirSync(dir).filter((f) => /^pilot-.*\.json$/.test(f)).sort();
const rows = [];
for (const f of files) {
  const run = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  for (const r of run.results) rows.push({ ...r, run: f.slice(6, 25), promptVersion: run.promptVersion ?? 1, calc: run.calc ?? false });
}
const short = (m) => (m ? m.split('/').pop() : '');
console.log('| Run (UTC) | Prompt | Model | Case | Area | HTTP | Latency ms | In tok | Out tok | Est. Neurons | JSON | Automatic checks |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const checks = r.score ? Object.entries(r.score).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ') : r.message ? `error ${r.code}: ${String(r.message).slice(0, 80)}` : '';
  console.log(`| ${r.run} | v${r.promptVersion}${r.calc ? '+calc' : ''} | ${short(r.model)} | ${r.case} | ${r.area ?? 'API error handling'} | ${r.status} | ${r.latencyMs ?? ''} | ${r.usage?.input ?? ''} | ${r.usage?.output ?? ''} | ${r.estNeurons != null ? r.estNeurons.toFixed(1) : ''} | ${r.jsonValid ?? ''} | ${checks.replace(/\|/g, '/')} |`);
}
const ok = rows.filter((r) => r.status === 200);
const sum = (k) => ok.reduce((a, r) => a + (k(r) ?? 0), 0);
console.log(`\nRequests: ${rows.length} (${ok.length} succeeded). Estimated Neurons: ${sum((r) => r.estNeurons).toFixed(1)}.`);
if (process.argv.includes('--texts')) {
  for (const r of ok) {
    console.log(`\n#### ${short(r.model)} · ${r.case} · prompt v${r.promptVersion}${r.calc ? '+calc' : ''}`);
    if (r.reply) {
      console.log('> ' + r.reply.text.replace(/\n+/g, ' '));
      for (const k of ['observations', 'hypotheses', 'cannotConfirm']) if (r.reply[k]) console.log(`> ${k}: ${r.reply[k].join(' · ')}`);
      console.log(`> actions: ${JSON.stringify(r.reply.actions.map((a) => ({ id: a.id, payload: a.payload })))}`);
    }
    if (r.transcript) console.log('> ' + r.transcript.lines.map((l) => `[${l.kind}/${l.legibility}] ${l.text}`).join(' ¶ '));
  }
}
