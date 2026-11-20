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

/**
 * DELETION LEDGER (survives a database restore). A D1 point-in-time restore rewinds the WHOLE database, including the deletion
 * journal, so a restore to a moment before an account was deleted would bring the account and all its data back. R2 is outside the
 * restore domain, so each confirmed deletion also leaves one tiny object here:
 *     `_ledger/deleted/<userId>`   body {"v":1}  (the upload time is the deletion time)
 * It holds ONLY the opaque random account id: no e-mail, no name, no content. Written only AFTER the user row is confirmed gone, so
 * it can never point at a live account. After a restore, `reapplyDeletions` deletes every restored account whose id is in the ledger.
 * The raw id (not a keyed hash) is stored on purpose: a hash of a random id is exactly as linkable as the id, and a key would make
 * the protection depend on a secret that could be rotated. Entries are purged after LEDGER_RETENTION_MS.
 */
export const LEDGER_PREFIX = '_ledger/deleted/';
/**
 * Why 35 days: the longest database recovery window Cloudflare documents is 30 days (D1 Time Travel, Workers Paid; 7 on Free), so a
 * restore can never reach back further than that; 5 days of margin cover clock skew and a delayed operator reaction. If the owner ever
 * keeps longer-lived database exports, this value must be raised to cover them.
 */
export const LEDGER_RETENTION_MS = 35 * 24 * 60 * 60 * 1000;
/** D1 allows 100 bound parameters per query. */
const LEDGER_QUERY_CHUNK = 80;

export type StorageCleanup = 'complete' | 'pending';

type Bucket = Pick<R2Bucket, 'list' | 'delete' | 'put'>;

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
    db.prepare(`DELETE FROM ai_request_ledger WHERE user_id = ?1`).bind(userId),
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
    // Never finish (and never write the ledger for) an account that still exists: that would sweep a live account's files.
    if (await env.DB.prepare(`SELECT 1 AS x FROM user WHERE id = ?1`).bind(assertSafeUserId(userId)).first()) throw new Error('account still exists');
    await recordDeletion(env.MEDIA, userId); // first: the durable, restore-proof record
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
  const cls = /unsafe/.test(msg) ? 'unsafe_id' : /converge/.test(msg) ? 'r2_no_converge' : /still exists/.test(msg) ? 'account_alive' : 'storage_error';
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

/** Writes the restore-proof ledger entry. Idempotent: an existing entry keeps its original (earlier) deletion time. */
export async function recordDeletion(bucket: Pick<R2Bucket, 'put'>, userId: string): Promise<void> {
  assertSafeUserId(userId);
  await bucket.put(`${LEDGER_PREFIX}${userId}`, '{"v":1}', { onlyIf: { etagDoesNotMatch: '*' } });
}

async function listLedger(bucket: Pick<R2Bucket, 'list'>): Promise<{ id: string; uploaded: number }[]> {
  const out: { id: string; uploaded: number }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const l = await bucket.list({ prefix: LEDGER_PREFIX, limit: 1000, cursor });
    for (const o of l.objects) {
      const id = o.key.slice(LEDGER_PREFIX.length);
      if (SAFE_ID.test(id)) out.push({ id, uploaded: o.uploaded.getTime() });
    }
    if (!l.truncated) return out;
    cursor = l.cursor;
  }
  throw new Error('ledger listing did not converge');
}

/** Removes ledger entries older than the retention window (no restore can reach back that far). Returns how many were removed. */
export async function purgeLedger(bucket: Pick<R2Bucket, 'list' | 'delete'>, now = Date.now()): Promise<number> {
  const expired = (await listLedger(bucket)).filter((e) => e.uploaded < now - LEDGER_RETENTION_MS).map((e) => `${LEDGER_PREFIX}${e.id}`);
  for (let i = 0; i < expired.length; i += R2_DELETE_BATCH) await bucket.delete(expired.slice(i, i + R2_DELETE_BATCH));
  return expired.length;
}

/**
 * The single "delete this account now" path used by restore reconciliation (and mirrored statement-for-statement by the operator
 * script, scripts/lib/admin-delete-sql.mjs): journal first, then the e-mail-keyed tokens, then the user row (the FK cascade removes
 * every owned row), then the same finish step as a user-initiated deletion (ledger, counters, R2 sweep).
 */
export async function deleteAccountNow(env: Pick<AppEnv, 'DB' | 'MEDIA'>, userId: string, email: string, now = Date.now()): Promise<StorageCleanup> {
  await beginDeletion(env.DB, userId, now);
  await purgeVerification(env.DB, userId, email);
  await env.DB.prepare(`DELETE FROM user WHERE id = ?1`).bind(userId).run();
  return finishDeletion(env, userId, now);
}

