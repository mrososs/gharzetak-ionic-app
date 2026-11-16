import { provideHttpClient, withFetch } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../src/environments/environment';
import { ApiClient } from '../src/app/core/api/api.client';
import type { PullResponse } from '../src/app/core/api/api.types';
import { AuthService } from '../src/app/core/auth/auth.service';
import { SessionStore } from '../src/app/core/auth/session.store';
import { NetworkService } from '../src/app/core/services/network.service';
import { createProject, uuid } from '../src/app/core/state/factories';
import { AppStore } from '../src/app/core/state/app.store';
import { GuestImportService } from '../src/app/core/sync/guest-import.service';
import { SyncService } from '../src/app/core/sync/sync.service';
import { LocalDb } from '../src/app/core/storage/local-db';

const API = environment.apiUrl;
const PASSWORD = 'correct-horse-battery';
let n = 0;
const newEmail = (l: string) => `${l}-${Date.now()}-${n++}@gharzetak.test`;

/** One "device": a fresh Angular injector with an empty IndexedDB-equivalent (in-memory fallback) and empty localStorage. */
function device() {
  TestBed.resetTestingModule();
  localStorage.clear();
  TestBed.configureTestingModule({ providers: [provideHttpClient(withFetch())] });
  return {
    auth: TestBed.inject(AuthService),
    store: TestBed.inject(AppStore),
    sync: TestBed.inject(SyncService),
    db: TestBed.inject(LocalDb),
    net: TestBed.inject(NetworkService),
    importer: TestBed.inject(GuestImportService),
    session: TestBed.inject(SessionStore),
    api: TestBed.inject(ApiClient),
  };
}
type Device = ReturnType<typeof device>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn: () => boolean | Promise<boolean>, what: string, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    TestBed.tick();
    if (await fn()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function register(d: Device, label = 'anna'): Promise<{ email: string; id: string }> {
  await d.auth.init();
  const email = newEmail(label);
  const r = await d.auth.signUp(label, email, PASSWORD);
  expect(r).toMatchObject({ ok: true });
  const id = d.auth.user()!.id;
  await waitFor(() => d.store.loaded() && d.store.scope() === `user:${id}`, 'store to load the user scope');
  return { email, id };
}
async function signIn(d: Device, email: string): Promise<string> {
  await d.auth.init();
  expect(await d.auth.signIn(email, PASSWORD)).toMatchObject({ ok: true });
  const id = d.auth.user()!.id;
  await waitFor(() => d.store.loaded() && d.store.scope() === `user:${id}`, 'store to load the user scope');
  return id;
}
/** Waits for the (not-awaited) outbox write of the last mutation, then flushes + pulls. */
async function syncNow(d: Device, expectPending = true) {
  if (expectPending) await waitFor(async () => (await d.db.outbox(d.store.scope())).length > 0, 'an outbox entry');
  d.sync.schedule(0, true);
  await d.sync.run();
}
const outbox = (d: Device) => d.db.outbox(d.store.scope());

async function serverPull(token: string): Promise<PullResponse> {
  const r = await fetch(`${API}/v1/sync/pull`, { headers: { Authorization: `Bearer ${token}` } });
  expect(r.status).toBe(200);
  return (await r.json()) as PullResponse;
}
async function serverPut(token: string, path: string, body: unknown) {
  return fetch(`${API}${path}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

const newProject = (name = 'Bunny') => createProject({ name, category: 'amigurumi', hook: '3.0', yarn: 'cotton', target: 30, coverLocalUrl: null, patternId: null });
const setCount = (d: Device, id: string, count: number) => d.store.updateTracker(id, (t) => ({ ...t, simple: { ...t.simple, count } }));

beforeEach(() => {
  localStorage.clear();
});

describe('registration, session restore, project create, progress sync', () => {
  it('registers, syncs a project + stitch progress to D1, and restores the session on restart', async () => {
    const d = device();
    const { email, id } = await register(d);
    expect(d.auth.scope()).toBe(`user:${id}`);

    const p = newProject();
    await d.store.addProject(p);
    await setCount(d, p.id, 7);
    await syncNow(d);
    expect(d.sync.state()).toBe('idle');
    expect(await outbox(d)).toHaveLength(0);

    const server = await serverPull(d.session.token()!);
    expect(server.projects.map((x) => x.name)).toEqual(['Bunny']);
    expect(server.progress[0]).toMatchObject({ projectId: p.id, count: 7 });

    // "app restart": same device storage, new AuthService instance -> restores the cached bearer session offline-first
    const token = d.session.token()!;
    const a2 = TestBed.runInInjectionContext(() => new AuthService());
    await a2.init();
    expect(a2.signedIn()).toBe(true);
    expect(a2.user()?.email).toBe(email);
    expect(d.session.token()).toBe(token);
  });

  it('signs out and back in on a NEW device and restores the cloud progress', async () => {
    const d1 = device();
    const { email } = await register(d1);
    const p = newProject('Restore me');
    await d1.store.addProject(p);
    await setCount(d1, p.id, 12);
    await syncNow(d1);

    const d2 = device(); // another phone: empty local database
    await signIn(d2, email);
    d2.sync.schedule(0, true);
    await d2.sync.run();
    await waitFor(() => d2.store.projects().length === 1, 'cloud project to appear');
    const got = d2.store.projects()[0]!;
    expect(got.id).toBe(p.id);
    expect(got.tracker.simple.count).toBe(12);
    expect(await d2.db.loadProjects(d2.store.scope())).toHaveLength(1); // persisted locally too
  });
});

describe('offline counting and reconnection', () => {
  it('queues taps while offline, pushes nothing, then syncs everything on reconnect', async () => {
    const d = device();
    await register(d);
    const p = newProject();
    await d.store.addProject(p);
    await setCount(d, p.id, 1);
    await syncNow(d);
    const token = d.session.token()!;

    d.net.online.set(false);
    for (let c = 2; c <= 6; c++) await setCount(d, p.id, c);
    await waitFor(async () => (await outbox(d)).length > 0, 'offline taps to be queued');
    await d.sync.run();
    expect(d.sync.state()).toBe('offline');
    expect(d.sync.pending()).toBeGreaterThan(0);
    expect((await serverPull(token)).progress[0]?.count).toBe(1); // nothing leaked while offline
    expect((await d.db.loadProjects(d.store.scope()))[0]?.tracker.simple.count).toBe(6); // durable locally

    d.net.online.set(true);
    await d.sync.run();
    expect(await outbox(d)).toHaveLength(0);
    expect((await serverPull(token)).progress[0]?.count).toBe(6);
    expect(d.sync.state()).toBe('idle');
  });

  it('keeps the outbox entry when the server is unreachable (removed only after confirmation)', async () => {
    const d = device();
    await register(d);
    const p = newProject();
    await d.store.addProject(p);
    await syncNow(d);
    await setCount(d, p.id, 4);
    await waitFor(async () => (await outbox(d)).length > 0, 'outbox entry');
    const real = d.api.baseUrl;
    // point the client at a dead port for one attempt
    Object.defineProperty(d.api, 'baseUrl', { value: 'http://127.0.0.1:9', configurable: true });
    await d.sync.run();
    Object.defineProperty(d.api, 'baseUrl', { value: real, configurable: true });
    expect(['offline', 'error']).toContain(d.sync.state());
    expect((await outbox(d)).length).toBeGreaterThan(0);
    d.sync.schedule(0, true);
    await d.sync.run();
    expect(await outbox(d)).toHaveLength(0);
    expect((await serverPull(d.session.token()!)).progress[0]?.count).toBe(4);
  });
});

describe('server-enforced concurrency', () => {
  async function seeded() {
    const d = device();
    await register(d);
    const p = newProject();
    await d.store.addProject(p);
    await setCount(d, p.id, 5);
    await syncNow(d);
    return { d, p, token: d.session.token()! };
  }

  it('a stale device cannot overwrite newer progress from another device; it adopts the newer state', async () => {
    const { d, p, token } = await seeded();
    const before = await serverPull(token);
    const prog = before.progress[0]!;

    // another device saves count 20 LATER (newer clientUpdatedAt, valid base revision)
    const res = await serverPut(token, `/v1/projects/${p.id}/progress`, {
      baseRevision: prog.revision, clientUpdatedAt: Date.now() + 5_000, mode: 'simple', round: 1, target: 30, perTap: 1, count: 20, totalRounds: 0,
      patternId: null, patternRoundIndex: 0, actionPtr: 0, countMode: 'action', history: [], patternHistory: [],
    });
    expect(res.status).toBe(200);

    // this device was offline with an OLDER local edit
    d.net.online.set(false);
    await d.store.updateProject(p.id, (x) => ({ ...x, tracker: { ...x.tracker, simple: { ...x.tracker.simple, count: 8 }, updatedAt: Date.now() - 60_000 } }), ['progress']);
    await waitFor(async () => (await outbox(d)).length > 0, 'stale edit queued');
    d.net.online.set(true);
    d.sync.schedule(0, true);
    await d.sync.run();

    expect((await serverPull(token)).progress[0]?.count).toBe(20); // newer progress survived
    await waitFor(() => d.store.project(p.id)?.tracker.simple.count === 20, 'stale device to adopt server state');
    expect(await outbox(d)).toHaveLength(0);

    // ...and the stale device's own work was NOT silently discarded: it is kept as a backup and the user is told.
    const notice = d.sync.conflictNotice();
    expect(notice).toMatchObject({ kind: 'progress', label: 'Bunny', reason: 'newer-on-server' });
    const backups = (await d.db.loadDocs(d.store.scope())).conflicts ?? [];
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatchObject({ kind: 'progress', entityId: p.id, reason: 'newer-on-server' });
    expect((backups[0]!.snapshot as { count: number }).count).toBe(8); // exactly what this device had counted
  });

  it('a stale device that is FURTHER ALONG keeps its stitches even though its clock is older', async () => {
    const { d, p, token } = await seeded();
    const prog = (await serverPull(token)).progress[0]!;
    // another device wrote count 20 later (newer clock)
    await serverPut(token, `/v1/projects/${p.id}/progress`, {
      baseRevision: prog.revision, clientUpdatedAt: Date.now() + 5_000, mode: 'simple', round: 1, target: 30, perTap: 1, count: 20, totalRounds: 0,
      patternId: null, patternRoundIndex: 0, actionPtr: 0, countMode: 'action', history: [], patternHistory: [],
    });
    // this device counted MORE (25) while offline, but with an older timestamp
    d.net.online.set(false);
    await d.store.updateProject(p.id, (x) => ({ ...x, tracker: { ...x.tracker, simple: { ...x.tracker.simple, count: 25 }, updatedAt: Date.now() - 60_000 } }), ['progress']);
    await waitFor(async () => (await outbox(d)).length > 0, 'offline edit queued');
    d.net.online.set(true);
    d.sync.schedule(0, true);
    await d.sync.run();

    expect((await serverPull(token)).progress[0]?.count).toBe(25); // the further-along position wins: no stitches lost
    expect(d.store.project(p.id)?.tracker.simple.count).toBe(25);
    expect(d.sync.conflictNotice()).toBeNull(); // nothing was discarded, so nothing to report
    expect((await d.db.loadDocs(d.store.scope())).conflicts ?? []).toHaveLength(0);
  });

  it('a genuinely newer local edit rebases onto the server revision and wins', async () => {
    const { d, p, token } = await seeded();
    const prog = (await serverPull(token)).progress[0]!;
    // another device wrote at an OLDER device-time but bumped the revision
    await serverPut(token, `/v1/projects/${p.id}/progress`, {
      baseRevision: prog.revision, clientUpdatedAt: 1_000, mode: 'simple', round: 1, target: 30, perTap: 1, count: 2, totalRounds: 0,
      patternId: null, patternRoundIndex: 0, actionPtr: 0, countMode: 'action', history: [], patternHistory: [],
    });
    await setCount(d, p.id, 9); // newer clientUpdatedAt, but our recorded revision is now stale -> 409 -> rebase -> apply
    await syncNow(d);
    expect((await serverPull(token)).progress[0]?.count).toBe(9);
    expect(await outbox(d)).toHaveLength(0);
  });

  it('retries are idempotent: an already-applied write is recognised and not duplicated', async () => {
    const { d, p, token } = await seeded();
    await setCount(d, p.id, 11);
    await waitFor(async () => (await outbox(d)).length > 0, 'outbox entry');
    const local = d.store.project(p.id)!;
    const cur = (await serverPull(token)).progress[0]!;
    // simulate "request reached the server but the response was lost": apply the exact same write out-of-band
    const applied = await serverPut(token, `/v1/projects/${p.id}/progress`, {
      baseRevision: cur.revision, clientUpdatedAt: local.tracker.updatedAt, mode: 'simple', round: local.tracker.simple.round, target: 30, perTap: 1,
      count: 11, totalRounds: 0, patternId: null, patternRoundIndex: 0, actionPtr: 0, countMode: 'action', history: [], patternHistory: [],
    });
    expect(applied.status).toBe(200);
    const revAfterApply = ((await applied.json()) as { revision: number }).revision;

    d.sync.schedule(0, true);
    await d.sync.run(); // our retry hits 409 with an equal clientUpdatedAt -> treated as applied
    expect(await outbox(d)).toHaveLength(0);
    const after = (await serverPull(token)).progress[0]!;
    expect(after.count).toBe(11);
    expect(after.revision).toBe(revAfterApply); // no extra write happened
  });
});

describe('guest mode and account isolation', () => {
  it('imports guest projects into the account, syncs them, and clears the guest scope', async () => {
    const d = device();
    await d.auth.init();
    d.auth.continueAsGuest();
    await waitFor(() => d.store.loaded() && d.store.scope() === 'guest', 'guest scope');
    const gp = newProject('Guest bunny');
    await d.store.addProject(gp);
    await setCount(d, gp.id, 3);
    expect(await d.db.outbox('guest')).toHaveLength(0); // guest data never queues for the cloud

    await register(d, 'convert');
    expect(await d.importer.refresh()).toBe(1);
    const report = await d.importer.importGuestData();
    expect(report.imported).toBe(1);
    await waitFor(async () => (await outbox(d)).length > 0, 'import to queue');
    d.sync.schedule(0, true);
    await d.sync.run();

    const server = await serverPull(d.session.token()!);
    expect(server.projects.map((x) => x.name)).toContain('Guest bunny');
    expect(server.progress.find((x) => x.projectId === gp.id)?.count).toBe(3);
    expect(await d.db.loadProjects('guest')).toHaveLength(0);
  });

  it('never leaks one account’s local records into another account on the same device', async () => {
    const d = device();
    const a = await register(d, 'alice');
    const p = newProject('Alice only');
    await d.store.addProject(p);
    await syncNow(d);
    await d.auth.signOut();
    await waitFor(() => d.store.scope() === 'guest', 'back to guest scope');

    const b = await register(d, 'bob');
    d.sync.schedule(0, true);
    await d.sync.run();
    expect(d.store.projects()).toHaveLength(0);
    expect(await d.db.loadProjects(`user:${b.id}`)).toHaveLength(0);
    expect((await serverPull(d.session.token()!)).projects).toHaveLength(0);

    // Alice signs back in: her local scope is intact
    await d.auth.signOut();
    await signIn(d, a.email);
    await waitFor(() => d.store.projects().length === 1, 'Alice’s project');
    expect(d.store.projects()[0]!.name).toBe('Alice only');
  });
});

describe('session expiry', () => {
  it('drops the session on 401 but keeps local data for the next sign-in', async () => {
    const d = device();
    const { id } = await register(d);
    const p = newProject('Survives expiry');
    await d.store.addProject(p);
    await syncNow(d);
    const token = d.session.token()!;
    await fetch(`${API}/api/auth/sign-out`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' }); // revoked elsewhere

    await setCount(d, p.id, 2);
    await waitFor(async () => (await outbox(d)).length > 0, 'outbox entry');
    d.sync.schedule(0, true);
    await d.sync.run();
    expect(d.auth.signedIn()).toBe(false);
    expect(d.session.token()).toBeNull();
    expect((await d.db.loadProjects(`user:${id}`))[0]?.name).toBe('Survives expiry'); // nothing erased
    expect((await d.db.outbox(`user:${id}`)).length).toBeGreaterThan(0); // unsent work is kept
  });
});

describe('private media through the API', () => {
  it('uploads a project photo from the outbox and re-downloads it as an authenticated blob URL', async () => {
    const d = device();
    await register(d);
    const p = newProject();
    await d.store.addProject(p);
    await syncNow(d);
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const photoId = uuid();
    await d.store.updateProject(p.id, (x) => ({ ...x, photos: [...x.photos, { id: photoId, localUrl: PNG, storagePath: null, createdAt: Date.now() }] }), []);
    await d.db.enqueue({ scope: d.store.scope(), kind: 'photo', id: photoId, op: 'upsert', payload: { projectId: p.id } });
    d.sync.schedule(0, true);
    await d.sync.run();

    const stored = d.store.project(p.id)!.photos[0]!;
    expect(stored.storagePath).toContain(`/${p.id}/${photoId}`);
    const url = await d.sync.mediaUrl(stored.storagePath!);
    expect(url).toMatch(/^blob:/);
    const blob = (globalThis as unknown as { __blobs: Map<string, Blob> }).__blobs.get(url!)!;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]); // the PNG we uploaded, byte for byte
    expect(await d.sync.mediaUrl(stored.storagePath!)).toBe(url); // cached
    // the raw key is NOT publicly fetchable
    expect((await fetch(`${API}/${stored.storagePath}`)).status).not.toBe(200);
  });
});
