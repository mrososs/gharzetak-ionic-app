/**
 * Account deletion: what runs around Better Auth's `deleteUser`, and how a half-finished deletion is finished later.
 *
 * WHAT THE DATABASE DOES BY ITSELF. Every table that belongs to an account has `ON DELETE CASCADE` to `user`
 * (sessions, credentials/provider links, profile, projects and their parts/progress/notes/photos/work sessions,
 * patterns + rounds, collections + parts, pattern revisions, tools, favorites, tutorial bookmarks/timestamps, store interest,
 * media registry, AI consent). Deleting the `user` row therefore removes all of that, including sync tombstones
 * (`deleted_at` rows) and the revision counters, in one D1 operation. D1 enforces foreign keys.
 *
 * WHAT THE DATABASE CANNOT DO (the reason this file exists):
 *   1. R2 objects. R2 is a different system: not in a D1 transaction, not reachable by a foreign key. They are removed here by
 *      listing the account's key prefix `<userId>/` (authoritative, also finds objects that never got a registry row).
 *   2. Tables that carry a user id WITHOUT a foreign key: `verification` (e-mail / reset / delete tokens), `ai_usage_daily`
 *      (per-user counters; the shared '__all__' row is NEVER touched) and `ai_rate` (per-user burst windows).
 *
 * ORDER (chosen so a failure can never leave a half-deleted account that still looks alive, nor silent orphans):
 *   beforeDelete  record the job, purge verification rows. Nothing the user can see is touched yet: a failure here aborts the
 *                 deletion and the account is intact.
 *   Better Auth  deletes the user row (cascade) and all sessions. From this instant every API call fails with 401.
 *   afterDelete  purge the per-user counters and sweep R2. If this fails the job stays `pending`; the HTTP response still
 *                 succeeds (the account IS gone) but states `storageCleanup: "pending"` so the app never claims more than is true.
 *   reconcile    hourly cron (and the next deletion request) retries every pending job, then runs ONE more verification sweep
 *                 for `swept` jobs (an upload that was in flight during the deletion), then removes the job row.
 * Every step is idempotent, so a repeated request, a retry or a crash between steps converges to the same final state.
 */
import type { AppEnv } from '../env';

/** After a clean sweep the job is kept this long, then re-swept once and removed. Catches an upload racing the deletion. */
export const FINAL_SWEEP_DELAY_MS = 10 * 60 * 1000;
/** A job whose user row still exists after this long is an abandoned attempt (the account is intact): the job is dropped. */
export const ABANDONED_ATTEMPT_MS = 60 * 60 * 1000;
/** Transient security rows older than this are purged by the cron (expired tokens, rate-limit counters keyed by IP). */
export const TRANSIENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** R2 `delete()` accepts at most 1000 keys per call. */
const R2_DELETE_BATCH = 1000;
/** A runaway guard for the prefix listing (1000 keys per page). */
const MAX_LIST_PAGES = 1000;

export type StorageCleanup = 'complete' | 'pending';

type Bucket = Pick<R2Bucket, 'list' | 'delete'>;

/** Ids come from Better Auth; assert they are key/SQL-safe before they become an R2 prefix. */
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;
export function assertSafeUserId(id: string): string {
  if (!SAFE_ID.test(id)) throw new Error('unsafe user id');
  return id;
}

/** Records (or re-records) that this account's deletion has started. Idempotent. */
export async function beginDeletion(db: D1Database, userId: string, now = Date.now()): Promise<void> {
  assertSafeUserId(userId);
  await db
    .prepare(
      `INSERT INTO account_deletion_job (user_id, state, attempts, requested_at, updated_at) VALUES (?1, 'pending', 0, ?2, ?2)
       ON CONFLICT(user_id) DO UPDATE SET state = 'pending', updated_at = ?2`,
    )
    .bind(userId, now)
    .run();
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Removes the account's verification rows: sign-up / reset / delete tokens keyed by the e-mail, and any token whose value is the
 * user id. User ids are random 32-char strings, so the `value` match cannot hit another account.
 */
export async function purgeVerification(db: D1Database, userId: string, email: string): Promise<void> {
  assertSafeUserId(userId);
  const mail = email.toLowerCase();
  await db
    .prepare(`DELETE FROM verification WHERE value = ?1 OR identifier = ?2 OR identifier LIKE ?3 ESCAPE '\\' OR value LIKE ?4 ESCAPE '\\'`)
    .bind(userId, mail, `%:${escapeLike(mail)}`, `%${userId}%`)
    .run();
}

/** Per-user AI counters (no foreign key). The account-wide '__all__' row is a shared budget and is never deleted. */
export async function purgeAiCounters(db: D1Database, userId: string): Promise<void> {
  assertSafeUserId(userId);
  await db.batch([
    db.prepare(`DELETE FROM ai_usage_daily WHERE scope = ?1 AND scope <> '__all__'`).bind(userId),
    db.prepare(`DELETE FROM ai_rate WHERE user_id = ?1`).bind(userId),
  ]);
}

/**
 * Deletes every R2 object under `<userId>/` and returns how many were removed. Throws if ANY list or delete call fails, so a
 * caller can never mistake a partial sweep for a complete one. The prefix listing is repeated until a page comes back empty
 * (deleting while paging would otherwise skip keys).
 */
export async function sweepUserObjects(bucket: Bucket, userId: string): Promise<number> {
  assertSafeUserId(userId);
  const prefix = `${userId}/`;
  let removed = 0;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const listing = await bucket.list({ prefix, limit: R2_DELETE_BATCH });
    const keys = listing.objects.map((o) => o.key).filter((k) => k.startsWith(prefix));
    if (keys.length === 0) {
      if (listing.truncated) continue; // R2 may return fewer than `limit` while more remain: ask again
      return removed;
    }
    for (let i = 0; i < keys.length; i += R2_DELETE_BATCH) await bucket.delete(keys.slice(i, i + R2_DELETE_BATCH));
    removed += keys.length;
  }
  throw new Error('r2 sweep did not converge');
}

