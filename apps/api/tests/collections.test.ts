import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createProject, json, progressBody, projectBody, signUp, uuid } from './helpers';

type Part = { id: string; name: string; quantity: number; rawText: string; assemblyNotes: string };
type Pull = {
  collections: { id: string; name: string; revision: number; contentRev: number; coverData: string | null; parts: Part[] }[];
  revisions: { entityKind: string; entityId: string; rev: number; snapshot: { text?: string; parts?: Part[] } }[];
  patterns: { id: string; contentRev: number; suggestedMinutes: number }[];
  projects: { id: string; collectionId: string | null; estimatedHours: number }[];
  progress: { projectId: string; multiState: { instances: { id: string }[]; activeInstanceId: string | null } | null; patternSnapshot: { text: string } | null; revision: number }[];
};
const pull = async (u: Parameters<typeof json>[0]) => (await (await json(u, 'GET', '/v1/sync/pull')).json()) as Pull;

const part = (name: string, quantity = 1, rawText = 'R1: 6sc in MR [6]'): Part => ({ id: uuid(), name, quantity, rawText, assemblyNotes: '' });
const collectionBody = (over: Record<string, unknown> = {}) => ({
  baseRevision: 0,
  clientUpdatedAt: Date.now(),
  name: 'Pink Teddy Bear',
  description: 'A teddy',
  level: 'beginner',
  terms: 'us',
  coverData: null,
  contentRev: 1,
  suggestedMinutes: 480,
  sourceText: '',
  parts: [part('Head'), part('Body'), part('Arms', 2), part('Legs', 2)],
  ...over,
});
const instance = (partId: string, index: number, over: Record<string, unknown> = {}) => ({
  id: uuid(),
  partId,
  index,
  mode: 'pattern',
  simple: { round: 1, target: 30, perTap: 1, count: 0, totalRounds: 0, history: [] },
  cursor: { roundIndex: 0, ptr: 0, mode: 'action', history: [] },
  workedSeconds: 0,
  updatedAt: Date.now(),
  ...over,
});
const multi = (collectionId: string, parts: Part[], over: Record<string, unknown> = {}) => {
  const instances = parts.flatMap((p) => Array.from({ length: p.quantity }, (_, i) => instance(p.id, i + 1)));
  return {
    collectionId,
    collectionRev: 1,
    activeInstanceId: instances[0]!.id,
    snapshots: parts.map((p) => ({ partId: p.id, name: p.name, quantity: p.quantity, text: p.rawText, assemblyNotes: '' })),
    instances,
    ...over,
  };
};

