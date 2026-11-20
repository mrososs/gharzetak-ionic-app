import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs module shared with the operator script
import { buildAdminDeleteStatements, lookupSql, SAFE_EMAIL } from '../scripts/lib/admin-delete-sql.mjs';
import { LEDGER_PREFIX, reconcile } from '../src/services/account-deletion';
import { JPEG, bytes, createProject, json, signUp, uuid } from './helpers';

const run = async (statements: string[]) => {
  for (const s of statements) await env.DB.prepare(s).run();
};
const count = async (sql: string, ...a: unknown[]) => (await env.DB.prepare(sql).bind(...a).first<{ n: number }>())!.n;

describe('operator deletion SQL (manual e-mail requests)', () => {
  it('lookup finds exactly the account by its registered address (case-insensitive) and reports sizes', async () => {
    const u = await signUp('lookup');
    await createProject(u);
    const row = await env.DB.prepare(lookupSql(u.email.toUpperCase())).first<{ id: string; projects: number; sign_in_methods: number }>();
    expect(row).toMatchObject({ id: u.id, projects: 1, sign_in_methods: 1 });
    expect(await env.DB.prepare(lookupSql('nobody@example.test')).first()).toBeNull();
  });

  it('deletes rows, tokens and counters, journals the account, and the cron then sweeps the files and writes the restore-proof record', async () => {
    const u = await signUp('operator');
    const other = await signUp('operator-other');
    const pid = await createProject(u);
    expect((await bytes(u, `/v1/media/project-photos/${pid}/${uuid()}`, JPEG, 'image/jpeg')).status).toBe(201);
    await createProject(other);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO verification (id, identifier, value, expires_at) VALUES (?1, ?2, 'x', ?3)`).bind(uuid(), u.email, Date.now() + 1000),
      env.DB.prepare(`INSERT INTO ai_usage_daily (scope, day, chat, requests) VALUES (?1, '2026-11-20', 1, 1)`).bind(u.id),
    ]);

    await run(buildAdminDeleteStatements(u.id, u.email));

    expect(await count('SELECT COUNT(*) AS n FROM user WHERE id = ?1', u.id)).toBe(0);
    for (const [t, c] of [['session', 'user_id'], ['account', 'user_id'], ['projects', 'owner_id'], ['project_photos', 'owner_id'], ['media_objects', 'user_id'], ['profiles', 'user_id']]) expect(await count(`SELECT COUNT(*) AS n FROM ${t} WHERE ${c} = ?1`, u.id), t).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM verification WHERE identifier = ?1', u.email)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM ai_usage_daily WHERE scope = ?1', u.id)).toBe(0);
    expect(await env.DB.prepare('SELECT state FROM account_deletion_job WHERE user_id = ?1').bind(u.id).first()).toMatchObject({ state: 'pending' });
    expect((await json(u, 'GET', '/v1/sync/pull')).status).toBe(401);
    // the other account is untouched
    expect(await count('SELECT COUNT(*) AS n FROM projects WHERE owner_id = ?1', other.id)).toBe(1);

    // files are still there until the cron runs (a shell script cannot list R2) …
    expect((await env.MEDIA.list({ prefix: `${u.id}/` })).objects.length).toBeGreaterThan(0);
    await reconcile(env);
    expect((await env.MEDIA.list({ prefix: `${u.id}/` })).objects).toEqual([]);
    expect(await env.MEDIA.head(`${LEDGER_PREFIX}${u.id}`)).not.toBeNull();
  });

  it('is idempotent (a second run changes nothing and does not error)', async () => {
    const u = await signUp('twice');
    await run(buildAdminDeleteStatements(u.id, u.email));
    await run(buildAdminDeleteStatements(u.id, u.email));
    expect(await count('SELECT COUNT(*) AS n FROM user WHERE id = ?1', u.id)).toBe(0);
  });

  it('refuses anything that could inject SQL', () => {
    for (const bad of ["x'; DROP TABLE user;--", 'short', 'a b c d e f g h', '../../etc/passwd']) expect(() => buildAdminDeleteStatements(bad, 'a@b.test')).toThrow();
    for (const bad of ["a'b@x.test", 'a@b', 'a;b@x.test', 'a@x.test; DROP TABLE user', 'a\\b@x.test']) {
      expect(SAFE_EMAIL.test(bad), bad).toBe(false);
      expect(() => buildAdminDeleteStatements('abcdefgh12345678', bad)).toThrow();
      expect(() => lookupSql(bad)).toThrow();
    }
  });

  it('every statement is a single line (wrangler d1 execute --file runs them one by one)', () => {
    for (const s of buildAdminDeleteStatements('abcdefgh12345678', 'person.name+tag@example.com')) expect(s.includes('\n')).toBe(false);
  });
});
