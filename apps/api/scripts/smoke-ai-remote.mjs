// Khayoota AI smoke test against the DEPLOYED STAGING Worker. Refuses any host that is not gharzetak-api-staging.
//
//   Stage A (AI master switch OFF — no model can be reached):
//     STAGING_URL=https://gharzetak-api-staging.gharzetak.workers.dev node scripts/smoke-ai-remote.mjs --stage A
//   Stage B (AI_ENABLED=true, photos + extraction OFF) — guards only, still NO model call:
//     STAGING_URL=... node scripts/smoke-ai-remote.mjs --stage B --email smoke-ai-<ts>@gharzetak.test
//   Stage B/C live text replies (bounded, real Gemma 4 inference; needs an explicit approval for live inference):
//     KHAYOOTA_LIVE_APPROVED=yes STAGING_URL=... node scripts/smoke-ai-remote.mjs --stage B --email smoke-ai-<ts>@gharzetak.test --live 3
//
// Creates throw-away accounts (smoke-ai-*@gharzetak.test) in the STAGING database only. Never prints tokens.
// Every guard check below is rejected by the Worker BEFORE any model call (see apps/api/src/routes/ai.ts).
const args = process.argv.slice(2);
const arg = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const stage = (arg('--stage') ?? '').toUpperCase();
const live = Math.min(Math.max(Number.parseInt(arg('--live') ?? '0', 10) || 0, 0), 5); // hard ceiling: 5 live questions per run
const BASE = (process.env.STAGING_URL ?? '').replace(/\/+$/, '');
if (!/^https:\/\/gharzetak-api-staging\.[a-z0-9-]+\.workers\.dev$/.test(BASE)) throw new Error(`Refusing to run against "${BASE}": set STAGING_URL to the staging workers.dev URL`);
if (stage !== 'A' && stage !== 'B') throw new Error('Pass --stage A or --stage B');
if (live && (stage !== 'B' || process.env.KHAYOOTA_LIVE_APPROVED !== 'yes')) throw new Error('--live needs --stage B and KHAYOOTA_LIVE_APPROVED=yes (live inference must be approved separately)');

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
async function signIn(email) {
  if (!/^smoke-ai-[0-9]+@gharzetak\.test$/.test(email)) throw new Error('--email must be a smoke-ai-…@gharzetak.test account created by --stage A');
  const r = await req('/api/auth/sign-in/email', { method: 'POST', json: { email, password: 'correct-horse-battery' } });
  const body = await r.json().catch(() => ({}));
  return { token: r.headers.get('set-auth-token'), id: body.user?.id, email };
}
const JPEG = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

console.log(`Khayoota AI smoke (stage ${stage}${live ? `, ${live} live` : ''}) against ${BASE}`);
const health = await (await fetch(BASE + '/health')).json();
ok('health: D1 ok', health.status === 'ok', JSON.stringify(health));
for (const [m, p] of [['GET', '/v1/ai/status'], ['POST', '/v1/ai/chat'], ['PUT', '/v1/ai/consent'], ['POST', '/v1/ai/extract']]) {
  ok(`anonymous ${m} ${p} → 401`, (await req(p, { method: m, json: m === 'GET' ? undefined : {} })).status === 401);
}
const email = arg('--email');
if (stage === 'B' && !email) throw new Error('Stage B needs --email <the smoke-ai account printed by stage A, listed in AI_ALLOWED_USER_IDS>');
const u = stage === 'A' ? await signUp('smoke-ai') : await signIn(email);
ok(stage === 'A' ? 'sign-up works (auth unchanged)' : 'smoke account signs in', !!u.token);
const status = await (await req('/v1/ai/status', { token: u.token })).json();

