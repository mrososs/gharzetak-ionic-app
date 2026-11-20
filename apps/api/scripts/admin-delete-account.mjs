// OPERATOR tool for manual account-deletion requests that arrive by e-mail (docs/legal-launch/09-DELETION-REQUEST-RUNBOOK.md, in the
// showcase repository). It is NOT a web endpoint and cannot be called by anyone but the person who holds the Cloudflare login on
// this machine. Nothing is deleted unless ALL of --execute, --confirm-id and --verified are given.
//
//   node scripts/admin-delete-account.mjs challenge
//       prints a fresh one-time verification code to send to the REGISTERED e-mail address (the code is not stored anywhere)
//   node scripts/admin-delete-account.mjs --db <d1-name> [--env staging] (--local | --remote) --email <registered address> --ticket <id>
//       DRY RUN: looks the account up and prints what a deletion would remove. Never prints anything to paste to the requester.
//   ... same + --execute --confirm-id <first 8 characters of the id printed by the dry run> --verified challenge|recovery-review
//       deletes (journal -> tokens -> user row with cascade -> counters), re-checks, appends one line to ops/deletion-audit.log
//       (ticket, time, account id, method, result: no e-mail address, no name). The hourly cron then sweeps the stored files,
//       writes the restore-proof deletion record and removes the journal row.
import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAdminDeleteStatements, lookupSql, SAFE_EMAIL } from './lib/admin-delete-sql.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const die = (msg, code = 1) => {
  console.error(msg);
  process.exit(code);
};

if (argv[0] === 'challenge') {
  // Unambiguous alphabet (no 0/O/1/I/L). 10 characters = about 50 bits: plenty for a one-time code that expires with the request.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const code = Array.from({ length: 10 }, () => alphabet[randomInt(alphabet.length)]).join('');
  console.log(`Verification code: ${code.slice(0, 5)}-${code.slice(5)}`);
  console.log('Send it ONLY to the registered e-mail address of the account (never to the From address of the request).');
  console.log('Ask the requester to reply with it from the registered mailbox. Treat it as expired after 48 hours.');
  process.exit(0);
}

const db = opt('db');
const email = (opt('email') ?? '').trim().toLowerCase();
const ticket = opt('ticket');
const remote = flag('remote');
if (!db || !email || !ticket) die('usage: --db <d1 name> [--env <name>] (--local|--remote) --email <registered address> --ticket <id> [--execute --confirm-id <8 chars> --verified challenge|recovery-review]');
if (flag('local') === remote) die('choose exactly one of --local or --remote');
if (!SAFE_EMAIL.test(email)) die('the e-mail address does not look valid');
if (!/^[A-Za-z0-9._-]{1,40}$/.test(ticket)) die('--ticket must be a short id (letters, digits, . _ -)');

const wrangler = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const base = ['d1', 'execute', db, remote ? '--remote' : '--local', ...(opt('env') ? ['--env', opt('env')] : [])];
const run = (extra) => execFileSync(process.execPath, [wrangler, ...base, ...extra], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const rows = (json) => JSON.parse(json).flatMap((r) => r.results ?? []);

const found = rows(run(['--json', '--command', lookupSql(email)]));
if (found.length === 0) die('NO ACCOUNT with that registered address (do NOT tell the requester: reply with the generic message only).', 3);
if (found.length > 1) die('more than one account matches: stop and investigate manually.', 4);
const u = found[0];
console.log(`Account found: id ${u.id}`);
console.log(`  created ${new Date(u.created_at).toISOString()} · projects ${u.projects} · patterns ${u.patterns} · stored files ${u.files} · sign-in methods ${u.sign_in_methods}`);
console.log('  (operator information only: never send this to the requester)');

if (!flag('execute')) {
  console.log(`\nDRY RUN: nothing was changed. To delete after the verification code came back from the registered address:`);
  console.log(`  re-run with: --execute --confirm-id ${String(u.id).slice(0, 8)} --verified challenge   (or --verified recovery-review for the exceptional process)`);
  process.exit(0);
}
if (opt('confirm-id') !== String(u.id).slice(0, 8)) die('--confirm-id does not match the first 8 characters of the account id: nothing deleted.');
const verified = opt('verified');
if (!['challenge', 'recovery-review'].includes(verified ?? '')) die('--verified must be "challenge" or "recovery-review": nothing deleted.');

const dir = mkdtempSync(join(tmpdir(), 'gz-del-'));
const file = join(dir, 'delete.sql');
try {
  writeFileSync(file, buildAdminDeleteStatements(u.id, email).join('\n') + '\n');
  run(['--file', file]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
const left = rows(run(['--json', '--command', `SELECT (SELECT COUNT(*) FROM user WHERE id = '${u.id}') AS users, (SELECT COUNT(*) FROM session WHERE user_id = '${u.id}') AS sessions, (SELECT COUNT(*) FROM projects WHERE owner_id = '${u.id}') AS projects, (SELECT COUNT(*) FROM media_objects WHERE user_id = '${u.id}') AS files, (SELECT state FROM account_deletion_job WHERE user_id = '${u.id}') AS job;`]))[0];
const ok = left.users === 0 && left.sessions === 0 && left.projects === 0 && left.files === 0;
mkdirSync(join(root, 'ops'), { recursive: true });
appendFileSync(join(root, 'ops', 'deletion-audit.log'), `${new Date().toISOString()}\tticket=${ticket}\tid=${u.id}\tmethod=${verified}\ttarget=${remote ? 'remote' : 'local'}:${db}\tresult=${ok ? 'deleted' : 'INCOMPLETE'}\n`);
console.log(ok ? `\nDELETED. Database rows are gone (journal state: ${left.job ?? 'none'}). Stored files are swept by the hourly cron; confirm to the requester only after you are satisfied.` : `\nINCOMPLETE: ${JSON.stringify(left)}. Investigate before replying.`);
process.exit(ok ? 0 : 5);
