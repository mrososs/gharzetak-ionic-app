import { provideHttpClient, withFetch } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../src/environments/environment';
import type { PullResponse } from '../src/app/core/api/api.types';
import { AuthService } from '../src/app/core/auth/auth.service';
import { SessionStore } from '../src/app/core/auth/session.store';
import { patternTap } from '../src/app/core/domain/tracker-engine';
import { parsePattern } from '../src/app/core/domain/pattern-parser';
import { NetworkService } from '../src/app/core/services/network.service';
import { TimerService } from '../src/app/core/services/timer.service';
import { AppStore } from '../src/app/core/state/app.store';
import { createCollectionProject, uuid } from '../src/app/core/state/factories';
import { LocalDb } from '../src/app/core/storage/local-db';
import { SyncService } from '../src/app/core/sync/sync.service';
import type { PatternCollection } from '../src/app/core/models/models';

/**
 * Multi-part patterns through the REAL services against a running local Worker:
 * collection + revisions + per-part progress + part time sync, offline work, reconnection, a second device, and conflicts.
 */
const API = environment.apiUrl;
const PASSWORD = 'correct-horse-battery';
let n = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function device() {
  TestBed.resetTestingModule();
  localStorage.clear();
  TestBed.configureTestingModule({ providers: [provideHttpClient(withFetch())] });
  return { auth: TestBed.inject(AuthService), store: TestBed.inject(AppStore), sync: TestBed.inject(SyncService), db: TestBed.inject(LocalDb), net: TestBed.inject(NetworkService), session: TestBed.inject(SessionStore), timer: TestBed.inject(TimerService) };
}
type Device = ReturnType<typeof device>;

