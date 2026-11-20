import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import { ABANDONED_ATTEMPT_MS, FINAL_SWEEP_DELAY_MS, finishDeletion, purgeTransient, reconcile, sweepUserObjects } from '../src/services/account-deletion';
import { JPEG, PDF, ORIGIN, authed, bytes, call, createProject, json, progressBody, signUp, uuid, type TestUser } from './helpers';

const PASSWORD = 'correct-horse-battery';

/** Every table that carries an account's data, with the column that ties a row to the account. */
const OWNED: [string, string][] = [
  ['user', 'id'],
  ['session', 'user_id'],
  ['account', 'user_id'],
  ['profiles', 'user_id'],
  ['user_tools', 'user_id'],
  ['patterns', 'owner_id'],
  ['pattern_collections', 'owner_id'],
  ['pattern_revisions', 'owner_id'],
  ['projects', 'owner_id'],
  ['project_parts', 'owner_id'],
  ['project_progress', 'owner_id'],
  ['project_notes', 'owner_id'],
  ['project_photos', 'owner_id'],
  ['work_sessions', 'owner_id'],
  ['favorites', 'user_id'],
  ['tutorial_bookmarks', 'user_id'],
  ['tutorial_timestamps', 'user_id'],
  ['store_interest', 'user_id'],
  ['media_objects', 'user_id'],
  ['ai_user_state', 'user_id'],
  ['ai_usage_daily', 'scope'],
  ['ai_rate', 'user_id'],
  ['ai_request_ledger', 'user_id'],
];

async function counts(userId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [table, col] of OWNED) out[table] = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?1`).bind(userId).first<{ n: number }>())!.n;
  out.pattern_rounds = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM pattern_rounds WHERE pattern_id IN (SELECT id FROM patterns WHERE owner_id = ?1)`).bind(userId).first<{ n: number }>())!.n;
  out.pattern_parts = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM pattern_parts WHERE collection_id IN (SELECT id FROM pattern_collections WHERE owner_id = ?1)`).bind(userId).first<{ n: number }>())!.n;
  out.verification = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM verification WHERE value = ?1`).bind(userId).first<{ n: number }>())!.n;
  return out;
}

async function r2Keys(userId: string): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const l = await env.MEDIA.list({ prefix: `${userId}/`, cursor });
    out.push(...l.objects.map((o) => o.key));
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  return out;
}

const part = (name: string) => ({ id: uuid(), name, quantity: 1, rawText: 'R1: 6sc in MR [6]', assemblyNotes: '' });

