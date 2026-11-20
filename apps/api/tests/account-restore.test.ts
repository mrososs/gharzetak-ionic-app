import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import { LEDGER_PREFIX, LEDGER_RETENTION_MS, FINAL_SWEEP_DELAY_MS, ABANDONED_ATTEMPT_MS, deleteAccountNow, finishDeletion, purgeLedger, reapplyDeletions, reconcile, sweepUserObjects } from '../src/services/account-deletion';
import { JPEG, ORIGIN, authed, bytes, createProject, json, signUp, uuid, type TestUser } from './helpers';

const PASSWORD = 'correct-horse-battery';

/** Tables snapshotted to simulate "the database is restored to a moment before the deletion". */
const TABLES: [string, string][] = [
  ['user', 'id'],
  ['account', 'user_id'],
  ['session', 'user_id'],
  ['profiles', 'user_id'],
  ['projects', 'owner_id'],
  ['project_photos', 'owner_id'],
  ['media_objects', 'user_id'],
];

async function snapshot(userId: string) {
  const out: { table: string; rows: Record<string, unknown>[] }[] = [];
  for (const [table, col] of TABLES) out.push({ table, rows: (await env.DB.prepare(`SELECT * FROM ${table} WHERE ${col} = ?1`).bind(userId).all<Record<string, unknown>>()).results });
  return out;
}

/** What a D1 point-in-time restore does to this account: its rows come back, and the journal written AFTER that moment is gone. */
async function restore(snap: Awaited<ReturnType<typeof snapshot>>) {
  await env.DB.prepare(`DELETE FROM account_deletion_job`).run();
  for (const { rows, table } of snap)
    for (const r of rows) {
      const cols = Object.keys(r);
      await env.DB.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(',')})`)
        .bind(...cols.map((c) => r[c]))
        .run();
    }
}

const count = async (table: string, col: string, id: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?1`).bind(id).first<{ n: number }>())!.n;
const keys = async (prefix: string) => (await env.MEDIA.list({ prefix })).objects.map((o) => o.key);
const del = (u: TestUser, e: typeof env = env) =>
  app.request('/api/auth/delete-user', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...authed(u) }, body: JSON.stringify({ password: PASSWORD }) }, e);
const job = (id: string) => env.DB.prepare('SELECT state, attempts FROM account_deletion_job WHERE user_id = ?1').bind(id).first<{ state: string; attempts: number }>();

async function seed(label: string) {
  const u = await signUp(label);
  const pid = await createProject(u);
  const photo = await bytes(u, `/v1/media/project-photos/${pid}/${uuid()}`, JPEG, 'image/jpeg');
  expect(photo.status).toBe(201);
  return u;
}

