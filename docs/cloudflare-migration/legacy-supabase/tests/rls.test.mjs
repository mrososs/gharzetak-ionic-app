// Row Level Security + storage + LWW integration tests against a running Supabase
// (local: `npx supabase start`). Uses ONLY the publishable key, exactly like the app.
// Run: node supabase/tests/rls.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const env = {};
if (existsSync('.env')) for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2]; }
const URL = process.env.GZ_SUPABASE_URL || env.GZ_SUPABASE_URL;
const KEY = process.env.GZ_SUPABASE_PUBLISHABLE_KEY || env.GZ_SUPABASE_PUBLISHABLE_KEY;
if (!URL || !KEY) throw new Error('Set GZ_SUPABASE_URL / GZ_SUPABASE_PUBLISHABLE_KEY (or .env)');
if (!/127\.0\.0\.1|localhost/.test(URL) && !process.env.GZ_ALLOW_REMOTE_TESTS) throw new Error('Refusing to create test users on a non-local project. Set GZ_ALLOW_REMOTE_TESTS=1 to override.');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra); } };
const client = () => createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function user(tag) {
  const c = client();
  const email = `rls-${tag}-${Date.now()}@gharzetak.test`;
  const { data, error } = await c.auth.signUp({ email, password: `T-${randomUUID()}` , options: { data: { display_name: tag } } });
  if (error || !data.session) throw new Error(`signup ${tag}: ${error?.message ?? 'no session (email confirmation on?)'}`);
  return { c, id: data.user.id };
}

const A = await user('a');
const B = await user('b');
const anon = client();
console.log('users created');

// --- profiles (trigger) ---
const pa = await A.c.from('profiles').select('id, display_name').eq('id', A.id).single();
ok('profile auto-created by trigger', pa.data?.display_name === 'a');
const pb = await B.c.from('profiles').select('id').eq('id', A.id);
ok('B cannot read A profile', pb.data?.length === 0);

// --- projects ---
const pid = randomUUID();
const now = new Date().toISOString();
ok('A inserts own project', !(await A.c.from('projects').insert({ id: pid, owner_id: A.id, name: 'A secret', updated_at: now })).error);
ok('A reads own project', (await A.c.from('projects').select('id').eq('id', pid)).data?.length === 1);
ok('B cannot read A project', (await B.c.from('projects').select('id').eq('id', pid)).data?.length === 0);
ok('anon cannot read A project', (await anon.from('projects').select('id').eq('id', pid)).data?.length === 0);
const bUpd = await B.c.from('projects').update({ name: 'hacked' }).eq('id', pid).select();
ok('B cannot update A project', (bUpd.data?.length ?? 0) === 0);
const bDel = await B.c.from('projects').delete().eq('id', pid).select();
ok('B cannot delete A project', (bDel.data?.length ?? 0) === 0);
ok('A project unchanged', (await A.c.from('projects').select('name').eq('id', pid).single()).data?.name === 'A secret');
const spoof = await B.c.from('projects').insert({ id: randomUUID(), owner_id: A.id, name: 'spoof' });
ok('B cannot insert a project owned by A', !!spoof.error);
const steal = await B.c.from('projects').update({ owner_id: B.id }).eq('id', pid).select();
ok('B cannot take over A project', (steal.data?.length ?? 0) === 0);

// --- child rows must belong to the parent owner ---
ok('A writes progress', !(await A.c.from('project_progress').insert({ project_id: pid, owner_id: A.id, target: 30, per_tap: 5, count: 10 })).error);
ok('B cannot read A progress', (await B.c.from('project_progress').select('*').eq('project_id', pid)).data?.length === 0);
const bChild = await B.c.from('project_progress').insert({ project_id: pid, owner_id: B.id });
ok('B cannot attach progress to A project', !!bChild.error);
const bNote = await B.c.from('project_notes').insert({ project_id: pid, owner_id: B.id, body: 'x' });
ok('B cannot attach a note to A project', !!bNote.error);
const tooMuch = await A.c.from('project_progress').update({ count: 99 }).eq('project_id', pid).select();
ok('DB rejects count > target', !!tooMuch.error);