/** Gives an account a row in (almost) every user-keyed table and files in R2. */
async function populate(u: TestUser) {
  const ok = async (p: Response | Promise<Response>, status: number | number[]) => {
    const r = await p;
    const want = Array.isArray(status) ? status : [status];
    if (!want.includes(r.status)) throw new Error(`setup step failed ${r.status}: ${await r.text()}`);
    return r;
  };
  const now = Date.now();
  const pid = await createProject(u);
  await ok(json(u, 'PUT', `/v1/projects/${pid}/progress`, progressBody()), [200, 201]);
  await ok(json(u, 'PUT', `/v1/projects/${pid}/notes`, { baseRevision: 0, clientUpdatedAt: now, body: 'private note' }), [200, 201]);
  const photoId = uuid();
  await ok(bytes(u, `/v1/media/project-photos/${pid}/${photoId}`, JPEG, 'image/jpeg'), 201);
  await ok(bytes(u, `/v1/media/project-covers/${pid}`, JPEG, 'image/jpeg'), 201);
  const patId = uuid();
  await ok(
    json(u, 'PUT', `/v1/patterns/${patId}`, { baseRevision: 0, clientUpdatedAt: now, name: 'P', level: 'beginner', terms: 'us', sourceType: 'text', sourceUrl: null, attribution: null, rawText: 'R1: 6sc in MR [6]', readingPosition: 0, rounds: [] }),
    [200, 201],
  );
  await ok(bytes(u, `/v1/media/pattern-files/${patId}`, PDF, 'application/pdf', { 'X-File-Name': 'secret.pdf' }), 201);
  await ok(json(u, 'PUT', `/v1/revisions/pattern/${patId}/1`, { name: 'old', createdAt: now, snapshot: { terms: 'us', text: 'old text' } }), [200, 201, 204]);
  await ok(
    json(u, 'PUT', `/v1/collections/${uuid()}`, { baseRevision: 0, clientUpdatedAt: now, name: 'Bear', description: '', level: 'beginner', terms: 'us', coverData: null, contentRev: 1, suggestedMinutes: 60, sourceText: '', parts: [part('Head'), part('Body')] }),
    [200, 201],
  );
  await ok(json(u, 'PUT', '/v1/tools', { baseRevision: 0, clientUpdatedAt: now, hooks: ['3.0'], yarns: ['cotton'], accessories: ['eyes'] }), [200, 201]);
  await ok(json(u, 'PUT', `/v1/sessions/${uuid()}`, { projectId: pid, startedAt: now - 60_000, endedAt: now, seconds: 60 }), [200, 201, 204]);
  await ok(json(u, 'PUT', '/v1/favorites/tut-1'), 204);
  await ok(json(u, 'PUT', '/v1/tutorials/tut-1', { baseRevision: 0, clientUpdatedAt: now, youtubeUrl: null, creatorName: null, projectId: pid, notes: 'n', stamps: [{ id: uuid(), seconds: 5, note: 'x' }] }), [200, 201]);
  await ok(json(u, 'PUT', '/v1/interest', { email: u.email }), 204);
  await ok(json(u, 'PUT', '/v1/ai/consent', { version: 1 }), 200);
  // Counters and tokens that have NO foreign key to the user.
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO ai_usage_daily (scope, day, chat, requests) VALUES (?1, '2026-11-20', 2, 2)`).bind(u.id),
    env.DB.prepare(`INSERT INTO ai_rate (user_id, window_start, units) VALUES (?1, ?2, 1)`).bind(u.id, Date.now()),
    env.DB.prepare(`INSERT INTO ai_request_ledger (user_id, request_id, day, chat, image, state, created_at) VALUES (?1, 'req-del-0001', '2026-11-20', 1, 0, 'done', ?2)`).bind(u.id, Date.now()),
    env.DB.prepare(`INSERT INTO verification (id, identifier, value, expires_at) VALUES (?1, ?2, ?3, ?4)`).bind(uuid(), `reset-password:tok-${uuid()}`, u.id, Date.now() + 3_600_000),
    env.DB.prepare(`INSERT INTO verification (id, identifier, value, expires_at) VALUES (?1, ?2, ?3, ?4)`).bind(uuid(), u.email, 'otp-123', Date.now() + 3_600_000),
  ]);
  return { pid, patId, photoId };
}

const del = (u: TestUser | null, body: Record<string, unknown> = { password: PASSWORD }, e: typeof env = env) =>
  app.request('/api/auth/delete-user', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...authed(u) }, body: JSON.stringify(body) }, e);

const failingBucket = (): R2Bucket =>
  ({
    list: () => Promise.reject(new Error('R2 unavailable')),
    delete: () => Promise.reject(new Error('R2 unavailable')),
    get: () => Promise.reject(new Error('R2 unavailable')),
    put: () => Promise.reject(new Error('R2 unavailable')),
  }) as unknown as R2Bucket;

const job = (userId: string) => env.DB.prepare('SELECT * FROM account_deletion_job WHERE user_id = ?1').bind(userId).first<{ state: string; attempts: number; last_error: string | null }>();

describe('account deletion: complete removal', () => {
  it('deletes every record and every R2 file of the account, revokes the session and reports truthfully', async () => {
    const u = await signUp('del');
    await populate(u);
    const before = await counts(u.id);
    // The fixture really exercised the tables (a zero here would make the "after" assertion meaningless).
    for (const t of ['user', 'session', 'account', 'profiles', 'user_tools', 'patterns', 'pattern_collections', 'pattern_parts', 'pattern_revisions', 'projects', 'project_progress', 'project_notes', 'project_photos', 'work_sessions', 'favorites', 'tutorial_bookmarks', 'tutorial_timestamps', 'store_interest', 'media_objects', 'ai_user_state', 'ai_usage_daily', 'ai_rate', 'ai_request_ledger', 'verification'])
      expect(before[t], `fixture has no ${t} rows`).toBeGreaterThan(0);
    expect((await r2Keys(u.id)).length).toBeGreaterThanOrEqual(3); // photo + cover + pattern file

    const res = await del(u);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'User deleted', storageCleanup: 'complete' });

    const after = await counts(u.id);
    for (const [t, n] of Object.entries(after)) expect(n, `${t} still has rows`).toBe(0);
    expect(await r2Keys(u.id)).toEqual([]);
    expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM verification WHERE identifier = ?1`).bind(u.email).first()).toEqual({ n: 0 });
    expect(await job(u.id)).toMatchObject({ state: 'swept', last_error: null });
  });

  it('revokes access at once: the old token gets 401 on sync, media, AI and session endpoints', async () => {
    const u = await signUp('revoked');
    const { pid } = await populate(u);
    expect((await del(u)).status).toBe(200);
    expect((await json(u, 'GET', '/v1/sync/pull')).status).toBe(401);
    expect((await json(u, 'PUT', `/v1/projects/${pid}/notes`, { baseRevision: 0, clientUpdatedAt: Date.now(), body: 'x' })).status).toBe(401);
    expect((await bytes(u, `/v1/media/project-photos/${pid}/${uuid()}`, JPEG, 'image/jpeg')).status).toBe(401);
    expect((await json(u, 'GET', '/v1/ai/status')).status).toBe(401);
    const session = await call('/api/auth/get-session', { headers: authed(u) });
    expect(await session.json()).toBeNull();
  });

  it('the credentials stop working, and the same e-mail can register again as a brand-new, empty account', async () => {
    const u = await signUp('again');
    await populate(u);
    expect((await del(u)).status).toBe(200);
    const signIn = await call('/api/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password: PASSWORD }) });
    expect(signIn.status).toBeGreaterThanOrEqual(400);

    const re = await call('/api/auth/sign-up/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password: 'another-password-1', name: 'again' }) });
    expect(re.status).toBe(200);
    const created = (await re.json()) as { user: { id: string } };
    expect(created.user.id).not.toBe(u.id);
    const fresh = await counts(created.user.id);
    expect(fresh.projects).toBe(0);
    expect(fresh.media_objects).toBe(0);
    expect(await r2Keys(created.user.id)).toEqual([]);
  });

  it('a repeated request after success is rejected (the session is gone) and changes nothing', async () => {
    const u = await signUp('twice');
    await populate(u);
    expect((await del(u)).status).toBe(200);
    expect((await del(u)).status).toBe(401);
    expect((await counts(u.id)).user).toBe(0);
  });

  it('tombstoned (soft-deleted) rows and their revisions are removed with the account', async () => {
    const u = await signUp('tomb');
    const pid = await createProject(u);
    expect((await json(u, 'DELETE', `/v1/projects/${pid}`)).status).toBe(204); // leaves a tombstone row
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?1 AND deleted_at IS NOT NULL').bind(u.id).first<{ n: number }>())!.n).toBe(1);
    expect((await del(u)).status).toBe(200);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM projects WHERE id = ?1').bind(pid).first<{ n: number }>())!.n).toBe(0);
  });
});