describe('restore safety: a database restore cannot permanently resurrect a deleted account', () => {
  it('writes a ledger entry (opaque id only) once the deletion is confirmed', async () => {
    const u = await seed('ledger');
    expect((await del(u)).status).toBe(200);
    const head = await env.MEDIA.head(`${LEDGER_PREFIX}${u.id}`);
    expect(head).not.toBeNull();
    expect(await (await env.MEDIA.get(`${LEDGER_PREFIX}${u.id}`))!.text()).toBe('{"v":1}'); // nothing personal
    expect(head!.key).not.toContain('@');
  });

  it('restore to before the deletion brings the account back; reconciliation deletes it again, with files, and the cron path does it too', async () => {
    const u = await seed('restore');
    const bystander = await seed('bystander');
    const snap = await snapshot(u.id);
    expect(snap.find((s) => s.table === 'user')!.rows).toHaveLength(1);
    expect((await del(u)).status).toBe(200);
    expect(await count('user', 'id', u.id)).toBe(0);

    await restore(snap); // simulated point-in-time restore
    expect(await count('user', 'id', u.id)).toBe(1);
    expect(await count('projects', 'owner_id', u.id)).toBe(1);
    expect(await job(u.id)).toBeNull(); // the journal was rewound too: only the R2 ledger remembers
    await env.MEDIA.put(`${u.id}/orphan/file.jpg`, JPEG); // a file that would reappear in the registry

    const report = await reconcile(env, Date.now());
    expect(report.resurrected).toBeGreaterThanOrEqual(1);
    for (const [t, c] of TABLES) expect(await count(t, c, u.id), `${t} resurrected`).toBe(0);
    expect(await keys(`${u.id}/`)).toEqual([]);
    // a restored token is dead: the session rows are gone again
    expect((await json(u, 'GET', '/v1/sync/pull')).status).toBe(401);
    // accounts that were never deleted are untouched
    expect(await count('user', 'id', bystander.id)).toBe(1);
    expect((await json(bystander, 'GET', '/v1/sync/pull')).status).toBe(200);
    expect(await keys(`${bystander.id}/`)).not.toEqual([]);
  });

  it('is idempotent and does nothing when nothing was resurrected', async () => {
    const u = await seed('noop');
    await del(u);
    const a = await reapplyDeletions(env);
    expect(a.resurrected).toBe(0);
    expect((await reapplyDeletions(env)).resurrected).toBe(0);
  });

  it('a live account is never deleted by the ledger: ids are random and only confirmed deletions are written', async () => {
    const live = await signUp('live-ledger');
    expect(await env.MEDIA.head(`${LEDGER_PREFIX}${live.id}`)).toBeNull();
    // finishDeletion refuses to run (and refuses to write a ledger entry) while the user row exists
    expect(await finishDeletion(env, live.id)).toBe('pending');
    expect(await env.MEDIA.head(`${LEDGER_PREFIX}${live.id}`)).toBeNull();
    expect(await count('user', 'id', live.id)).toBe(1);
  });

  it('ledger entries expire after the retention window and only then (the documented limit of the protection)', async () => {
    const u = await seed('expire');
    await del(u);
    expect(await purgeLedger(env.MEDIA, Date.now() + LEDGER_RETENTION_MS - 60_000)).toBe(0);
    expect(await env.MEDIA.head(`${LEDGER_PREFIX}${u.id}`)).not.toBeNull();
    const snap = await snapshot(u.id); // (empty: already deleted) – restore point simulated from a fresh account below
    expect(snap[0]!.rows).toHaveLength(0);
    expect(await purgeLedger(env.MEDIA, Date.now() + LEDGER_RETENTION_MS + 60_000)).toBeGreaterThanOrEqual(1);
    expect(await env.MEDIA.head(`${LEDGER_PREFIX}${u.id}`)).toBeNull();
  });

  it('deleteAccountNow (the operator / restore path) removes rows, files and writes the ledger', async () => {
    const u = await seed('operator');
    expect(await deleteAccountNow(env, u.id, u.email)).toBe('complete');
    expect(await count('user', 'id', u.id)).toBe(0);
    expect(await keys(`${u.id}/`)).toEqual([]);
    expect(await env.MEDIA.head(`${LEDGER_PREFIX}${u.id}`)).not.toBeNull();
  });
});