/**
 * After a database restore: every account whose id is in the ledger was deleted on purpose, so any that reappeared is deleted again
 * (with its files). Cost is proportional to the ledger size (queries are chunked `id IN (...)`), never to the user count.
 * Safe to run at any time and any number of times: with no resurrected account it does nothing.
 */
export async function reapplyDeletions(env: Pick<AppEnv, 'DB' | 'MEDIA'>, now = Date.now()): Promise<{ ledgerEntries: number; resurrected: number }> {
  const ids = (await listLedger(env.MEDIA)).map((e) => e.id);
  let resurrected = 0;
  for (let i = 0; i < ids.length; i += LEDGER_QUERY_CHUNK) {
    const chunk = ids.slice(i, i + LEDGER_QUERY_CHUNK);
    const rows = await env.DB.prepare(`SELECT id, email FROM user WHERE id IN (${chunk.map((_, k) => `?${k + 1}`).join(',')})`)
      .bind(...chunk)
      .all<{ id: string; email: string }>();
    for (const r of rows.results) {
      await deleteAccountNow(env, r.id, r.email, now);
      resurrected++;
    }
  }
  return { ledgerEntries: ids.length, resurrected };
}

export interface ReconcileReport {
  readonly retried: number;
  readonly completed: number;
  readonly stillPending: number;
  readonly abandoned: number;
  readonly transientPurged: number;
  /** Accounts that a database restore brought back and that were deleted again. */
  readonly resurrected: number;
  readonly ledgerPurged: number;
}

/** Retries pending jobs, verifies swept jobs once more, drops abandoned attempts, and purges stale transient security rows. */
export async function reconcile(env: Pick<AppEnv, 'DB' | 'MEDIA'>, now = Date.now()): Promise<ReconcileReport> {
  const db = env.DB;
  // 1. A restore may have resurrected deleted accounts (and wiped the journal): the R2 ledger is the source of truth for that.
  // A ledger/R2 failure must not stop the journal retries below (they will run again next hour).
  const restored = await reapplyDeletions(env, now).catch(() => ({ ledgerEntries: 0, resurrected: 0 }));
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
      // The user row still exists: the deletion never reached it. Never sweep a live account while it is usable.
      if (now - job.updated_at >= ABANDONED_ATTEMPT_MS) {
        // Better Auth deletes sessions and sign-in methods BEFORE the user row and D1 is not transactional, so a crash in between leaves
        // a user row with NO sign-in method at all: nobody can ever use or sign in to it, and the owner already asked for deletion
        // (password / fresh session verified at request time). Finish that deletion. Any account that still has a sign-in method is an
        // intact account whose attempt simply never got that far: drop the work item.
        const usable = await db.prepare(`SELECT 1 AS x FROM account WHERE user_id = ?1 LIMIT 1`).bind(job.user_id).first();
        if (!usable) {
          const u = await db.prepare(`SELECT email FROM user WHERE id = ?1`).bind(job.user_id).first<{ email: string }>();
          await deleteAccountNow(env, job.user_id, u?.email ?? '', now);
          retried++;
        } else {
          await db.prepare(`DELETE FROM account_deletion_job WHERE user_id = ?1`).bind(job.user_id).run();
          abandoned++;
        }
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
  const ledgerPurged = await purgeLedger(env.MEDIA, now).catch(() => 0);
  return { retried, completed, stillPending, abandoned, transientPurged: await purgeTransient(db, now), resurrected: restored.resurrected, ledgerPurged };
}

/** Expired verification tokens (they carry e-mail addresses) and IP-keyed rate-limit / burst counters have no reason to stay. */
export async function purgeTransient(db: D1Database, now = Date.now()): Promise<number> {
  const cutoff = now - TRANSIENT_MAX_AGE_MS;
  const res = await db.batch([
    db.prepare(`DELETE FROM verification WHERE expires_at < ?1`).bind(cutoff),
    db.prepare(`DELETE FROM rate_limit WHERE last_request < ?1`).bind(cutoff),
    db.prepare(`DELETE FROM ai_rate WHERE window_start < ?1`).bind(cutoff),
    // Idempotency keys only matter for retries of the same action (minutes); keep three days, then drop them.
    db.prepare(`DELETE FROM ai_request_ledger WHERE created_at < ?1`).bind(now - 3 * 86_400_000),
  ]);
  return res.reduce((n, r) => n + (r.meta?.changes ?? 0), 0);
}