describe('account deletion: authority and isolation', () => {
  it('rejects unauthenticated callers without touching anything', async () => {
    const u = await signUp('anon');
    await populate(u);
    const before = await counts(u.id);
    expect((await del(null)).status).toBe(401);
    expect((await del({ ...u, token: 'not-a-real-token' })).status).toBe(401);
    expect(await counts(u.id)).toEqual(before);
  });

  it('a wrong password deletes nothing', async () => {
    const u = await signUp('wrongpw');
    await populate(u);
    const before = await counts(u.id);
    const res = await del(u, { password: 'definitely-not-it' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('INVALID_PASSWORD'); // the app maps this code to "wrong password"
    expect(await counts(u.id)).toEqual(before);
    expect((await json(u, 'GET', '/v1/sync/pull')).status).toBe(200);
    expect(await job(u.id)).toBeNull();
  });

  it('without a password an OLD session is refused (re-authentication needed) but a FRESH one is accepted', async () => {
    const u = await signUp('fresh');
    await env.DB.prepare('UPDATE session SET created_at = ?2 WHERE user_id = ?1').bind(u.id, Date.now() - 3 * 86_400_000).run();
    const stale = await del(u, {});
    expect(stale.status).toBe(400);
    expect(((await stale.json()) as { code: string }).code).toBe('SESSION_EXPIRED'); // the app maps this code to "re-authenticate"
    expect((await counts(u.id)).user).toBe(1);

    const fresh = await signUp('fresh2');
    const ok = await del(fresh, {});
    expect(ok.status).toBe(200);
    expect((await counts(fresh.id)).user).toBe(0);
  });

  it('the e-mail-token flow is not available (there is no mail provider): a made-up token deletes nothing', async () => {
    const u = await signUp('token');
    const res = await del(u, { token: 'a'.repeat(32) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await counts(u.id)).user).toBe(1);
  });

  it("deleting account A never touches account B's rows, files, counters or the shared AI budget", async () => {
    const a = await signUp('victim-a');
    const b = await signUp('bystander-b');
    await populate(a);
    await populate(b);
    await env.DB.prepare(`INSERT OR REPLACE INTO ai_usage_daily (scope, day, requests, neurons_reserved) VALUES ('__all__', '2026-11-20', 7, 99)`).run();
    const bBefore = await counts(b.id);
    const bKeys = await r2Keys(b.id);

    // A's request cannot name another account: even a body that tries to is ignored, the target is always the caller.
    expect((await del(a, { password: PASSWORD, userId: b.id })).status).toBe(200);

    expect(await counts(b.id)).toEqual(bBefore);
    expect(await r2Keys(b.id)).toEqual(bKeys);
    expect((await json(b, 'GET', '/v1/sync/pull')).status).toBe(200);
    expect(await env.DB.prepare(`SELECT requests, neurons_reserved FROM ai_usage_daily WHERE scope = '__all__' AND day = '2026-11-20'`).first()).toEqual({ requests: 7, neurons_reserved: 99 });
    expect((await counts(a.id)).user).toBe(0);
  });

  it('a user with a similar id prefix keeps their files (the sweep matches `<id>/` exactly)', async () => {
    const a = await signUp('prefix-a');
    const other = `${a.id}x`;
    await env.MEDIA.put(`${other}/p/file.jpg`, JPEG);
    await env.MEDIA.put(`${a.id}/p/file.jpg`, JPEG);
    expect((await del(a)).status).toBe(200);
    expect(await r2Keys(a.id)).toEqual([]);
    expect((await env.MEDIA.get(`${other}/p/file.jpg`))?.size).toBe(JPEG.byteLength);
    await env.MEDIA.delete(`${other}/p/file.jpg`);
  });

  it('foreign keys block any write for a deleted owner (an in-flight sync cannot resurrect rows)', async () => {
    const u = await signUp('race');
    expect((await del(u)).status).toBe(200);
    await expect(
      env.DB.prepare(`INSERT INTO project_notes (project_id, owner_id, body, client_updated_at, revision, updated_at) VALUES (?1, ?2, 'x', 1, 1, 1)`).bind(uuid(), u.id).run(),
    ).rejects.toThrow();
    await expect(env.DB.prepare(`INSERT INTO favorites (user_id, item_type, item_id) VALUES (?1, 'tutorial', 'x')`).bind(u.id).run()).rejects.toThrow();
  });
});

describe('account deletion: partial failures, retries and reconciliation', () => {
  it('R2 down: the account IS deleted, the response says the file cleanup is pending, and the job is queued for retry', async () => {
    const u = await signUp('r2down');
    await populate(u);
    const keys = await r2Keys(u.id);
    expect(keys.length).toBeGreaterThan(0);

    const res = await del(u, { password: PASSWORD }, { ...env, MEDIA: failingBucket() } as typeof env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, storageCleanup: 'pending' });
    expect((await counts(u.id)).user).toBe(0);
    expect((await json(u, 'GET', '/v1/sync/pull')).status).toBe(401);
    expect(await r2Keys(u.id)).toEqual(keys); // still there: nothing was claimed deleted
    expect(await job(u.id)).toMatchObject({ state: 'pending', attempts: 1, last_error: 'storage_error' });
  });

  it('the reconciler finishes the queued job, re-verifies once, then leaves no trace of the id', async () => {
    const u = await signUp('recon');
    await populate(u);
    await del(u, { password: PASSWORD }, { ...env, MEDIA: failingBucket() } as typeof env);
    expect((await r2Keys(u.id)).length).toBeGreaterThan(0);

    const t0 = Date.now();
    const r1 = await reconcile(env, t0);
    expect(r1.retried).toBeGreaterThanOrEqual(1); // other tests' queued jobs share this database
    expect(r1.stillPending).toBe(0);
    expect(await r2Keys(u.id)).toEqual([]);
    expect(await job(u.id)).toMatchObject({ state: 'swept', last_error: null });

    // Too early for the verification sweep: nothing happens, the job is kept.
    expect((await reconcile(env, t0 + 1000)).retried).toBe(0);
    expect(await job(u.id)).not.toBeNull();

    // A straggler upload that raced the deletion lands in the prefix; the verification sweep removes it.
    await env.MEDIA.put(`${u.id}/late/upload.jpg`, JPEG);
    const r2 = await reconcile(env, t0 + FINAL_SWEEP_DELAY_MS + 1000);
    expect(r2.completed).toBeGreaterThanOrEqual(1);
    expect(await r2Keys(u.id)).toEqual([]);
    expect(await job(u.id)).toBeNull();
  });

  it('a reconcile that still cannot reach R2 keeps the job pending and counts the attempt (never reports done)', async () => {
    const u = await signUp('stuck');
    await del(u, { password: PASSWORD }, { ...env, MEDIA: failingBucket() } as typeof env);
    const r = await reconcile({ DB: env.DB, MEDIA: failingBucket() });
    expect(r).toMatchObject({ retried: 1, stillPending: 1, completed: 0 });
    expect(await job(u.id)).toMatchObject({ state: 'pending', attempts: 2 });
  });

  it('is idempotent: finishing and reconciling repeatedly converges and never errors', async () => {
    const u = await signUp('idem');
    await populate(u);
    await del(u);
    for (let i = 0; i < 3; i++) expect(await finishDeletion(env, u.id)).toBe('complete');
    await reconcile(env);
    await reconcile(env, Date.now() + FINAL_SWEEP_DELAY_MS + 1);
    expect(await job(u.id)).toBeNull();
    expect(await sweepUserObjects(env.MEDIA, u.id)).toBe(0);
  });

  it('if deletion cannot even start (journal unwritable) it aborts BEFORE touching anything: the account stays fully intact', async () => {
    const u = await signUp('abort');
    await populate(u);
    const before = await counts(u.id);
    const flaky = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql: string) => {
            if (sql.includes('account_deletion_job')) throw new Error('D1 unavailable');
            return target.prepare(sql);
          };
        }
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
    const res = await del(u, { password: PASSWORD }, { ...env, DB: flaky } as typeof env);
    expect(res.status).toBe(503);
    expect(await counts(u.id)).toEqual(before);
    expect((await r2Keys(u.id)).length).toBeGreaterThan(0);
    expect((await json(u, 'GET', '/v1/sync/pull')).status).toBe(200);
  });

  it('never sweeps a LIVE account: a journal row whose user still exists is only dropped when abandoned', async () => {
    const u = await signUp('live');
    await env.MEDIA.put(`${u.id}/keep/me.jpg`, JPEG);
    const t0 = Date.now();
    await env.DB.prepare(`INSERT INTO account_deletion_job (user_id, state, attempts, requested_at, updated_at) VALUES (?1, 'pending', 0, ?2, ?2)`).bind(u.id, t0).run();
    expect(await reconcile(env, t0 + 1000)).toMatchObject({ retried: 0, abandoned: 0 });
    expect(await job(u.id)).not.toBeNull();
    expect(await reconcile(env, t0 + ABANDONED_ATTEMPT_MS + 1)).toMatchObject({ retried: 0, abandoned: 1 });
    expect(await job(u.id)).toBeNull();
    expect((await env.MEDIA.get(`${u.id}/keep/me.jpg`))?.size).toBe(JPEG.byteLength);
    expect((await counts(u.id)).user).toBe(1);
    await env.MEDIA.delete(`${u.id}/keep/me.jpg`);
  });

  it('sweeps more than one R2 page (1000 keys) completely', async () => {
    const id = `bulk${uuid().replace(/-/g, '').slice(0, 20)}`;
    for (let i = 0; i < 1005; i += 100) await Promise.all(Array.from({ length: Math.min(100, 1005 - i) }, (_, j) => env.MEDIA.put(`${id}/b/${i + j}.bin`, new Uint8Array([1]))));
    expect((await r2Keys(id)).length).toBe(1005);
    expect(await sweepUserObjects(env.MEDIA, id)).toBe(1005);
    expect(await r2Keys(id)).toEqual([]);
  }, 120_000);

  it('refuses an unsafe id instead of building an R2 prefix from it', async () => {
    await expect(sweepUserObjects(env.MEDIA, '../other')).rejects.toThrow();
    await expect(sweepUserObjects(env.MEDIA, '')).rejects.toThrow();
  });
});