/** A D1 wrapper that "kills the isolate" right after the statement that deletes the user row has executed. */
function crashAfterUserDelete(db: D1Database, mode: 'after' | 'before' = 'after'): D1Database {
  let crashed = false;
  const dead = () => {
    throw new Error('isolate died');
  };
  const wrap = (sql: string, stmt: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(stmt, {
      get(t, p) {
        const v = Reflect.get(t, p) as unknown;
        if (p === 'bind') return (...a: unknown[]) => wrap(sql, t.bind(...(a as [])));
        if (p === 'run' || p === 'all' || p === 'first' || p === 'raw') {
          return async (...a: unknown[]) => {
            if (crashed) dead();
            if (mode === 'before' && /delete from "?user"?\b/i.test(sql)) {
              crashed = true;
              dead();
            }
            const r = await (v as (...x: unknown[]) => Promise<unknown>).apply(t, a);
            if (mode === 'after' && /delete from "?user"?\b/i.test(sql)) crashed = true;
            return r;
          };
        }
        return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v;
      },
    });
  return new Proxy(db, {
    get(t, p) {
      if (p === 'prepare') return (sql: string) => wrap(sql, t.prepare(sql));
      if (p === 'batch') return (...a: unknown[]) => (crashed ? dead() : (t.batch as (...x: unknown[]) => unknown)(...a));
      const v = Reflect.get(t, p) as unknown;
      return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v;
    },
  });
}

describe('crash recovery: the R2 cleanup cannot be lost if the Worker dies mid-deletion', () => {
  it('dies right AFTER the user row is deleted (before any cleanup): the journal row written first lets the cron finish everything', async () => {
    const u = await seed('crash-after');
    const files = await keys(`${u.id}/`);
    expect(files.length).toBeGreaterThan(0);
    const res = await del(u, { ...env, DB: crashAfterUserDelete(env.DB) } as typeof env);
    expect(res.status).toBeGreaterThanOrEqual(500); // the client is told it failed (it may retry: 401 then)
    expect(await count('user', 'id', u.id)).toBe(0); // the account is gone …
    expect(await keys(`${u.id}/`)).toEqual(files); // … files and ledger not written yet …
    expect(await env.MEDIA.head(`${LEDGER_PREFIX}${u.id}`)).toBeNull();
    expect(await job(u.id)).toMatchObject({ state: 'pending' }); // … but the work item survived (written BEFORE the delete)

    const r = await reconcile(env);
    expect(r.retried).toBeGreaterThanOrEqual(1);
    expect(await keys(`${u.id}/`)).toEqual([]);
    expect(await env.MEDIA.head(`${LEDGER_PREFIX}${u.id}`)).not.toBeNull();
    expect(await job(u.id)).toMatchObject({ state: 'swept' });
    await reconcile(env, Date.now() + FINAL_SWEEP_DELAY_MS + 1000);
    expect(await job(u.id)).toBeNull();
  });

  it('dies right BEFORE the user row is deleted (Better Auth already removed sessions + sign-in methods): the half-deleted account is finished later, never left as a zombie', async () => {
    const u = await seed('crash-before');
    const files = await keys(`${u.id}/`);
    const res = await del(u, { ...env, DB: crashAfterUserDelete(env.DB, 'before') } as typeof env);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(await count('user', 'id', u.id)).toBe(1);
    expect(await count('account', 'user_id', u.id)).toBe(0); // Better Auth deletes these first; D1 has no transaction
    expect(await job(u.id)).not.toBeNull();
    const t0 = Date.now();
    await reconcile(env, t0 + 1000); // too early: the attempt may still be running
    expect(await keys(`${u.id}/`)).toEqual(files);
    expect(await count('user', 'id', u.id)).toBe(1);
    await reconcile(env, t0 + ABANDONED_ATTEMPT_MS + 1);
    expect(await count('user', 'id', u.id)).toBe(0);
    expect(await keys(`${u.id}/`)).toEqual([]);
    expect(await env.MEDIA.head(`${LEDGER_PREFIX}${u.id}`)).not.toBeNull();
  });

  it('an attempt that never got anywhere (account fully intact, sign-in method still there) is only dropped', async () => {
    const u = await seed('crash-intact');
    const t0 = Date.now();
    await env.DB.prepare(`INSERT INTO account_deletion_job (user_id, state, attempts, requested_at, updated_at) VALUES (?1, 'pending', 0, ?2, ?2)`).bind(u.id, t0).run();
    await reconcile(env, t0 + ABANDONED_ATTEMPT_MS + 1);
    expect(await job(u.id)).toBeNull();
    expect(await count('user', 'id', u.id)).toBe(1);
    expect((await json(u, 'GET', '/v1/sync/pull')).status).toBe(200);
  });

  it('survives repeated R2 failures (retry with backoff by the hourly run) and converges once R2 recovers', async () => {
    const u = await seed('flaky');
    let failures = 3; // 1: the request's own sweep, 2: the cron's ledger check (tolerated), 3: the cron's sweep
    const flaky = new Proxy(env.MEDIA, {
      get(t, p) {
        const v = Reflect.get(t, p) as unknown;
        if (p === 'list' && typeof v === 'function')
          return (...a: unknown[]) => {
            if (failures-- > 0) return Promise.reject(new Error('R2 503'));
            return (v as (...x: unknown[]) => unknown).apply(t, a);
          };
        return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v;
      },
    }) as R2Bucket;
    expect(await (await del(u, { ...env, MEDIA: flaky } as typeof env)).json()).toMatchObject({ storageCleanup: 'pending' });
    expect(await job(u.id)).toMatchObject({ state: 'pending', attempts: 1 });
    // one more failure inside the cron, then success
    await reconcile({ DB: env.DB, MEDIA: flaky });
    expect(await job(u.id)).toMatchObject({ state: 'pending' });
    await reconcile({ DB: env.DB, MEDIA: flaky });
    expect(await keys(`${u.id}/`)).toEqual([]);
    expect(await job(u.id)).toMatchObject({ state: 'swept' });
  });

  it('a sweep killed half way (first batch deleted, second fails) is finished by the next run', async () => {
    const id = `half${uuid().replace(/-/g, '').slice(0, 20)}`;
    for (let i = 0; i < 1002; i += 100) await Promise.all(Array.from({ length: Math.min(100, 1002 - i) }, (_, j) => env.MEDIA.put(`${id}/b/${i + j}.bin`, new Uint8Array([1]))));
    let deletes = 0;
    const dying = new Proxy(env.MEDIA, {
      get(t, p) {
        const v = Reflect.get(t, p) as unknown;
        if (p === 'delete' && typeof v === 'function')
          return (...a: unknown[]) => (++deletes === 2 ? Promise.reject(new Error('killed')) : (v as (...x: unknown[]) => unknown).apply(t, a));
        return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v;
      },
    }) as R2Bucket;
    await expect(sweepUserObjects(dying, id)).rejects.toThrow('killed');
    const left = (await keys(`${id}/`)).length;
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(1002);
    expect(await sweepUserObjects(env.MEDIA, id)).toBe(left);
    expect(await keys(`${id}/`)).toEqual([]);
  }, 120_000);
});