describe('pattern collections', () => {
  it('creates a collection with ordered parts and restores it from a pull', async () => {
    const u = await signUp('coll');
    const id = uuid();
    const body = collectionBody();
    const res = await json(u, 'PUT', `/v1/collections/${id}`, body);
    expect(res.status).toBe(201);
    const state = await pull(u);
    expect(state.collections).toHaveLength(1);
    expect(state.collections[0]).toMatchObject({ id, name: 'Pink Teddy Bear', revision: 1, contentRev: 1 });
    expect(state.collections[0]!.parts.map((p) => [p.name, p.quantity])).toEqual([['Head', 1], ['Body', 1], ['Arms', 2], ['Legs', 2]]);
    expect(state.collections[0]!.parts[2]!.id).toBe(body.parts[2]!.id); // stable part ids survive the round trip
  });

  it('reordering / editing / removing parts replaces them atomically and bumps the revision', async () => {
    const u = await signUp('reorder');
    const id = uuid();
    const parts = [part('Head'), part('Body'), part('Arms', 2)];
    await json(u, 'PUT', `/v1/collections/${id}`, collectionBody({ parts }));
    const next = await json(u, 'PUT', `/v1/collections/${id}`, collectionBody({ baseRevision: 1, contentRev: 2, clientUpdatedAt: Date.now() + 5, parts: [parts[2], { ...parts[0], name: 'Head (round)' }] }));
    expect(next.status).toBe(200);
    expect(await next.json()).toMatchObject({ revision: 2 });
    const c = (await pull(u)).collections[0]!;
    expect(c.contentRev).toBe(2);
    expect(c.parts.map((p) => p.name)).toEqual(['Arms', 'Head (round)']);
    expect(c.parts[0]!.id).toBe(parts[2]!.id);
  });

  it('rejects a stale write with 409 (nothing is overwritten) and answers retries idempotently', async () => {
    const u = await signUp('collconflict');
    const id = uuid();
    const created = collectionBody({ clientUpdatedAt: 1_700_000_000_000 });
    expect((await json(u, 'PUT', `/v1/collections/${id}`, created)).status).toBe(201);
    const retry = await json(u, 'PUT', `/v1/collections/${id}`, created);
    expect(retry.status).toBe(409);
    expect(((await retry.json()) as { current: { clientUpdatedAt: number } }).current.clientUpdatedAt).toBe(1_700_000_000_000); // "already applied"

    await json(u, 'PUT', `/v1/collections/${id}`, collectionBody({ baseRevision: 1, name: 'Device A', clientUpdatedAt: Date.now() }));
    const stale = await json(u, 'PUT', `/v1/collections/${id}`, collectionBody({ baseRevision: 1, name: 'Device B', clientUpdatedAt: Date.now() - 60_000 }));
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { current: { revision: number } }).current.revision).toBe(2);
    expect((await pull(u)).collections[0]!.name).toBe('Device A');
  });

  it("never lets one user read or modify another user's collection", async () => {
    const a = await signUp('owner');
    const b = await signUp('intruder');
    const id = uuid();
    await json(a, 'PUT', `/v1/collections/${id}`, collectionBody());
    expect((await json(b, 'PUT', `/v1/collections/${id}`, collectionBody({ baseRevision: 1, name: 'hijack' }))).status).toBe(404);
    expect((await json(b, 'PUT', `/v1/collections/${id}`, collectionBody())).status).toBe(404);
    expect((await pull(b)).collections).toEqual([]);
    await json(b, 'DELETE', `/v1/collections/${id}`);
    expect((await pull(a)).collections).toHaveLength(1); // the intruder's delete was a no-op
    expect((await json(b, 'PUT', `/v1/revisions/collection/${id}/1`, { name: 'x', createdAt: Date.now(), snapshot: { terms: 'us', parts: [] } })).status).toBe(404);
  });

  it('validates input (no parts overflow, duplicate ids, bad cover)', async () => {
    const u = await signUp('collinvalid');
    const dup = part('Head');
    expect((await json(u, 'PUT', `/v1/collections/${uuid()}`, collectionBody({ parts: [dup, dup] }))).status).toBe(400);
    expect((await json(u, 'PUT', `/v1/collections/${uuid()}`, collectionBody({ parts: Array.from({ length: 31 }, (_, i) => part(`P${i}`)) }))).status).toBe(400);
    expect((await json(u, 'PUT', `/v1/collections/${uuid()}`, collectionBody({ coverData: 'javascript:alert(1)' }))).status).toBe(400);
    expect((await json(u, 'PUT', `/v1/collections/${uuid()}`, collectionBody({ parts: [part('Head', 0)] }))).status).toBe(400);
    expect((await json(u, 'PUT', `/v1/collections/${uuid()}`, collectionBody({ coverData: 'data:image/png;base64,iVBORw0KGgo=' }))).status).toBe(201);
  });

  it('soft-deleting a collection does not break a project created from it', async () => {
    const u = await signUp('colldelete');
    const cid = uuid();
    const parts = [part('Head'), part('Arms', 2)];
    await json(u, 'PUT', `/v1/collections/${cid}`, collectionBody({ parts }));
    const pid = await createProject(u, { collectionId: cid });
    await json(u, 'PUT', `/v1/projects/${pid}/progress`, progressBody({ multiState: multi(cid, parts) }));
    expect((await json(u, 'DELETE', `/v1/collections/${cid}`)).status).toBe(204);
    const state = await pull(u);
    expect(state.collections).toEqual([]);
    expect(state.projects[0]!.collectionId).toBe(cid);
    expect(state.progress[0]!.multiState?.instances).toHaveLength(3); // Head + Arm 1 + Arm 2 still there
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM pattern_parts WHERE collection_id = ?1').bind(cid).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

describe('revision history', () => {
  it('stores immutable snapshots idempotently (first write wins) and returns them on pull', async () => {
    const u = await signUp('revs');
    const pid = uuid();
    await json(u, 'PUT', `/v1/patterns/${pid}`, { baseRevision: 0, clientUpdatedAt: Date.now(), name: 'P', level: 'beginner', terms: 'us', sourceType: 'text', sourceUrl: null, attribution: null, rawText: 'R1: 6sc in MR [6]', readingPosition: 0, rounds: [] });
    const first = await json(u, 'PUT', `/v1/revisions/pattern/${pid}/1`, { name: 'P', createdAt: Date.now(), snapshot: { terms: 'us', text: 'R1: 6sc in MR [6]' } });
    expect(first.status).toBe(201);
    const again = await json(u, 'PUT', `/v1/revisions/pattern/${pid}/1`, { name: 'P', createdAt: Date.now(), snapshot: { terms: 'us', text: 'TAMPERED' } });
    expect(again.status).toBe(200);
    const revs = (await pull(u)).revisions.filter((r) => r.entityId === pid);
    expect(revs).toHaveLength(1);
    expect(revs[0]!.snapshot.text).toBe('R1: 6sc in MR [6]'); // history cannot be rewritten
  });

  it('needs the right snapshot shape and an owned entity', async () => {
    const u = await signUp('revshape');
    const cid = uuid();
    await json(u, 'PUT', `/v1/collections/${cid}`, collectionBody());
    expect((await json(u, 'PUT', `/v1/revisions/collection/${cid}/1`, { name: 'x', createdAt: 1, snapshot: { terms: 'us', text: 'wrong shape' } })).status).toBe(400);
    expect((await json(u, 'PUT', `/v1/revisions/collection/${cid}/1`, { name: 'x', createdAt: 1, snapshot: { terms: 'us', parts: [part('Head')] } })).status).toBe(201);
    expect((await json(u, 'PUT', `/v1/revisions/pattern/${uuid()}/1`, { name: 'x', createdAt: 1, snapshot: { terms: 'us', text: '' } })).status).toBe(404);
    expect((await json(u, 'PUT', `/v1/revisions/nonsense/${cid}/1`, { name: 'x', createdAt: 1, snapshot: { terms: 'us', text: '' } })).status).toBe(400);
    expect((await json(u, 'PUT', `/v1/revisions/collection/${cid}/0`, { name: 'x', createdAt: 1, snapshot: { terms: 'us', parts: [] } })).status).toBe(400);
  });
});

describe('projects from collections: independent progress', () => {
  it("refuses a project that points at someone else's collection", async () => {
    const a = await signUp('colla');
    const b = await signUp('collb');
    const cid = uuid();
    await json(a, 'PUT', `/v1/collections/${cid}`, collectionBody());
    expect((await json(b, 'PUT', `/v1/projects/${uuid()}`, projectBody({ collectionId: cid }))).status).toBe(400);
    const pid = await createProject(b);
    expect((await json(b, 'PUT', `/v1/projects/${pid}/progress`, progressBody({ multiState: multi(cid, [part('Head')]) }))).status).toBe(400);
  });

  it('keeps Arm 1 and Arm 2 as separate instances and two projects from one collection never share state', async () => {
    const u = await signUp('indep');
    const cid = uuid();
    const parts = [part('Arms', 2)];
    await json(u, 'PUT', `/v1/collections/${cid}`, collectionBody({ parts }));
    const p1 = await createProject(u, { collectionId: cid, name: 'Bear #1' });
    const p2 = await createProject(u, { collectionId: cid, name: 'Bear #2' });
    const m1 = multi(cid, parts);
    m1.instances[0] = { ...m1.instances[0], cursor: { roundIndex: 4, ptr: 2, mode: 'action', history: [] } } as never; // Arm 1 advanced
    const m2 = multi(cid, parts);
    await json(u, 'PUT', `/v1/projects/${p1}/progress`, progressBody({ multiState: m1 }));
    await json(u, 'PUT', `/v1/projects/${p2}/progress`, progressBody({ multiState: m2 }));
    const state = await pull(u);
    const s1 = state.progress.find((p) => p.projectId === p1)!.multiState as unknown as { instances: { index: number; cursor: { roundIndex: number } }[] };
    const s2 = state.progress.find((p) => p.projectId === p2)!.multiState as unknown as { instances: { index: number; cursor: { roundIndex: number } }[] };
    expect(s1.instances.map((i) => i.cursor.roundIndex)).toEqual([4, 0]); // Arm 2 untouched by Arm 1
    expect(s2.instances.map((i) => i.cursor.roundIndex)).toEqual([0, 0]); // the second project is untouched by the first
  });

  it('an older client that omits multiState / collectionId never clears them', async () => {
    const u = await signUp('oldclient');
    const cid = uuid();
    const parts = [part('Head')];
    await json(u, 'PUT', `/v1/collections/${cid}`, collectionBody({ parts }));
    const pid = await createProject(u, { collectionId: cid });
    await json(u, 'PUT', `/v1/projects/${pid}/progress`, progressBody({ multiState: multi(cid, parts) }));
    // old client: no collectionId / multiState keys at all
    const proj = await json(u, 'PUT', `/v1/projects/${pid}`, projectBody({ baseRevision: 1, name: 'Renamed by old client', clientUpdatedAt: Date.now() + 10 }));
    expect(proj.status).toBe(200);
    const prog = await json(u, 'PUT', `/v1/projects/${pid}/progress`, progressBody({ baseRevision: 1, count: 3, clientUpdatedAt: Date.now() + 10 }));
    expect(prog.status).toBe(200);
    const state = await pull(u);
    expect(state.projects[0]!.collectionId).toBe(cid);
    expect(state.progress[0]!.multiState?.instances).toHaveLength(1);
  });

  it('a progress conflict reports the multi-part position so the further-along device wins', async () => {
    const u = await signUp('multiconflict');
    const cid = uuid();
    const parts = [part('Arms', 2)];
    await json(u, 'PUT', `/v1/collections/${cid}`, collectionBody({ parts }));
    const pid = await createProject(u);
    const advanced = multi(cid, parts);
    advanced.instances[0] = { ...advanced.instances[0], cursor: { roundIndex: 3, ptr: 1, mode: 'action', history: [] } } as never;
    expect((await json(u, 'PUT', `/v1/projects/${pid}/progress`, progressBody({ multiState: advanced }))).status).toBe(201);
    const stale = await json(u, 'PUT', `/v1/projects/${pid}/progress`, progressBody({ baseRevision: 0, multiState: multi(cid, parts), clientUpdatedAt: Date.now() - 1000 }));
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { current: { state: { multi: number } } };
    expect(body.current.state.multi).toBe(3_000_001);
  });

  it('standalone pattern projects can pin an immutable snapshot, and edits bump contentRev without disturbing old clients', async () => {
    const u = await signUp('pinned');
    const pat = uuid();
    const body = { baseRevision: 0, clientUpdatedAt: Date.now(), name: 'P', level: 'beginner', terms: 'us', sourceType: 'text', sourceUrl: null, attribution: null, rawText: 'R1: 6sc in MR [6]', readingPosition: 0, rounds: [], contentRev: 1, suggestedMinutes: 90 };
    expect((await json(u, 'PUT', `/v1/patterns/${pat}`, body)).status).toBe(201);
    const pid = await createProject(u, { patternId: pat });
    const snap = { rev: 1, name: 'P', text: 'R1: 6sc in MR [6]', terms: 'us' };
    await json(u, 'PUT', `/v1/projects/${pid}/progress`, progressBody({ patternId: pat, mode: 'pattern', patternSnapshot: snap }));
    // an older client edits the pattern without the new fields: contentRev / suggestedMinutes are preserved
    const old = { ...body, baseRevision: 1, rawText: 'R1: 6sc in MR [6]\nR2: inc x 6 [12]', clientUpdatedAt: Date.now() + 5 } as Record<string, unknown>;
    delete old['contentRev'];
    delete old['suggestedMinutes'];
    expect((await json(u, 'PUT', `/v1/patterns/${pat}`, old)).status).toBe(200);
    // a new client bumps contentRev
    expect((await json(u, 'PUT', `/v1/patterns/${pat}`, { ...body, baseRevision: 2, contentRev: 2, rawText: 'R1: 6sc in MR [6]\nR2: inc x 6 [12]', clientUpdatedAt: Date.now() + 9 })).status).toBe(200);
    const state = await pull(u);
    expect(state.patterns[0]).toMatchObject({ contentRev: 2, suggestedMinutes: 90 });
    expect(state.progress[0]!.patternSnapshot?.text).toBe('R1: 6sc in MR [6]');
  });

  it('records which part instance a work session belonged to (project total stays the single source of truth)', async () => {
    const u = await signUp('sess');
    const pid = await createProject(u);
    const sid = uuid();
    const inst = uuid();
    expect((await json(u, 'PUT', `/v1/sessions/${sid}`, { projectId: pid, startedAt: 1000, endedAt: 61_000, seconds: 60, partInstanceId: inst })).status).toBe(201);
    expect((await json(u, 'PUT', `/v1/sessions/${sid}`, { projectId: pid, startedAt: 1000, endedAt: 61_000, seconds: 60, partInstanceId: inst })).status).toBe(200); // idempotent
    const row = await env.DB.prepare('SELECT COUNT(*) AS n, part_instance_id AS p FROM work_sessions WHERE id = ?1').bind(sid).first<{ n: number; p: string }>();
    expect(row).toEqual({ n: 1, p: inst });
    // an old client without partInstanceId still works
    expect((await json(u, 'PUT', `/v1/sessions/${uuid()}`, { projectId: pid, startedAt: 1, endedAt: 2, seconds: 1 })).status).toBe(201);
  });

  it('keeps the optional estimate (estimatedHours) exactly as sent, including 0 = none', async () => {
    const u = await signUp('estimate');
    const pid = await createProject(u, { estimatedHours: 4.5 });
    expect((await pull(u)).projects[0]!.estimatedHours).toBe(4.5);
    expect((await json(u, 'PUT', `/v1/projects/${pid}`, projectBody({ baseRevision: 1, estimatedHours: 0, clientUpdatedAt: Date.now() + 10 }))).status).toBe(200);
    expect((await pull(u)).projects[0]!.estimatedHours).toBe(0);
  });
});

describe('pattern source text (original paste stays recoverable)', () => {
  it('stores sourceText with the pattern, and an older client that omits it never clears it', async () => {
    const u = await signUp('srctext');
    const pid = uuid();
    const body = { baseRevision: 0, clientUpdatedAt: Date.now(), name: 'P', level: 'beginner', terms: 'us', sourceType: 'text', sourceUrl: null, attribution: null, rawText: 'R1: 6sc in MR [6]', readingPosition: 0, rounds: [], sourceText: 'الدور الأول: ٦ سنجل في حلقة سحرية' };
    expect((await json(u, 'PUT', `/v1/patterns/${pid}`, body)).status).toBe(201);
    const old = { ...body, baseRevision: 1, clientUpdatedAt: Date.now() + 5, name: 'Renamed' } as Record<string, unknown>;
    delete old['sourceText'];
    expect((await json(u, 'PUT', `/v1/patterns/${pid}`, old)).status).toBe(200);
    const row = await env.DB.prepare('SELECT name, source_text AS s FROM patterns WHERE id = ?1').bind(pid).first<{ name: string; s: string }>();
    expect(row).toEqual({ name: 'Renamed', s: 'الدور الأول: ٦ سنجل في حلقة سحرية' });
  });
});