if (stage === 'A') {
  console.log(`    smoke account for stage B: ${u.email}  (user id ${u.id} — add it to AI_ALLOWED_USER_IDS)`);
  ok('status: AI disabled', status.enabled === false, JSON.stringify(status));
  const chat = await req('/v1/ai/chat', { token: u.token, method: 'POST', json: { v: 1, lang: 'en', message: 'hi' } });
  ok('chat → 503 ai_disabled', chat.status === 503 && (await code(chat)) === 'ai_disabled');
  const cons = await req('/v1/ai/consent', { token: u.token, method: 'PUT', json: { version: 1 } });
  ok('consent → 503 ai_disabled', cons.status === 503);
  const sync = await req('/v1/sync/pull', { token: u.token });
  ok('sync pull still 200', sync.status === 200);
} else {
  const stranger = await signUp('smoke-ai-out');
  const strangerStatus = await (await req('/v1/ai/status', { token: stranger.token })).json();
  ok('an account NOT in AI_ALLOWED_USER_IDS sees AI disabled', strangerStatus.enabled === false, JSON.stringify(strangerStatus));
  const strangerChat = await req('/v1/ai/chat', { token: stranger.token, method: 'POST', json: { v: 1, lang: 'en', message: 'hi' } });
  ok('… and its chat is refused (503)', strangerChat.status === 503);
  ok('status: enabled, workers-ai provider', status.enabled === true && status.provider === 'workers-ai', JSON.stringify(status));
  ok('status: photos and extraction OFF', status.features?.vision === false && status.features?.extract === false);
  ok('status: consent not yet given', status.consent?.accepted === false);
  ok('status: image/extract quota 0', status.limits?.image === 0 && status.limits?.extract === 0);
  const noConsent = await req('/v1/ai/chat', { token: u.token, method: 'POST', json: { v: 1, lang: 'ar', message: 'إيه الفرق بين sc و hdc؟' } });
  ok('chat without consent → 403 ai_consent_required', noConsent.status === 403 && (await code(noConsent)) === 'ai_consent_required');
  const old = await req('/v1/ai/consent', { token: u.token, method: 'PUT', json: { version: 999 } });
  ok('outdated consent version refused', old.status === 400);
  ok('consent accepted', (await req('/v1/ai/consent', { token: u.token, method: 'PUT', json: { version: 1 } })).status === 200);
  const photo = await req('/v1/ai/chat', { token: u.token, method: 'POST', json: { v: 1, lang: 'en', message: 'look', images: [{ mime: 'image/jpeg', data: JPEG }] } });
  ok('photo question → 403 ai_feature_disabled', photo.status === 403 && (await code(photo)) === 'ai_feature_disabled');
  const ext = await req('/v1/ai/extract', { token: u.token, method: 'POST', raw: '{}' });
  ok('extraction → 403 ai_feature_disabled', ext.status === 403 && (await code(ext)) === 'ai_feature_disabled');
  const big = await req('/v1/ai/chat', { token: u.token, method: 'POST', json: { v: 1, lang: 'en', message: 'x', history: [{ role: 'user', text: 'y'.repeat(70_000) }] } });
  ok('oversized text body → 400 before parsing', big.status === 400);
  const bad = await req('/v1/ai/chat', { token: u.token, method: 'POST', json: { v: 1, lang: 'en', message: '' } });
  ok('invalid body → 400', bad.status === 400);

  const LIVE = [
    { lang: 'ar', message: 'خيوطة، إيه الفرق بين sc و hdc؟' },
    { lang: 'ar', message: 'مين كسب ماتش امبارح؟' },
    { lang: 'en', message: 'What does (2sc, inc) x 6 make?', calc: [{ expr: '(2sc, inc) x 6', normalized: '(2sc, inc) x 6', consumed: 18, produced: 24, declared: null, mismatch: false, status: 'validated' }] },
    { lang: 'ar', message: 'مش فاهمة غرزة التناقص.' },
    { lang: 'en', message: 'Is UK treble the same as US treble?' },
  ];
  for (const q of LIVE.slice(0, live)) {
    const t0 = Date.now();
    const r = await req('/v1/ai/chat', { token: u.token, method: 'POST', json: { v: 1, ...q } });
    const body = await r.json().catch(() => ({}));
    ok(`LIVE ${q.lang}: "${q.message.slice(0, 40)}" → 200 (${Date.now() - t0} ms)`, r.status === 200, JSON.stringify(body).slice(0, 200));
    if (r.status === 200) console.log(`      reply: ${body.reply.text.slice(0, 300)}\n      actions: ${JSON.stringify(body.reply.actions)} degraded=${body.reply.degraded} remaining=${body.usage.remaining.chat}`);
  }
  ok('consent withdrawn', (await req('/v1/ai/consent', { token: u.token, method: 'DELETE' })).status === 204);
  const after = await req('/v1/ai/chat', { token: u.token, method: 'POST', json: { v: 1, lang: 'en', message: 'hi' } });
  ok('chat after withdrawal → 403', after.status === 403);
  const out = await req('/api/auth/sign-out', { token: u.token, method: 'POST', json: {} });
  ok('sign-out', out.status === 200);
  ok('chat after sign-out → 401', (await req('/v1/ai/chat', { token: u.token, method: 'POST', json: { v: 1, lang: 'en', message: 'hi' } })).status === 401);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