/**
 * Everything that happens after the user row is gone. Never throws: on any failure the job stays `pending` with an error class,
 * and `reconcile` retries it. Returns what can truthfully be reported to the caller.
 */
export async function finishDeletion(env: Pick<AppEnv, 'DB' | 'MEDIA'>, userId: string, now = Date.now()): Promise<StorageCleanup> {
  try {
    await purgeAiCounters(env.DB, userId);
    await sweepUserObjects(env.MEDIA, userId);
  } catch (e) {
    await markFailed(env.DB, userId, e, now);
    return 'pending';
  }
  await env.DB.prepare(`UPDATE account_deletion_job SET state = 'swept', last_error = NULL, updated_at = ?2 WHERE user_id = ?1`)
    .bind(userId, now)
    .run()
    .catch(() => undefined);
  return 'complete';
}

async function markFailed(db: D1Database, userId: string, e: unknown, now: number): Promise<void> {
  // An error CLASS only: never a key, a message from user data or a stack.
  const msg = e instanceof Error ? e.message : '';
  const cls = /unsafe/.test(msg) ? 'unsafe_id' : /converge/.test(msg) ? 'r2_no_converge' : 'storage_error';
  await db
    .prepare(`UPDATE account_deletion_job SET attempts = attempts + 1, last_error = ?2, updated_at = ?3 WHERE user_id = ?1`)
    .bind(userId, cls, now)
    .run()
    .catch(() => undefined);
}

/** `complete` once the sweep is clean (job `swept` or already removed); `pending` while the job is still open. */
export async function storageStatus(db: D1Database, userId: string): Promise<StorageCleanup> {
  const row = await db.prepare(`SELECT state FROM account_deletion_job WHERE user_id = ?1`).bind(userId).first<{ state: string }>();
  return row && row.state === 'pending' ? 'pending' : 'complete';
}

export interface ReconcileReport {
  readonly retried: number;
  readonly completed: number;
  readonly stillPending: number;
  readonly abandoned: number;
  readonly transientPurged: number;
}

/** Retries pending jobs, verifies swept jobs once more, drops abandoned attempts, and purges stale transient security rows. */
export async function reconcile(env: Pick<AppEnv, 'DB' | 'MEDIA'>, now = Date.now()): Promise<ReconcileReport> {
  const db = env.DB;
  const jobs = await db
    .prepare(`SELECT user_id, state, updated_at FROM account_deletion_job ORDER BY requested_at LIMIT 200`)
    .all<{ user_id: string; state: string; updated_at: number }>();
  let retried = 0;
  let completed = 0;
  let stillPending = 0;
  let abandoned = 0;
  for (const job of jobs.results) {
    const alive = await db.prepare(`SELECT 1 AS x FROM user WHERE id = ?1`).bind(job.user_id).first();
    if (alive) {
      // The user row still exists: the deletion never reached it. Never sweep a live account. Drop stale attempts.
      if (now - job.updated_at >= ABANDONED_ATTEMPT_MS) {
        await db.prepare(`DELETE FROM account_deletion_job WHERE user_id = ?1`).bind(job.user_id).run();
        abandoned++;
      }
      continue;
    }
    if (job.state === 'swept' && now - job.updated_at < FINAL_SWEEP_DELAY_MS) continue; // too early for the verification sweep
    retried++;
    if ((await finishDeletion(env, job.user_id, now)) === 'complete') {
      if (job.state === 'swept') {
        // Second clean sweep: the deletion is operationally complete. Remove the journal row (no trace of the id remains).
        await db.prepare(`DELETE FROM account_deletion_job WHERE user_id = ?1`).bind(job.user_id).run();
        completed++;
      }
    } else stillPending++;
  }
  return { retried, completed, stillPending, abandoned, transientPurged: await purgeTransient(db, now) };
}

/** Expired verification tokens (they carry e-mail addresses) and IP-keyed rate-limit / burst counters have no reason to stay. */
export async function purgeTransient(db: D1Database, now = Date.now()): Promise<number> {
  const cutoff = now - TRANSIENT_MAX_AGE_MS;
  const res = await db.batch([
    db.prepare(`DELETE FROM verification WHERE expires_at < ?1`).bind(cutoff),
    db.prepare(`DELETE FROM rate_limit WHERE last_request < ?1`).bind(cutoff),
    db.prepare(`DELETE FROM ai_rate WHERE window_start < ?1`).bind(cutoff),
  ]);
  return res.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
}