async function waitFor(fn: () => boolean | Promise<boolean>, what: string, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    TestBed.tick();
    if (await fn()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}
async function register(d: Device): Promise<string> {
  await d.auth.init();
  const email = `coll-${Date.now()}-${n++}@gharzetak.test`;
  expect(await d.auth.signUp('anna', email, PASSWORD)).toMatchObject({ ok: true });
  const id = d.auth.user()!.id;
  await waitFor(() => d.store.loaded() && d.store.scope() === `user:${id}`, 'store to load the user scope');
  return email;
}
async function signIn(d: Device, email: string) {
  await d.auth.init();
  expect(await d.auth.signIn(email, PASSWORD)).toMatchObject({ ok: true });
  const id = d.auth.user()!.id;
  await waitFor(() => d.store.loaded() && d.store.scope() === `user:${id}`, 'store to load the user scope');
}
async function syncNow(d: Device) {
  await waitFor(async () => (await d.db.outbox(d.store.scope())).length > 0, 'an outbox entry');
  d.sync.schedule(0, true);
  await d.sync.run();
}
const pullServer = async (token: string) => (await (await fetch(`${API}/v1/sync/pull`, { headers: { Authorization: `Bearer ${token}` } })).json()) as PullResponse;

const TEXT = 'R1: 6sc in MR [6]\nR2: inc x 6 [12]\nR3: (sc, inc) x 6 [18]\nR4: (2sc, inc) x 6 [24]';
const collection = (): PatternCollection => ({
  id: uuid(), name: 'Pink Teddy Bear', description: 'A teddy', level: 'beginner', terms: 'us', coverLocalUrl: null, suggestedMinutes: 480, sourceText: 'original paste', rev: 1, createdAt: 1, updatedAt: Date.now(), deletedAt: null,
  parts: [
    { id: uuid(), name: 'Head', quantity: 1, text: TEXT, assemblyNotes: 'stuff firmly' },
    { id: uuid(), name: 'Arms', quantity: 2, text: TEXT, assemblyNotes: '' },
  ],
});
const base = { category: 'amigurumi' as const, hook: '3.0', yarn: 'cotton' as const, target: 0, coverLocalUrl: null };
const tap = (d: Device, projectId: string, instanceId: string, times: number) => {
  const parsed = parsePattern(TEXT);
  return (async () => {
    for (let i = 0; i < times; i++) await d.store.updatePartTracker(projectId, instanceId, (t) => ({ ...t, cursor: patternTap(parsed, t.cursor) }));
  })();
};

beforeEach(() => localStorage.clear());

describe('collections and multi-part progress sync', () => {
  it('syncs a collection, a project from it, per-part progress and per-part time; a second device restores all of it', async () => {
    const d1 = device();
    const email = await register(d1);
    const col = collection();
    await d1.store.addCollection(col);
    const p = createCollectionProject({ name: 'Bear', ...base, estimatedMinutes: 480 }, col);
    await d1.store.addProject(p);
    const [head, arm1, arm2] = p.parts!;
    await tap(d1, p.id, arm1.id, 7);
    await tap(d1, p.id, arm2.id, 2);
    await d1.store.setActiveInstance(p.id, arm2.id);
    await d1.timer.start(p.id, arm1.id);
    await sleep(1300);
    await d1.timer.stop();
    await syncNow(d1);
    expect(await d1.db.outbox(d1.store.scope())).toHaveLength(0);

    const server = await pullServer(d1.session.token()!);
    expect(server.collections?.[0]).toMatchObject({ id: col.id, name: 'Pink Teddy Bear', contentRev: 1 });
    expect(server.collections![0].parts.map((x) => [x.name, x.quantity])).toEqual([['Head', 1], ['Arms', 2]]);
    expect(server.projects[0]).toMatchObject({ id: p.id, collectionId: col.id, estimatedHours: 8 });
    const ms = server.progress[0].multiState!;
    expect(ms.instances).toHaveLength(3);
    expect(ms.activeInstanceId).toBe(arm2.id);

    // another phone: same account, empty database
    const d2 = device();
    await signIn(d2, email);
    d2.sync.schedule(0, true);
    await d2.sync.run();
    await waitFor(() => d2.store.projects().length === 1 && d2.store.collections().length === 1, 'cloud data to appear');
    const got = d2.store.projects()[0];
    expect(got.parts).toHaveLength(3);
    expect(got.activeInstanceId).toBe(arm2.id);
    expect(got.parts!.find((i) => i.id === arm1.id)!.cursor).toEqual(d1.store.project(p.id)!.parts!.find((i) => i.id === arm1.id)!.cursor);
    expect(got.parts!.find((i) => i.id === head.id)!.cursor.roundIndex).toBe(0); // untouched part stayed untouched
    expect(got.workedSeconds).toBeGreaterThanOrEqual(1);
    expect(got.parts!.find((i) => i.id === arm1.id)!.workedSeconds).toBe(got.workedSeconds); // the part breakdown matches the project total
    expect(got.estimatedHours).toBe(8);
    expect(d2.store.collections()[0].parts[0].assemblyNotes).toBe('stuff firmly');
    expect(d2.store.collections()[0].sourceText).toBe('original paste');
  });

  it('keeps working offline (parts, taps, edits) and synchronises safely on reconnect, including a revision', async () => {
    const d = device();
    await register(d);
    const col = collection();
    await d.store.addCollection(col);
    const p = createCollectionProject({ name: 'Bear', ...base }, col);
    await d.store.addProject(p);
    await syncNow(d);
    const token = d.session.token()!;

    d.net.online.set(false);
    await tap(d, p.id, p.parts![1].id, 5);
    await tap(d, p.id, p.parts![2].id, 3);
    await d.store.saveCollectionEdit(col.id, { ...col, parts: [{ ...col.parts[0], text: TEXT.replace('R4: (2sc, inc) x 6 [24]', 'R4: 18sc [18]') }, col.parts[1]] });
    await waitFor(async () => (await d.db.outbox(d.store.scope())).length > 0, 'offline work to be queued');
    await d.sync.run();
    expect(d.sync.state()).toBe('offline');
    const offlineServer = await pullServer(token);
    expect(offlineServer.progress[0].multiState!.instances.every((i) => i.cursor.roundIndex === 0 && i.cursor.ptr === 0)).toBe(true); // nothing leaked
    expect(d.store.project(p.id)!.parts![1].cursor.history.length).toBe(5); // durable locally

    d.net.online.set(true);
    await d.sync.run();
    expect(await d.db.outbox(d.store.scope())).toHaveLength(0);
    const server = await pullServer(token);
    const inst = server.progress[0].multiState!.instances;
    expect(inst.find((i) => i.id === p.parts![1].id)!.cursor.history).toHaveLength(5);
    expect(inst.find((i) => i.id === p.parts![2].id)!.cursor.history).toHaveLength(3);
    expect(server.collections![0].contentRev).toBe(2);
    expect(server.revisions!.some((r) => r.entityKind === 'collection' && r.rev === 1 && r.snapshot!.parts![0].rawText.includes('(2sc, inc) x 6 [24]'))).toBe(true); // the old content is preserved
    // the project's pinned copy is untouched by the later collection edit
    expect(server.progress[0].multiState!.snapshots.find((s) => s.name === 'Head')!.text).toContain('(2sc, inc) x 6 [24]');
  });

  it('two devices working on DIFFERENT pieces both keep their progress (piece-by-piece merge), and the stale copy is kept as a backup', async () => {
    const d = device(); // the app under test
    await register(d);
    const col = collection();
    await d.store.addCollection(col);
    const p = createCollectionProject({ name: 'Bear', ...base }, col);
    await d.store.addProject(p);
    await syncNow(d);
    const token = d.session.token()!;

    // "Another phone" (a second client, which only needs the wire protocol) goes much further on Arm 1 and syncs first.
    const row = (await pullServer(token)).progress[0];
    const other = structuredClone(row.multiState!);
    const arm1Id = p.parts![1].id;
    const arm2Id = p.parts![2].id;
    const a1 = other.instances.find((i) => i.id === arm1Id)!;
    a1.cursor = { roundIndex: 2, ptr: 1, mode: 'action', history: Array.from({ length: 25 }, (_, i) => ({ roundIndex: Math.floor(i / 10), ptr: i % 10 })) };
    a1.updatedAt = Date.now() + 50;
    const put = await fetch(`${API}/v1/projects/${p.id}/progress`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseRevision: row.revision, clientUpdatedAt: Date.now() + 50, mode: row.mode, round: row.round, target: row.target, perTap: row.perTap, count: row.count, totalRounds: row.totalRounds,
        patternId: row.patternId, patternRoundIndex: row.patternRoundIndex, actionPtr: row.actionPtr, countMode: row.countMode, history: [], patternHistory: [], multiState: other, patternSnapshot: null,
      }),
    });
    expect(put.status).toBe(200);

    // Meanwhile this device (still on the old revision) advances a DIFFERENT piece a little and syncs.
    await tap(d, p.id, arm2Id, 2);
    await syncNow(d); // 409 → backup → merge piece by piece → retry
    await d.sync.run();

    const server = await pullServer(token);
    const inst = server.progress[0].multiState!.instances;
    expect(inst.find((i) => i.id === arm1Id)!.cursor.history).toHaveLength(25); // the other phone's Arm 1 survived this phone's stale push
    expect(inst.find((i) => i.id === arm2Id)!.cursor.history).toHaveLength(2); // …and this phone's Arm 2 was kept too
    const local = d.store.project(p.id)!.parts!;
    expect(local.find((i) => i.id === arm1Id)!.cursor.history).toHaveLength(25); // this phone adopted the other phone's piece
    expect(local.find((i) => i.id === arm2Id)!.cursor.history).toHaveLength(2);
    const backups = (await d.db.loadDocs(d.store.scope())).conflicts ?? [];
    expect(backups.some((c) => c.kind === 'progress')).toBe(true); // the stale copy is recoverable, not discarded
  });

  it('a deleted collection does not break the projects built from it, on any device', async () => {
    const d1 = device();
    const email = await register(d1);
    const col = collection();
    await d1.store.addCollection(col);
    const p = createCollectionProject({ name: 'Bear', ...base }, col);
    await d1.store.addProject(p);
    await syncNow(d1);
    await d1.store.deleteCollection(col.id);
    await syncNow(d1);

    const d2 = device();
    await signIn(d2, email);
    d2.sync.schedule(0, true);
    await d2.sync.run();
    await waitFor(() => d2.store.projects().length === 1, 'project to appear');
    expect(d2.store.collections()).toHaveLength(0);
    const view = d2.store.trackerView(d2.store.projects()[0])!;
    expect(view.source?.text).toBe(TEXT);
    expect(d2.store.projects()[0].parts).toHaveLength(3);
  });
});
