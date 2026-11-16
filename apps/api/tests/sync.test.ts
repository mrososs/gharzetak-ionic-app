import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createProject, json, progressBody, projectBody, signUp, uuid } from './helpers';

const SAMPLE = '00000000-0000-4000-8000-0000000000a1';

type Pull = {
  profile: { revision: number; displayName: string } | null;
  tools: { kind: string; value: string }[];
  patterns: { id: string; revision: number; rounds?: unknown }[];
  projects: { id: string; name: string; revision: number; coverPath: string | null }[];
  progress: { projectId: string; count: number; revision: number }[];
  notes: { projectId: string; body: string }[];
  favorites: string[];
  tutorials: { tutorialId: string; stamps: { seconds: number }[]; revision: number }[];
  interest: string | null;
};
const pull = async (u: Parameters<typeof json>[0]) => (await (await json(u, 'GET', '/v1/sync/pull')).json()) as Pull;

describe('projects + progress (create, resume, optimistic concurrency)', () => {
  it('creates a project and progress, then restores them from a pull (resume / sign back in)', async () => {
    const u = await signUp('resume');
    const id = await createProject(u, { name: 'Resume me' });
    const p = await json(u, 'PUT', `/v1/projects/${id}/progress`, progressBody({ count: 7, round: 3, history: [{ c: 6 }] }));
    expect(p.status).toBe(201);
    expect(await p.json()).toMatchObject({ revision: 1 });

    const state = await pull(u);
    expect(state.projects.map((x) => x.name)).toEqual(['Resume me']);
    expect(state.progress[0]).toMatchObject({ projectId: id, count: 7, revision: 1 });
  });

  it('rejects a stale write with 409 and leaves newer progress intact', async () => {
    const u = await signUp('stale');
    const id = await createProject(u);
    // device A saves 10, device B (which only saw revision 0) tries to save 3
    const a = await json(u, 'PUT', `/v1/projects/${id}/progress`, progressBody({ baseRevision: 0, count: 10 }));
    expect(a.status).toBe(201);
    const a2 = await json(u, 'PUT', `/v1/projects/${id}/progress`, progressBody({ baseRevision: 1, count: 12, clientUpdatedAt: Date.now() + 10 }));
    expect(a2.status).toBe(200);

    const stale = await json(u, 'PUT', `/v1/projects/${id}/progress`, progressBody({ baseRevision: 1, count: 3, clientUpdatedAt: Date.now() - 60_000 }));
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { error: { code: string }; current: { revision: number } };
    expect(body.error.code).toBe('conflict');
    expect(body.current.revision).toBe(2);
    // the 409 tells the stale device where the server's tracker is, so it can compare progress and not just clocks
    expect((body.current as unknown as { state: Record<string, unknown> }).state).toEqual({ mode: 'simple', round: 1, count: 12, patternRoundIndex: 0, actionPtr: 0 });
    expect((await pull(u)).progress[0]?.count).toBe(12); // newer progress survived
  });

  it('serialises concurrent writers: exactly one wins per revision', async () => {
    const u = await signUp('race');
    const id = await createProject(u);
    await json(u, 'PUT', `/v1/projects/${id}/progress`, progressBody({ baseRevision: 0, count: 1 }));
    const results = await Promise.all([5, 6, 7, 8].map((count) => json(u, 'PUT', `/v1/projects/${id}/progress`, progressBody({ baseRevision: 1, count }))));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(3);
    expect((await pull(u)).progress[0]?.revision).toBe(2);
  });

  it('makes retries idempotent: re-sending an applied create answers 409 with the same clientUpdatedAt', async () => {
    const u = await signUp('retry');
    const id = uuid();
    const body = projectBody({ clientUpdatedAt: 1_700_000_000_000 });
    expect((await json(u, 'PUT', `/v1/projects/${id}`, body)).status).toBe(201);
    const again = await json(u, 'PUT', `/v1/projects/${id}`, body);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { current: { clientUpdatedAt: number } }).current.clientUpdatedAt).toBe(1_700_000_000_000);
  });

  it('clamps far-future client clocks so a skewed device cannot win every conflict', async () => {
    const u = await signUp('skew');
    const id = uuid();
    const res = await json(u, 'PUT', `/v1/projects/${id}`, projectBody({ clientUpdatedAt: Date.now() + 10 * 365 * 86_400_000 }));
    const { clientUpdatedAt } = (await res.json()) as { clientUpdatedAt: number };
    expect(clientUpdatedAt).toBeLessThanOrEqual(Date.now() + 5 * 60_000 + 1000);
  });

  it('enforces the same invariants as the Postgres CHECK constraints', async () => {
    const u = await signUp('checks');
    const id = await createProject(u);
    expect((await json(u, 'PUT', `/v1/projects/${id}/progress`, progressBody({ count: 31, target: 30 }))).status).toBe(400);
    expect((await json(u, 'PUT', `/v1/projects/${id}/progress`, progressBody({ target: 5000 }))).status).toBe(400);
    expect((await json(u, 'PUT', `/v1/projects/${uuid()}`, projectBody({ category: 'weapons' }))).status).toBe(400);
    expect((await json(u, 'PUT', `/v1/projects/${uuid()}`, projectBody({ name: '' }))).status).toBe(400);
    expect((await json(u, 'PUT', `/v1/projects/not-a-uuid`, projectBody())).status).toBe(400);
    const bad = (await (await json(u, 'PUT', `/v1/projects/${uuid()}`, projectBody({ yarnType: 'steel' }))).json()) as { error: { code: string; details: unknown[] } };
    expect(bad.error.code).toBe('validation_error');
    expect(bad.error.details.length).toBeGreaterThan(0);
  });

  it('notes, work sessions, favourites and store interest', async () => {
    const u = await signUp('misc');
    const id = await createProject(u);
    expect((await json(u, 'PUT', `/v1/projects/${id}/notes`, { baseRevision: 0, clientUpdatedAt: Date.now(), body: 'use 3.5mm hook' })).status).toBe(201);
    expect((await json(u, 'PUT', `/v1/projects/${id}/notes`, { baseRevision: 1, clientUpdatedAt: Date.now(), body: 'use 3.0mm hook' })).status).toBe(200);

    const sid = uuid();
    const s = { projectId: id, startedAt: 1000, endedAt: 4000, seconds: 3 };
    expect((await json(u, 'PUT', `/v1/sessions/${sid}`, s)).status).toBe(201);
    expect((await json(u, 'PUT', `/v1/sessions/${sid}`, s)).status).toBe(200); // idempotent
    expect((await json(u, 'PUT', `/v1/sessions/${uuid()}`, { ...s, endedAt: 10 })).status).toBe(400);

    expect((await json(u, 'PUT', '/v1/favorites/vid-1')).status).toBe(204);
    expect((await json(u, 'PUT', '/v1/favorites/vid-1')).status).toBe(204);
    expect((await json(u, 'PUT', '/v1/favorites/vid-2')).status).toBe(204);
    expect((await json(u, 'DELETE', '/v1/favorites/vid-2')).status).toBe(204);
    expect((await json(u, 'PUT', '/v1/favorites/bad id!')).status).toBe(400);
    expect((await json(u, 'PUT', '/v1/interest', { email: 'not-an-email' })).status).toBe(400);
    expect((await json(u, 'PUT', '/v1/interest', { email: 'me@example.com' })).status).toBe(204);

    const state = await pull(u);
    expect(state.notes[0]?.body).toBe('use 3.0mm hook');
    expect(state.favorites).toEqual(['vid-1']);
    expect(state.interest).toBe('me@example.com');
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM work_sessions WHERE owner_id = ?').bind(u.id).first()).toEqual({ n: 1 });
  });

  it('replaces tools atomically with their own revision', async () => {
    const u = await signUp('tools');
    const t = (baseRevision: number, hooks: string[]) => json(u, 'PUT', '/v1/tools', { baseRevision, clientUpdatedAt: Date.now(), hooks, yarns: ['cotton'], accessories: ['markers'] });
    expect((await t(0, ['3.0', '4.0'])).status).toBe(200);
    expect((await pull(u)).tools).toHaveLength(4);
    expect((await t(1, ['5.0'])).status).toBe(200);
    expect((await pull(u)).tools.filter((x) => x.kind === 'hook').map((x) => x.value)).toEqual(['5.0']);
    expect((await t(1, ['9.0'])).status).toBe(409); // stale
    expect((await pull(u)).tools.filter((x) => x.kind === 'hook').map((x) => x.value)).toEqual(['5.0']);
  });

  it('profile: first write rebases onto the auto-created row', async () => {
    const u = await signUp('prof');
    const body = { baseRevision: 0, clientUpdatedAt: Date.now(), displayName: 'Prof', level: 'advanced', terms: 'uk', locale: 'en', interests: ['gifts'], onboarded: true };
    const first = await json(u, 'PUT', '/v1/profile', body);
    expect(first.status).toBe(409); // sign-up already created revision 1
    expect(((await first.json()) as { current: { revision: number } }).current.revision).toBe(1);
    expect((await json(u, 'PUT', '/v1/profile', { ...body, baseRevision: 1 })).status).toBe(200);
    expect((await pull(u)).profile).toMatchObject({ displayName: 'Prof', revision: 2 });
  });
});

