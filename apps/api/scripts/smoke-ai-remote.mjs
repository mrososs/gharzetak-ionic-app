// Khayoota AI smoke test against the DEPLOYED STAGING Worker. Refuses any host that is not gharzetak-api-staging.
//
//   Stage A (AI master switch OFF — no model can be reached):
//     STAGING_URL=https://gharzetak-api-staging.gharzetak.workers.dev node scripts/smoke-ai-remote.mjs --stage A
//   Stage B (AI_ENABLED=true for the allowlisted tester only) — proves a NON-allowlisted account is refused everywhere:
//     STAGING_URL=... node scripts/smoke-ai-remote.mjs --stage B
//   Real Gemma 4 replies are tested ONLY through the app with the allowlisted tester account; this script never infers.
//
// Creates throw-away accounts (smoke-ai-*@gharzetak.test) in the STAGING database only. Never prints tokens.
// Every guard check below is rejected by the Worker BEFORE any model call (see apps/api/src/routes/ai.ts).
const args = process.argv.slice(2);
const arg = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const stage = (arg('--stage') ?? '').toUpperCase();
const BASE = (process.env.STAGING_URL ?? '').replace(/\/+$/, '');
if (!/^https:\/\/gharzetak-api-staging\.[a-z0-9-]+\.workers\.dev$/.test(BASE)) throw new Error(`Refusing to run against "${BASE}": set STAGING_URL to the staging workers.dev URL`);
if (stage !== 'A' && stage !== 'B') throw new Error('Pass --stage A or --stage B');

const ORIGIN = 'https://localhost';
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
const req = (path, { token, method = 'GET', json, raw } = {}) =>
  fetch(BASE + path, {
    method,
    headers: { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json || raw ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : raw,
  });
const code = async (r) => {
  try {
    return (await r.json()).error?.code ?? null;
  } catch {
    return null;
  }
};
// Throw-away smoke accounts only (…@gharzetak.test, fixed test password). Never a real person's account.
async function signUp(label) {
  const email = `${label}-${Date.now()}@gharzetak.test`;
  const r = await req('/api/auth/sign-up/email', { method: 'POST', json: { email, password: 'correct-horse-battery', name: label } });
  const body = await r.json().catch(() => ({}));
  return { token: r.headers.get('set-auth-token'), id: body.user?.id, email };
}
const JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

console.log(`Khayoota AI smoke (stage ${stage}) against ${BASE}`);
const health = await (await fetch(BASE + '/health')).json();
ok('health: D1 ok', health.status === 'ok', JSON.stringify(health));
for (const [m, p] of [['GET', '/v1/ai/status'], ['POST', '/v1/ai/chat'], ['PUT', '/v1/ai/consent'], ['POST', '/v1/ai/extract']]) {
  ok(`anonymous ${m} ${p} → 401`, (await req(p, { method: m, json: m === 'GET' ? undefined : {} })).status === 401);
}
const u = await signUp('smoke-ai');
ok('sign-up works (auth unchanged)', !!u.token);
const status = await (await req('/v1/ai/status', { token: u.token })).json();

if (stage === 'A') {
  ok('status: AI disabled', status.enabled === false, JSON.stringify(status));
  const chat = await req('/v1/ai/chat', { token: u.token, method: 'POST', json: { v: 1, lang: 'en', message: 'hi' } });
  ok('chat → 503 ai_disabled', chat.status === 503 && (await code(chat)) === 'ai_disabled');
  const cons = await req('/v1/ai/consent', { token: u.token, method: 'PUT', json: { version: 1 } });
  ok('consent → 503 ai_disabled', cons.status === 503);
  const sync = await req('/v1/sync/pull', { token: u.token });
  ok('sync pull still 200', sync.status === 200);
} else {
  // Stage B: AI_ENABLED=true for the allowlisted tester ONLY. A fresh smoke account is NOT on the list: every hosted
  // AI route must refuse it before consent, quotas or any model call. (The tester's own checks run in the app.)
  ok('status: restricted for a non-allowlisted account', status.enabled === false && status.access === 'restricted', JSON.stringify(status));
  for (const [m, p, json] of [
    ['POST', '/v1/ai/chat', { v: 1, lang: 'ar', message: 'إيه الفرق بين sc و hdc؟' }],
    ['POST', '/v1/ai/chat', { v: 1, lang: 'en', message: 'look', images: [{ mime: 'image/jpeg', data: JPEG }] }],
    ['POST', '/v1/ai/extract', { v: 1, lang: 'en', text: 'R1: 6 sc in MR (6)' }],
    ['PUT', '/v1/ai/consent', { version: 1 }],
  ]) {
    const r = await req(p, { token: u.token, method: m, json });
    ok(`${m} ${p}${json.images ? ' (photo)' : ''} → 403 ai_access_restricted`, r.status === 403 && (await code(r)) === 'ai_access_restricted');
  }
  const spoof = await fetch(BASE + '/v1/ai/chat', {
    method: 'POST',
    headers: { Origin: ORIGIN, Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json', 'X-User-Email': 'tester@example.test' },
    body: JSON.stringify({ v: 1, lang: 'en', message: 'hi', email: 'tester@example.test' }),
  });
  ok('spoofed e-mail header/body field → still 403', spoof.status === 403);
  ok('sign-out', (await req('/api/auth/sign-out', { token: u.token, method: 'POST', json: {} })).status === 200);
  ok('chat after sign-out → 401', (await req('/v1/ai/chat', { token: u.token, method: 'POST', json: { v: 1, lang: 'en', message: 'hi' } })).status === 401);
}


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