describe('account deletion: transient security data', () => {
  it('purges expired tokens and old IP-keyed counters but keeps current ones', async () => {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO verification (id, identifier, value, expires_at) VALUES ('old-v', 'old@x.test', 'v', ?1)`).bind(now - 2 * 86_400_000),
      env.DB.prepare(`INSERT INTO verification (id, identifier, value, expires_at) VALUES ('new-v', 'new@x.test', 'v', ?1)`).bind(now + 3_600_000),
      env.DB.prepare(`INSERT INTO rate_limit (id, key, count, last_request) VALUES ('rl-old', '203.0.113.9/sign-in', 3, ?1)`).bind(now - 2 * 86_400_000),
      env.DB.prepare(`INSERT INTO rate_limit (id, key, count, last_request) VALUES ('rl-new', '203.0.113.10/sign-in', 1, ?1)`).bind(now),
    ]);
    expect(await purgeTransient(env.DB, now)).toBeGreaterThanOrEqual(2);
    expect(await env.DB.prepare(`SELECT id FROM verification WHERE id IN ('old-v','new-v')`).all()).toMatchObject({ results: [{ id: 'new-v' }] });
    expect(await env.DB.prepare(`SELECT id FROM rate_limit WHERE id IN ('rl-old','rl-new')`).all()).toMatchObject({ results: [{ id: 'rl-new' }] });
  });
});