describe('patterns', () => {
  const pat = (over: Record<string, unknown> = {}) => ({
    baseRevision: 0,
    clientUpdatedAt: Date.now(),
    name: 'My hat',
    level: 'beginner',
    terms: 'us',
    sourceType: 'text',
    sourceUrl: null,
    attribution: 'me',
    rawText: 'R1: 6sc in MR [6]\nR2: inc × 6 [12]',
    readingPosition: 0,
    rounds: [
      { n: 1, raw: 'R1: 6sc in MR [6]', ok: true, cons: 0, prod: 6, declared: 6 },
      { n: 2, raw: 'R2: inc × 6 [12]', ok: true, cons: 6, prod: 12, declared: 12 },
    ],
    ...over,
  });

  it('stores rounds, replaces them on update, and soft-deletes', async () => {
    const u = await signUp('pat');
    const id = uuid();
    expect((await json(u, 'PUT', `/v1/patterns/${id}`, pat())).status).toBe(201);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM pattern_rounds WHERE pattern_id = ?').bind(id).first()).toEqual({ n: 2 });
    expect((await json(u, 'PUT', `/v1/patterns/${id}`, pat({ baseRevision: 1, rounds: [{ n: 1, raw: 'R1: 6sc [6]', ok: true, cons: 0, prod: 6, declared: 6 }] }))).status).toBe(200);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM pattern_rounds WHERE pattern_id = ?').bind(id).first()).toEqual({ n: 1 });
    expect((await pull(u)).patterns.map((p) => p.id)).toEqual([id]);

    expect((await json(u, 'DELETE', `/v1/patterns/${id}`)).status).toBe(204);
    expect((await json(u, 'DELETE', `/v1/patterns/${id}`)).status).toBe(204); // idempotent
    expect((await pull(u)).patterns).toHaveLength(0);
    const tomb = await env.DB.prepare('SELECT deleted_at FROM patterns WHERE id = ?').bind(id).first<{ deleted_at: number }>();
    expect(tomb?.deleted_at).toBeGreaterThan(0); // soft deletion keeps the tombstone
  });

  it('keeps built-in samples read-only and linkable', async () => {
    await signUp('seedhost');
    await env.DB.exec(
      `INSERT OR IGNORE INTO patterns (id, owner_id, is_sample, name, level, terms, source_type, raw_text) VALUES ('${SAMPLE}', NULL, 1, 'Sample', 'beginner', 'us', 'sample', 'R1: 6sc in MR [6]')`,
    );
    const u = await signUp('sampler');
    expect((await json(u, 'PUT', `/v1/patterns/${SAMPLE}`, pat())).status).toBe(404); // not writable
    expect((await json(u, 'DELETE', `/v1/patterns/${SAMPLE}`)).status).toBe(204);
    expect(await env.DB.prepare('SELECT deleted_at FROM patterns WHERE id = ?').bind(SAMPLE).first()).toEqual({ deleted_at: null });
    // a project may link a sample pattern
    const id = uuid();
    expect((await json(u, 'PUT', `/v1/projects/${id}`, projectBody({ patternId: SAMPLE }))).status).toBe(201);
  });
});

