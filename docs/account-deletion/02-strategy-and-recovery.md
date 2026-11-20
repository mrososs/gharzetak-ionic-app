# Account deletion — strategy, contract, failure handling

## 1. Decision: Better Auth `deleteUser`, plus a cleanup workflow around it

Better Auth 1.7.25 `deleteUser` alone is **not** enough: it deletes the user, accounts and sessions (the D1 cascade then handles the domain tables) but knows nothing about
R2 or about tables that carry a user id without a foreign key. So `user.deleteUser.enabled = true` is configured with two hooks (`apps/api/src/auth.ts`) and the workflow
lives in `apps/api/src/services/account-deletion.ts`.

* **Authority.** Credential accounts send the **password** (verified by Better Auth against the stored hash). Accounts without a password rely on a **fresh session**
  (`session.createdAt` younger than `freshAge`, 1 day); an older session gets `400 SESSION_EXPIRED` and the app makes the person pick their Google account again
  (native picker → new session of the **same** account; a different Google account is refused and its stray session discarded).
* **No e-mail token flow.** `sendDeleteAccountVerification` is deliberately **not** set (no mail provider exists). A made-up token deletes nothing (tested).
* **No unauthenticated delete.** The endpoint requires a valid bearer session; the target is always the caller (a body naming another id is ignored — tested).
* **Rate limit.** `/delete-user`: 5 / minute / IP (Better Auth's DB-backed limiter, enabled on staging/production).

## 2. API contract

`POST /api/auth/delete-user` — `Authorization: Bearer <session>` — body `{ "password": "…" }` or `{}`.

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ success: true, message: "User deleted", storageCleanup: "complete" \| "pending" }` | Account and every D1 row deleted, all sessions revoked. `complete` = every stored file confirmed removed; `pending` = file sweep queued (§4). |
| 400 `INVALID_PASSWORD` | Better Auth error | Wrong password. Nothing deleted. |
| 400 `SESSION_EXPIRED` | Better Auth error | No password and the session is not fresh. Nothing deleted. |
| 401 | — | No/invalid/revoked session (also what a **repeat** after success returns). |
| 429 | — | Rate limit. |
| 503 | `Account deletion could not start. Nothing was deleted…` | `beforeDelete` could not journal the attempt. Account intact. |

The client treats `success !== true` as failure and only an explicit `"complete"` as complete.

## 3. Order of operations (why it is safe)

1. **`beforeDelete`** — write the journal row (`account_deletion_job`, state `pending`), purge `verification` rows. Nothing the person can see is touched; **any failure aborts** with 503.
2. **Better Auth** — deletes sessions, accounts, then the `user` row; D1 cascades every owned row. From this instant the account does not exist and every token is 401.
3. **`afterDelete` → `finishDeletion`** — purge `ai_usage_daily` / `ai_rate` rows of the user, sweep R2 `<userId>/`. **Never throws**: on failure the job stays `pending` with an error *class*.
4. **Wrapper** (`index.ts`) — reads the job state and answers `storageCleanup`.

D1 and R2 are **not** one transaction and this design does not pretend they are: the D1 side is atomic by foreign-key cascade; the R2 side is made *eventually complete* by the
journal + reconciliation. R2 deletion happens **after** the user row so a failed deletion never leaves an account that is alive but missing files.

## 4. Idempotency, retries, reconciliation

| Failure | Result | Recovery |
|---|---|---|
| Wrong password / stale session / unauthenticated | nothing changes | person retries |
| Journal write fails (D1 down at the start) | 503, account intact (tested) | person retries |
| Crash/timeout between the D1 delete and the sweep | account gone; journal `pending` | cron / next run sweeps |
| R2 list/delete fails | account gone; response `pending` (tested); files remain (private bucket, unreachable: every read is authorised against the registry row that no longer exists) | hourly cron `reconcile()` retries; each failure increments `attempts` |
| Repeated request after success | 401, no effect (tested) | — |
| Upload in flight during the deletion (R2 put after the sweep; the D1 insert then fails on the FK) | stray object under `<userId>/` | journal state `swept` is kept ≥ 10 min; the cron re-sweeps once, then removes the journal row (tested) |
| Journal row whose user **still exists** (abandoned attempt) | never swept (tested) | dropped after 1 h |
| Concurrent sync write | FK rejects any row for a deleted owner (tested); no resurrection | — |

`reconcile()` also purges expired `verification` rows (they contain e-mail addresses) and `rate_limit` / `ai_rate` rows older than 24 h
(`rate_limit` keys contain client IPs; they cannot be linked to a user, so they are expired by age, not by account).

Cron: `triggers.crons = ["17 * * * *"]` on **staging** (`wrangler.jsonc`). **Takes effect only on an approved deploy.** Production has no environment in the config yet — add the same trigger
when it is created. Without a deployed cron, a `pending` job is only retried by calling `reconcile` (there is intentionally no public endpoint for it).
The journal row holds only: opaque account id, state, attempts, timestamps, error class — no e-mail, name or content — and is deleted after the verification sweep.

Inspect: `wrangler d1 execute <db> --remote --command "select state, attempts, last_error, requested_at from account_deletion_job"` (read-only, needs approval for remote).

## 5. Client flow (`AccountDeletionService`)

Remote first. While the request runs: `auth.deleting` pauses sync, every control is disabled, a second call returns `busy`. On **any** failure nothing local is touched and sync resumes.
Only after `success: true`: `timer.stop()`, `clearScope('user:<id>')`, remove the per-account flag, `auth.finishAccountDeletion()` (clears session + biometric copy, back to signed-out),
then clear the scope **again** (a debounced write queued before the session ended cannot resurrect a row). The guest scope is never touched. A local-wipe failure is reported honestly
(`localCleanup: 'failed'`) while the remote result stands.

Honest ambiguity: a lost connection (`offline`) or a 401 (`sessionEnded`) can mean the server answered after the client gave up. The messages say so and tell the person how to check
(sign in: wrong password ⇒ the account is gone). They never claim either outcome.

## 6. Backups, retention, tombstones (facts and gaps)

| Topic | Verified | Not verified / owner decision |
|---|---|---|
| Live deletion | all rows + files removed as in 01, tested | — |
| **D1 Time Travel** | Always on, not separately charged; restore to any minute within **30 days (Paid) / 7 days (Free)**; whole-database restore only; the page documents no per-row/user purge (Cloudflare docs, `dateModified 2026-11-06`) | Which plan the account is on; whether a restore from history would re-introduce a deleted account (it would, by design of a whole-database restore) → **a restore procedure must re-run deletions for accounts deleted after the restore point.** Journal rows cannot do this (they are removed) — a minimal "deleted-accounts ledger" would be a design change and needs a decision. |
| **Legacy D1 backups** | Alpha-database feature, 24 h, page says removal date 2025-07-01 — not applicable to a "production" database | confirm the database is not alpha |
| **R2** | Objects encrypted at rest (AES-256); deleting an object removes it; the Workers API deletes ≤ 1000 keys/call, strongly consistent | Cloudflare documents no versioning for this bucket (none configured here) and no post-delete retention; a statement about physical erasure from provider storage would be invented → not made |
| **Workers Logs** | `observability.enabled = true`; retention 3 d (Free) / 7 d (Paid) in the pricing table, "7 days maximum" in the limits table (inconsistent upstream) | The docs do not list headers/query strings or redaction. Auth requests carry the bearer token in a header and the e-mail in the body of sign-in calls; AI logs are content-free (`services/ai/log.ts`). Disclosed as "short-lived technical logs up to 7 days". Consider `observability.logs.invocation_logs=false` (decision, not done here). |
| Sync tombstones | live tombstones are rows owned by the user → removed with the account. A tombstone of a **non-deleted** user is retained on purpose (other devices need it to learn about deletes) | no purge age exists in code today — unchanged, out of scope |
| Audit / security logs | no application audit table exists | — |
| AI usage | per-user counters deleted; shared `'__all__'` totals kept (aggregate) | — |

**Three different statements, never to be merged in copy:** (a) *live deletion* — immediate; (b) *backup/log expiry* — automatic, provider-controlled, bounded by the figures above;
(c) *operational completion* — the journal row is gone (`storageCleanup: complete` + verification sweep clean). Row deletion alone is **not** complete deletion: R2 and the no-FK tables are the proof.

## 7. Known gaps (not hidden)

* Other devices keep their local copy until the person erases it there (unreachable remotely). Documented in the UI.
* Time-Travel restore semantics above (needs a decision before production).
* No production environment exists in `wrangler.jsonc`; the cron is staging-only until one is added.
* A Google-only account with an old session on a build **without** Google (web) cannot re-authenticate and is told to sign out/in first.
* Biometric protection of the session is removed if Google re-authentication replaces the session (existing `SessionStore.save` behaviour); the account is deleted right afterwards anyway.
