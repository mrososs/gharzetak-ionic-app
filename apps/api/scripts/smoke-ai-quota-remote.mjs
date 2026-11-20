// Khayoota hosted-AI QUOTA smoke test against the DEPLOYED STAGING Worker (real Workers AI calls, a few dozen at most).
//
//   STAGING_URL=https://gharzetak-api-staging.gharzetak.workers.dev IMAGE=path/to/pattern.png node scripts/smoke-ai-quota-remote.mjs
//
// Proves on the real deployment, with THROW-AWAY accounts (…@gharzetak.test, deleted at the end; never a real person's account):
//   every signed-in account may use hosted AI · 10 messages / 5 images per Africa/Cairo day · message + N images accounting ·
//   rejection BEFORE the model when the images do not fit · 11th message refused with reset time · a second device shares the counter ·
//   an idempotent retry is not charged twice · the exempt e-mail cannot be claimed by a stranger · real image + pattern reading.
// It never signs in to the exempt account (that needs its owner) and never prints tokens or model text beyond short excerpts.
import { readFileSync } from 'node:fs';

const BASE = (process.env.STAGING_URL ?? '').replace(/\/+$/, '');
if (!/^https:\/\/gharzetak-api-staging\.[a-z0-9-]+\.workers\.dev$/.test(BASE)) throw new Error(`Refusing to run against "${BASE}": set STAGING_URL to the staging workers.dev URL`);
const IMAGE = process.env.IMAGE;
const ORIGIN = 'https://localhost';
const PASSWORD = 'correct-horse-battery';
let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log('  ✓', name);
  } else {
    fail++;
    console.log('  ✗', name, extra);
  }
};
const req = async (path, { token, method = 'GET', json, headers = {} } = {}) => {
  const r = await fetch(BASE + path, { method, headers: { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: json ? JSON.stringify(json) : undefined });
  const text = await r.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: r.status, body, token: r.headers.get('set-auth-token') };
};
const accounts = [];
async function signUp(label) {
  const email = `${label}-${Date.now()}@gharzetak.test`;
  const r = await req('/api/auth/sign-up/email', { method: 'POST', json: { email, password: PASSWORD, name: label } });
  const a = { email, token: r.token, id: r.body.user?.id };
  accounts.push(a);
  return a;
}
const signIn = async (a) => ({ ...a, token: (await req('/api/auth/sign-in/email', { method: 'POST', json: { email: a.email, password: PASSWORD } })).token });
const chat = (a, body, headers) => req('/v1/ai/chat', { token: a.token, method: 'POST', headers, json: { v: 1, lang: 'en', ...body } });
const quota = async (a) => (await req('/v1/ai/status', { token: a.token })).body.quota;
const png = IMAGE ? { mime: IMAGE.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg', data: readFileSync(IMAGE).toString('base64') } : null;
const excerpt = (s) => String(s ?? '').replace(/\s+/g, ' ').slice(0, 110);

console.log(`Khayoota AI quota smoke against ${BASE}`);
const health = await req('/health');
ok('health: D1 ok', health.body.status === 'ok', JSON.stringify(health.body));
for (const [m, p] of [['GET', '/v1/ai/status'], ['POST', '/v1/ai/chat'], ['POST', '/v1/ai/extract']]) ok(`anonymous ${m} ${p} → 401`, (await req(p, { method: m, json: m === 'GET' ? undefined : {} })).status === 401);

const a = await signUp('smoke-quota');
ok('sign-up works', !!a.token);
const st = await req('/v1/ai/status', { token: a.token });
ok('a brand-new, non-allowlisted account IS enabled for hosted AI (test-build policy)', st.body.enabled === true && st.body.access !== 'restricted', JSON.stringify(st.body).slice(0, 200));
ok('status: 10 messages + 5 images, Africa/Cairo, not unlimited', st.body.quota?.chat?.limit === 10 && st.body.quota?.image?.limit === 5 && st.body.quota?.unlimited === false && st.body.quota?.timezone === 'Africa/Cairo', JSON.stringify(st.body.quota));
ok('status exposes a reset time', typeof st.body.quota?.resetAt === 'string' && Date.parse(st.body.quota.resetAt) > Date.now());
const noConsent = await chat(a, { message: 'hi' });
ok('consent still required first', noConsent.status === 403 && noConsent.body.error?.code === 'ai_consent_required');
ok('consent accepted', (await req('/v1/ai/consent', { token: a.token, method: 'PUT', json: { version: st.body.consent.version } })).status === 200);

console.log('\nReal replies and accounting');
const r1 = await chat(a, { message: 'In one sentence: what is a magic ring in amigurumi?' });
ok('message 1: real reply (200)', r1.status === 200 && !!r1.body.reply?.text, `${r1.status} ${JSON.stringify(r1.body).slice(0, 160)}`);
console.log('    reply excerpt:', excerpt(r1.body.reply?.text));
ok('reply marked non-degraded, usage says 9 left', r1.body.reply?.degraded === false && r1.body.usage?.quota?.chat?.remaining === 9, JSON.stringify(r1.body.usage));

if (png) {
  const r2 = await chat(a, { message: 'What do you see in this image? Answer in one or two sentences.', images: [png], intent: 'diagnose-photo' });
  ok('image message: real vision reply (200)', r2.status === 200 && !!r2.body.reply?.text, `${r2.status} ${JSON.stringify(r2.body).slice(0, 160)}`);
  console.log('    reply excerpt:', excerpt(r2.body.reply?.text));
  ok('1 image message = 1 message + 1 image (8 messages, 4 images left)', (await quota(a)).chat.remaining === 8 && (await quota(a)).image.remaining === 4, JSON.stringify(await quota(a)));
  const ex = await req('/v1/ai/extract', { token: a.token, method: 'POST', json: { v: 1, lang: 'en', images: [png] } });
  ok('pattern reading from the page image (200)', ex.status === 200 && Array.isArray(ex.body.transcript?.lines), `${ex.status} ${JSON.stringify(ex.body).slice(0, 160)}`);
  const lines = (ex.body.transcript?.lines ?? []).map((l) => l.text);
  console.log('    transcript lines:', lines.length, '| first lines:', lines.slice(0, 4).map(excerpt).join(' || '));
  const joined = lines.join(' ');
  // The printed page is known: check the transcript FAITHFULLY contains its stitch counts instead of trusting "200 OK".
  for (const frag of ['6 sc in magic ring', '(1 sc, inc) x 6', '(2 sc, inc) x 6', '(1 sc, inc) x 3']) ok(`transcript contains the printed text "${frag}"`, joined.toLowerCase().includes(frag.toLowerCase()), 'MISSING');
  ok('extract = 1 message + 1 image (7 messages, 3 images left)', (await quota(a)).chat.remaining === 7 && (await quota(a)).image.remaining === 3, JSON.stringify(await quota(a)));
  // The burst limiter (20 units/minute, weighted) runs BEFORE the quota: let its window pass so this check isolates the quota.
  await new Promise((r) => setTimeout(r, 62_000));
  const before = await quota(a);
  const tooMany = await chat(a, { message: 'four photos', images: [png, png, png, png] });
  ok('4 images with 3 left: refused BEFORE the model (429 ai_quota_exceeded, kind image)', tooMany.status === 429 && tooMany.body.error?.code === 'ai_quota_exceeded' && tooMany.body.kind === 'image' && tooMany.body.remaining?.image === 3, JSON.stringify(tooMany.body).slice(0, 200));
  const after = await quota(a);
  ok('…and nothing was charged', after.chat.used === before.chat.used && after.image.used === before.image.used);
} else {
  console.log('  (no IMAGE given: image checks skipped)');
}

const bad = await chat(a, { message: 'x', images: [{ mime: 'image/jpeg', data: Buffer.from('GIF89a definitely not a jpeg').toString('base64') }] });
ok('a fake JPEG is rejected (415) before any charge', bad.status === 415);

console.log('\nSecond device shares the counter; exhausting the 10 messages');
const phone2 = await signIn(a);
const used = (await quota(phone2)).chat.used;
ok('second device sees the same usage', used === (png ? 3 : 1), `used=${used}`);
let sent = used;
for (; sent < 10; sent++) {
  const r = await chat(phone2, { message: `Reply with just the number ${sent}.` });
  if (r.status !== 200) {
    ok(`message ${sent + 1} accepted`, false, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
    break;
  }
}
ok('10 messages used', (await quota(a)).chat.used === 10 && (await quota(a)).chat.remaining === 0);
const eleventh = await chat(a, { message: 'eleventh' });
ok('11th message: 429 ai_quota_exceeded, kind chat, with the reset time', eleventh.status === 429 && eleventh.body.error?.code === 'ai_quota_exceeded' && eleventh.body.kind === 'chat' && typeof eleventh.body.resetAt === 'string', JSON.stringify(eleventh.body).slice(0, 200));
const resetAt = eleventh.body.resetAt;
console.log('    next reset (UTC):', resetAt, '→ Cairo midnight');
ok('reset is 22:00Z or 21:00Z (Cairo midnight, DST-aware)', /T(21|22):00:00\.000Z$/.test(resetAt ?? ''), resetAt);
ok('sign out + sign in again does not reset it', (await quota(await signIn(a))).chat.used === 10);

console.log('\nIdempotent retry and the exempt e-mail');
const b = await signUp('smoke-quota-b');
await req('/v1/ai/consent', { token: b.token, method: 'PUT', json: { version: 1 } });
const key = `smoke-key-${Date.now()}`;
const k1 = await chat(b, { message: 'Reply with the single word OK.', clientRequestId: key });
const k2 = await chat(b, { message: 'Reply with the single word OK.', clientRequestId: key });
ok('same request key twice: first 200, second 409 ai_duplicate_request', k1.status === 200 && k2.status === 409 && k2.body.error?.code === 'ai_duplicate_request', `${k1.status}/${k2.status}`);
ok('…and it was charged once', (await quota(b)).chat.used === 1);
const spoof = await chat(b, { message: 'hi', email: 'radwa.ghes@gmail.com' });
ok('an e-mail field in the body is refused (400), not honoured', spoof.status === 400);
const hdr = await chat(b, { message: 'Reply with the single word OK.' }, { 'X-User-Email': 'radwa.ghes@gmail.com', 'X-Unlimited': 'true' });
const qb = await quota(b);
ok('a stranger sending the exempt e-mail in a header is still a normal, limited account', hdr.status === 200 && qb.unlimited === false && qb.chat.limit === 10 && qb.chat.used === 2, JSON.stringify(qb));

console.log('\nCleanup (throw-away accounts)');
for (const x of accounts) {
  const t = (await signIn(x)).token;
  const d = await req('/api/auth/delete-user', { token: t, method: 'POST', json: { password: PASSWORD } });
  ok(`deleted ${x.email.split('-')[2] ?? x.email}`, d.status === 200, String(d.status));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