describe('two-user ownership isolation (replaces Supabase RLS)', () => {
  it('user B cannot read, modify, delete or link anything of user A', async () => {
    const a = await signUp('owner');
    const b = await signUp('intruder');
    const pid = await createProject(a, { name: 'Secret' });
    await json(a, 'PUT', `/v1/projects/${pid}/progress`, progressBody({ count: 9 }));
    await json(a, 'PUT', `/v1/projects/${pid}/notes`, { baseRevision: 0, clientUpdatedAt: Date.now(), body: 'private note' });
    const patId = uuid();
    await json(a, 'PUT', `/v1/patterns/${patId}`, {
      baseRevision: 0, clientUpdatedAt: Date.now(), name: 'A pattern', level: 'beginner', terms: 'us', sourceType: 'text', sourceUrl: null, attribution: null, rawText: 'R1: 6sc [6]', readingPosition: 0, rounds: [],
    });

    // B sees nothing
    const bs = await pull(b);
    expect(bs.projects).toHaveLength(0);
    expect(bs.progress).toHaveLength(0);
    expect(bs.notes).toHaveLength(0);
    expect(bs.patterns).toHaveLength(0);

    // B cannot write into A's project or progress/notes (404, no existence leak)
    expect((await json(b, 'PUT', `/v1/projects/${pid}/progress`, progressBody({ count: 1 }))).status).toBe(404);
    expect((await json(b, 'PUT', `/v1/projects/${pid}/notes`, { baseRevision: 0, clientUpdatedAt: 1, body: 'x' })).status).toBe(404);
    expect((await json(b, 'PUT', `/v1/sessions/${uuid()}`, { projectId: pid, startedAt: 1, endedAt: 2, seconds: 1 })).status).toBe(404);
    // B cannot overwrite A's project by reusing its id (create or update)
    expect((await json(b, 'PUT', `/v1/projects/${pid}`, projectBody({ name: 'hijack' }))).status).toBe(404);
    expect((await json(b, 'PUT', `/v1/projects/${pid}`, projectBody({ name: 'hijack', baseRevision: 1 }))).status).toBe(404);
    // B cannot link A's private pattern
    expect((await json(b, 'PUT', `/v1/projects/${uuid()}`, projectBody({ patternId: patId }))).status).toBe(400);
    expect((await json(b, 'PUT', `/v1/patterns/${patId}`, { baseRevision: 1, clientUpdatedAt: 1, name: 'x', level: 'beginner', terms: 'us', sourceType: 'text', sourceUrl: null, attribution: null, rawText: '', readingPosition: 0, rounds: [] })).status).toBe(404);
    // B's deletes are silent no-ops
    expect((await json(b, 'DELETE', `/v1/projects/${pid}`)).status).toBe(204);
    expect((await json(b, 'DELETE', `/v1/patterns/${patId}`)).status).toBe(204);

    // A's data is untouched
    const as = await pull(a);
    expect(as.projects.map((p) => p.name)).toEqual(['Secret']);
    expect(as.progress[0]?.count).toBe(9);
    expect(as.notes[0]?.body).toBe('private note');
    expect(as.patterns).toHaveLength(1);
  });

  it('deleting a project hides it and its children from pull', async () => {
    const a = await signUp('del');
    const pid = await createProject(a);
    await json(a, 'PUT', `/v1/projects/${pid}/progress`, progressBody());
    expect((await json(a, 'DELETE', `/v1/projects/${pid}`)).status).toBe(204);
    const s = await pull(a);
    expect(s.projects).toHaveLength(0);
    expect(s.progress).toHaveLength(0);
    // a stale edit of a deleted project is a conflict flagged as deleted
    const edit = await json(a, 'PUT', `/v1/projects/${pid}`, projectBody({ baseRevision: 1 }));
    expect(edit.status).toBe(409);
    expect(((await edit.json()) as { current: { deleted: boolean } }).current.deleted).toBe(true);
  });
});

