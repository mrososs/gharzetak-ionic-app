// SQL for the OPERATOR account deletion (manual e-mail requests). Pure functions, no I/O: used by scripts/admin-delete-account.mjs
// and unit-tested against the real schema (tests/admin-delete.test.ts).
//
// It mirrors services/account-deletion.ts `deleteAccountNow` statement for statement EXCEPT the R2 sweep and the ledger entry, which a
// shell script cannot do (wrangler has no bucket listing). Those are completed by the hourly cron: the first statement journals the
// account as `pending`, and `reconcile()` finishes every pending job whose user row is gone (R2 sweep, deletion ledger, per-user AI counters).

export const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;
/** Deliberately strict: no quotes, backslashes, semicolons or whitespace can ever reach the SQL text. */
export const SAFE_EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * @param {string} userId  the account id found by the lookup (never typed by hand into the SQL)
 * @param {string} email   the account's registered e-mail
 * @param {number} now     epoch ms
 * @returns {string[]} single-line statements, in the order they must run
 */
export function buildAdminDeleteStatements(userId, email, now = Date.now()) {
  if (!SAFE_ID.test(userId)) throw new Error('unsafe user id');
  const mail = email.toLowerCase();
  if (!SAFE_EMAIL.test(mail)) throw new Error('unsafe e-mail');
  const n = Math.trunc(now);
  return [
    // 1. journal first: from here a crash can never lose the cleanup work (the cron finishes it)
    `INSERT INTO account_deletion_job (user_id, state, attempts, requested_at, updated_at) VALUES ('${userId}', 'pending', 0, ${n}, ${n}) ON CONFLICT(user_id) DO UPDATE SET state = 'pending', updated_at = ${n};`,
    // 2. tokens keyed by the e-mail / user id (no foreign key)
    `DELETE FROM verification WHERE value = '${userId}' OR identifier = '${mail}' OR identifier LIKE '%:${likeEscape(mail)}' ESCAPE '\\' OR value LIKE '%${userId}%' ESCAPE '\\';`,
    // 3. the user row: D1 enforces foreign keys, so every owned row (sessions, accounts, projects, patterns, notes, media registry …) cascades
    `DELETE FROM user WHERE id = '${userId}';`,
    // 4. per-user counters without a foreign key (the shared '__all__' row is never touched)
    `DELETE FROM ai_usage_daily WHERE scope = '${userId}' AND scope <> '__all__';`,
    `DELETE FROM ai_rate WHERE user_id = '${userId}';`,
  ];
}

/** One-line lookup used by the script (parameters are validated first). */
export function lookupSql(email) {
  const mail = email.toLowerCase();
  if (!SAFE_EMAIL.test(mail)) throw new Error('unsafe e-mail');
  return `SELECT id, email, created_at, (SELECT COUNT(*) FROM projects p WHERE p.owner_id = u.id) AS projects, (SELECT COUNT(*) FROM patterns pa WHERE pa.owner_id = u.id AND pa.deleted_at IS NULL) AS patterns, (SELECT COUNT(*) FROM media_objects m WHERE m.user_id = u.id) AS files, (SELECT COUNT(*) FROM account a WHERE a.user_id = u.id) AS sign_in_methods FROM user u WHERE lower(u.email) = '${mail}' LIMIT 2;`;
}
