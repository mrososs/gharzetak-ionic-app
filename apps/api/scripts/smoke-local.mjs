// End-to-end smoke test against a RUNNING local Worker (`npm run dev` -> http://127.0.0.1:8787).
// Uses Wrangler's simulated D1 + R2. Refuses to run against anything that is not localhost.
import { randomUUID } from 'node:crypto';

const BASE = process.env.API_URL ?? 'http://127.0.0.1:8787';
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error(`Refusing to run smoke test against ${BASE}`);
const ORIGIN = 'http://localhost:4200';

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra); }
};

const req = (path, { token, method = 'GET', json, body, type, headers = {} } = {}) =>
  fetch(BASE + path, {
    method,
    headers: { Origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}), ...(type ? { 'Content-Type': type } : {}), ...headers },
    body: json ? JSON.stringify(json) : body,
  });

async function signUp(label) {
  const email = `${label}-${Date.now()}@gharzetak.test`;
  const r = await req('/api/auth/sign-up/email', { method: 'POST', json: { email, password: 'correct-horse-battery', name: label } });
  const token = r.headers.get('set-auth-token');
  const user = (await r.json()).user;
  return { email, token, id: user.id };
}

// A real, decodable 1x1 PNG and 1x1 JPEG so the sniffer sees genuine files.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

console.log(`Smoke test against ${BASE}`);
const a = await signUp('smoke-a');
const b = await signUp('smoke-b');
ok('sign-up returns a bearer token', !!a.token && !!b.token);
ok('session restores with the token', (await (await req('/api/auth/get-session', { token: a.token })).json())?.user?.id === a.id);

// project + progress
const pid = randomUUID();
const now = Date.now();
const project = { baseRevision: 0, clientUpdatedAt: now, name: 'Smoke bunny', category: 'amigurumi', hookSize: '3.0', yarnType: 'cotton', status: 'active', patternId: null, estimatedHours: 3, workedSeconds: 0, lastWorkedAt: now, createdAt: now };
ok('create project (201)', (await req(`/v1/projects/${pid}`, { token: a.token, method: 'PUT', json: project })).status === 201);
const prog = { baseRevision: 0, clientUpdatedAt: now, mode: 'simple', round: 2, target: 30, perTap: 1, count: 11, totalRounds: 0, patternId: null, patternRoundIndex: 0, actionPtr: 0, countMode: 'action', history: [], patternHistory: [] };
ok('save stitch progress (201)', (await req(`/v1/projects/${pid}/progress`, { token: a.token, method: 'PUT', json: prog })).status === 201);
ok('stale progress write is rejected (409)', (await req(`/v1/projects/${pid}/progress`, { token: a.token, method: 'PUT', json: { ...prog, count: 1 } })).status === 409);

// photo upload / retrieval
const photoId = randomUUID();
const up = await req(`/v1/media/project-photos/${pid}/${photoId}`, { token: a.token, method: 'PUT', body: PNG, type: 'image/png' });
const upBody = await up.json();
ok('upload PNG photo (201)', up.status === 201 && upBody.mime === 'image/png', JSON.stringify(upBody));
const dl = await req(`/v1/media/object?key=${encodeURIComponent(upBody.key)}`, { token: a.token });
const got = Buffer.from(await dl.arrayBuffer());
ok('owner downloads identical bytes', dl.status === 200 && got.equals(PNG));
ok('download is private + nosniff', /private/.test(dl.headers.get('cache-control') ?? '') && dl.headers.get('x-content-type-options') === 'nosniff');
ok('other user gets 404 for the same key', (await req(`/v1/media/object?key=${encodeURIComponent(upBody.key)}`, { token: b.token })).status === 404);
ok('anonymous gets 401', (await req(`/v1/media/object?key=${encodeURIComponent(upBody.key)}`)).status === 401);
ok('no public URL serves the object', [401, 404].includes((await req(`/${upBody.key}`)).status));
ok('other user cannot upload into the project (404)', (await req(`/v1/media/project-photos/${pid}/${randomUUID()}`, { token: b.token, method: 'PUT', body: JPEG, type: 'image/jpeg' })).status === 404);
ok('HTML disguised as JPEG is rejected (415)', (await req(`/v1/media/project-photos/${pid}/${randomUUID()}`, { token: a.token, method: 'PUT', body: Buffer.from('<script>alert(1)</script>'), type: 'image/jpeg' })).status === 415);
ok('oversized upload is rejected (413)', (await req(`/v1/media/project-photos/${pid}/${randomUUID()}`, { token: a.token, method: 'PUT', body: Buffer.concat([JPEG, Buffer.alloc(8 * 1024 * 1024)]), type: 'image/jpeg' })).status === 413);

// cover + pull
const cover = await req(`/v1/media/project-covers/${pid}`, { token: a.token, method: 'PUT', body: JPEG, type: 'image/jpeg' });
ok('upload cover (201)', cover.status === 201);
const pulled = await (await req('/v1/sync/pull', { token: a.token })).json();
ok('pull restores project, progress and cover path', pulled.projects[0]?.name === 'Smoke bunny' && pulled.progress[0]?.count === 11 && !!pulled.projects[0]?.coverPath && pulled.photos.length === 1);
const pulledB = await (await req('/v1/sync/pull', { token: b.token })).json();
ok('user B sees none of user A’s data', pulledB.projects.length === 0 && pulledB.photos.length === 0);

// delete
ok('delete photo (204)', (await req(`/v1/media/object?key=${encodeURIComponent(upBody.key)}`, { token: a.token, method: 'DELETE' })).status === 204);
ok('deleted photo is gone (404)', (await req(`/v1/media/object?key=${encodeURIComponent(upBody.key)}`, { token: a.token })).status === 404);
ok('sign-out invalidates the token', (await req('/api/auth/sign-out', { token: a.token, method: 'POST', json: {} })).status === 200 && (await req('/v1/sync/pull', { token: a.token })).status === 401);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