describe('tutorial bookmarks', () => {
  it('upserts a bookmark with timestamps under optimistic concurrency', async () => {
    const u = await signUp('tut');
    const body = (baseRevision: number, stamps: { id: string; seconds: number; note: string }[]) => ({
      baseRevision, clientUpdatedAt: Date.now(), youtubeUrl: 'https://www.youtube.com/watch?v=abc', creatorName: 'Chan', projectId: null, notes: 'good', stamps,
    });
    const s1 = [{ id: uuid(), seconds: 90, note: 'magic ring' }, { id: uuid(), seconds: 10, note: 'intro' }];
    expect((await json(u, 'PUT', '/v1/tutorials/tut-1', body(0, s1))).status).toBe(201);
    let t = (await pull(u)).tutorials[0]!;
    expect(t.stamps.map((s) => s.seconds)).toEqual([10, 90]); // ordered
    expect((await json(u, 'PUT', '/v1/tutorials/tut-1', body(1, [{ id: uuid(), seconds: 5, note: 'x' }]))).status).toBe(200);
    t = (await pull(u)).tutorials[0]!;
    expect(t.stamps).toHaveLength(1);
    expect((await json(u, 'PUT', '/v1/tutorials/tut-1', body(1, []))).status).toBe(409);
    // non-YouTube links are refused
    expect((await json(u, 'PUT', '/v1/tutorials/tut-2', { ...body(0, []), youtubeUrl: 'https://evil.example/x' })).status).toBe(400);
  });
});
