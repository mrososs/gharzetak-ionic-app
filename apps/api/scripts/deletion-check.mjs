// End-to-end check of account deletion against a RUNNING Worker (local `wrangler dev` or STAGING), using ONLY a synthetic account that it
// creates itself and deletes itself. It never touches any other account. Refuses a URL that is not localhost unless
// --allow-remote is passed (so it cannot be pointed at production by accident), and refuses any host named like production.
//
//   node scripts/deletion-check.mjs --url http://localhost:8787 --origin http://localhost:4310
//   node scripts/deletion-check.mjs --url https://gharzetak-api-staging.gharzetak.workers.dev --origin https://localhost --allow-remote
//
// It prints the R2 object keys that must be GONE afterwards, so the operator can confirm them independently with
//   wrangler r2 object get gharzetak-media/<staging/ + key>   (404 / "not found" expected).
const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const url = (arg('url') ?? '').replace(/\/+$/, '');
const origin = arg('origin') ?? 'http://localhost:4310';
const allowRemote = process.argv.includes('--allow-remote');
if (!url) throw new Error('--url is required');
const host = new URL(url).hostname;
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(host);
if (!isLocal && !allowRemote) throw new Error('refusing a non-local URL without --allow-remote');
const looksStaging = /staging|test|dev/i.test(host);
if (!isLocal && !looksStaging && !process.argv.includes('--allow-production')) throw new Error(`refusing ${host}: it does not look like staging. For the post-deploy smoke test of PRODUCTION pass --allow-production (the check creates and deletes only its own synthetic account).`);

const email = `deletion-check-${Date.now()}@gharzetak.test`;
const password = `chk-${crypto.randomUUID()}`; // synthetic, random, never printed
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
};
const call = async (path, { method = 'GET', token, body, headers = {} } = {}) => {
  const res = await fetch(url + path, { method, headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined });
  return { status: res.status, headers: res.headers, json: async () => res.json().catch(() => null) };
};
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);

const signUp = await call('/api/auth/sign-up/email', { method: 'POST', body: { email, password, name: 'Deletion Check' } });
check('sign up a synthetic account', signUp.status === 200);
const token = signUp.headers.get('set-auth-token');
const userId = (await signUp.json())?.user?.id;
if (!token || !userId) throw new Error('could not create the synthetic account');
console.log(`synthetic account id: ${userId}`);

const pid = crypto.randomUUID();
const now = Date.now();
const project = await call(`/v1/projects/${pid}`, { method: 'PUT', token, body: { baseRevision: 0, clientUpdatedAt: now, name: 'Check', category: 'amigurumi', hookSize: '3.0', yarnType: 'cotton', status: 'active', patternId: null, estimatedHours: 1, workedSeconds: 0, lastWorkedAt: now, createdAt: now } });
check('create a project', project.status === 201);
const photoId = crypto.randomUUID();
const photo = await call(`/v1/media/project-photos/${pid}/${photoId}`, { method: 'PUT', token, body: JPEG, headers: { 'Content-Type': 'image/jpeg' } });
const photoBody = await photo.json();
check('upload a photo to R2', photo.status === 201, photoBody?.key ?? '');
check('pull works before deletion', (await call('/v1/sync/pull', { token })).status === 200);

const wrong = await call('/api/auth/delete-user', { method: 'POST', token, body: { password: 'definitely-wrong-password' } });
check('a wrong password deletes nothing (400)', wrong.status === 400);
check('account still works after the wrong password', (await call('/v1/sync/pull', { token })).status === 200);

const del = await call('/api/auth/delete-user', { method: 'POST', token, body: { password } });
const delBody = await del.json();
check('delete with the right password (200, success)', del.status === 200 && delBody?.success === true, JSON.stringify({ storageCleanup: delBody?.storageCleanup }));
check('server reports a truthful storage state', ['complete', 'pending'].includes(delBody?.storageCleanup));
check('the old token is rejected (401) on sync', (await call('/v1/sync/pull', { token })).status === 401);
check('the old token is rejected (401) on media', (await call(`/v1/media/object?key=${encodeURIComponent(photoBody?.key ?? 'x')}`, { token })).status === 401);
const session = await call('/api/auth/get-session', { token });
check('get-session returns no session', (await session.json()) === null);
const again = await call('/api/auth/delete-user', { method: 'POST', token, body: { password } });
check('a repeated delete is rejected (401)', again.status === 401);
const signIn = await call('/api/auth/sign-in/email', { method: 'POST', body: { email, password } });
check('signing in with the deleted credentials fails', signIn.status >= 400);
const re = await call('/api/auth/sign-up/email', { method: 'POST', body: { email, password: `${password}-2`, name: 'Deletion Check' } });
const reId = (await re.json())?.user?.id;
check('the same e-mail can register again as a NEW account', re.status === 200 && !!reId && reId !== userId);
const reToken = re.headers.get('set-auth-token');
if (reToken) {
  const pull = await call('/v1/sync/pull', { token: reToken });
  const data = await pull.json();
  check('the new account is empty', pull.status === 200 && (data?.projects ?? []).length === 0);
  // clean up the second synthetic account too
  const cleanup = await call('/api/auth/delete-user', { method: 'POST', token: reToken, body: { password: `${password}-2` } });
  check('clean-up: the second synthetic account is deleted', cleanup.status === 200);
}

console.log('\nOperator follow-up (cannot be checked over HTTP):');
console.log(`  - R2 key that must be gone: ${photoBody?.key ?? '(none)'}${delBody?.storageCleanup === 'pending' ? '   (state was PENDING: the hourly cron must remove it; re-check after an hour)' : ''}`);
console.log(`  - D1: select count(*) from user where id = '${userId}'  -> 0 ;  select state from account_deletion_job where user_id = '${userId}'  -> 'swept' or no row`);
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
