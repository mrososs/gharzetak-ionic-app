// One-off live check (staging only): status + chat while AI_ENABLED is "false", or burst limiter while it is "true".
//   STAGING_URL=... MODE=killed|burst IMAGE=pattern.png node scripts/kill-switch-check.mjs
const BASE = (process.env.STAGING_URL ?? '').replace(/\/+$/, '');
if (!/^https:\/\/gharzetak-api-staging\.[a-z0-9-]+\.workers\.dev$/.test(BASE)) throw new Error('staging only');
import { readFileSync } from 'node:fs';
const H = { Origin: 'https://localhost', 'Content-Type': 'application/json' };
const call = async (p, o = {}) => {
  const r = await fetch(BASE + p, { ...o, headers: { ...H, ...(o.token ? { Authorization: 'Bearer ' + o.token } : {}) }, body: o.json ? JSON.stringify(o.json) : undefined, method: o.method });
  return { s: r.status, b: await r.json().catch(() => ({})), t: r.headers.get('set-auth-token') };
};
const email = `killcheck-${Date.now()}@gharzetak.test`;
const up = await call('/api/auth/sign-up/email', { method: 'POST', json: { email, password: 'correct-horse-battery', name: 'kc' } });
const tok = up.t;
const out = [];
if (process.env.MODE === 'killed') {
  out.push(['status while killed', (await call('/v1/ai/status', { token: tok })).b]);
  const c = await call('/v1/ai/chat', { token: tok, method: 'POST', json: { v: 1, lang: 'en', message: 'hi' } });
  out.push(['chat while killed', c.s, c.b.error?.code]);
  const k = await call('/v1/ai/consent', { token: tok, method: 'PUT', json: { version: 1 } });
  out.push(['consent while killed', k.s, k.b.error?.code]);
} else {
  await call('/v1/ai/consent', { token: tok, method: 'PUT', json: { version: 1 } });
  const img = { mime: 'image/png', data: readFileSync(process.env.IMAGE).toString('base64') };
  const a = await call('/v1/ai/chat', { token: tok, method: 'POST', json: { v: 1, lang: 'en', message: 'One short sentence: what is this?', images: [img, img, img, img] } });
  const b = await call('/v1/ai/chat', { token: tok, method: 'POST', json: { v: 1, lang: 'en', message: 'Again?', images: [img, img] } });
  out.push(['first 4-image message (burst weight 13)', a.s], ['second 2-image message right after (7 more > 20/min)', b.s, b.b.error?.code, b.b.retryAfterSec]);
  const st = await call('/v1/ai/status', { token: tok });
  out.push(['quota after: refused request charged nothing', JSON.stringify(st.b.quota?.chat), JSON.stringify(st.b.quota?.image)]);
}
for (const o of out) console.log(JSON.stringify(o));
const d = await call('/api/auth/delete-user', { method: 'POST', token: (await call('/api/auth/sign-in/email', { method: 'POST', json: { email, password: 'correct-horse-battery' } })).t, json: { password: 'correct-horse-battery' } });
console.log('cleanup delete', d.s);