// --- last-write-wins guard ---
const older = new Date(Date.now() - 60_000).toISOString();
await A.c.from('projects').upsert({ id: pid, owner_id: A.id, name: 'stale write', updated_at: older });
ok('older offline write does not overwrite newer row', (await A.c.from('projects').select('name').eq('id', pid).single()).data?.name === 'A secret');
const newer = new Date(Date.now() + 1000).toISOString();
await A.c.from('projects').upsert({ id: pid, owner_id: A.id, name: 'fresh write', updated_at: newer });
ok('newer write is applied', (await A.c.from('projects').select('name').eq('id', pid).single()).data?.name === 'fresh write');

// --- patterns ---
const samples = await anon.from('patterns').select('id').eq('is_sample', true);
ok('anon can read sample patterns', (samples.data?.length ?? 0) >= 2);
const patId = randomUUID();
ok('A creates private pattern', !(await A.c.from('patterns').insert({ id: patId, owner_id: A.id, name: 'mine', raw_text: 'R1: 6sc in MR [6]' })).error);
ok('B cannot read A pattern', (await B.c.from('patterns').select('id').eq('id', patId)).data?.length === 0);
ok('B cannot create a fake sample', !!(await B.c.from('patterns').insert({ owner_id: null, is_sample: true, name: 'fake' })).error);
ok('B cannot edit a sample', ((await B.c.from('patterns').update({ name: 'x' }).eq('id', '00000000-0000-4000-8000-0000000000a1').select()).data?.length ?? 0) === 0);
const linkForeign = await B.c.from('projects').insert({ id: randomUUID(), owner_id: B.id, name: 'b', pattern_id: patId });
ok("B cannot link A's private pattern", !!linkForeign.error);
ok('B can link a sample pattern', !(await B.c.from('projects').insert({ id: randomUUID(), owner_id: B.id, name: 'b2', pattern_id: '00000000-0000-4000-8000-0000000000a1' })).error);

// --- favourites / tutorials ---
ok('A adds favourite', !(await A.c.from('favorites').insert({ user_id: A.id, item_type: 'tutorial', item_id: 'magic-ring' })).error);
ok('B cannot see A favourites', (await B.c.from('favorites').select('*').eq('user_id', A.id)).data?.length === 0);
const badYt = await A.c.from('tutorial_bookmarks').insert({ user_id: A.id, tutorial_id: 't1', youtube_url: 'https://evil.example.com/x' });
ok('non-YouTube bookmark URL rejected', !!badYt.error);

// --- storage ---
const img = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' });
ok('A uploads to own folder', !(await A.c.storage.from('project-photos').upload(`${A.id}/${pid}/p.jpg`, img, { contentType: 'image/jpeg' })).error);
ok('B cannot upload into A folder', !!(await B.c.storage.from('project-photos').upload(`${A.id}/${pid}/evil.jpg`, img, { contentType: 'image/jpeg' })).error);
ok('B cannot download A photo', !!(await B.c.storage.from('project-photos').download(`${A.id}/${pid}/p.jpg`)).error);
ok('anon cannot download A photo', !!(await anon.storage.from('project-photos').download(`${A.id}/${pid}/p.jpg`)).error);
const exe = new Blob(['MZ'], { type: 'application/x-msdownload' });
ok('disallowed MIME type rejected', !!(await A.c.storage.from('project-photos').upload(`${A.id}/${pid}/x.exe`, exe, { contentType: 'application/x-msdownload' })).error);
ok('upload outside <uid>/<id>/ rejected', !!(await A.c.storage.from('project-photos').upload(`${A.id}/flat.jpg`, img, { contentType: 'image/jpeg' })).error);
ok('bucket is private (no public URL access)', (await fetch(A.c.storage.from('project-photos').getPublicUrl(`${A.id}/${pid}/p.jpg`).data.publicUrl)).status >= 400);

// --- cleanup (own data only) ---
await A.c.storage.from('project-photos').remove([`${A.id}/${pid}/p.jpg`]);
await A.c.from('projects').delete().eq('id', pid);
ok('cascade removed progress', (await A.c.from('project_progress').select('*').eq('project_id', pid)).data?.length === 0);

console.log(`\nRLS/storage/LWW: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
