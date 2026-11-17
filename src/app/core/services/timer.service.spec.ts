import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { PatternCollection } from '../models/models';
import { AppStore } from '../state/app.store';
import { createCollectionProject, createProject, uuid } from '../state/factories';
import { LocalDb } from '../storage/local-db';
import { TimerService } from './timer.service';

const T0 = new Date('2026-11-17T10:00:00Z').getTime();
/** Moves the clock forward AND fires the timer's 1 s tick / 5 s heartbeat intervals along the way. */
const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};

const collection = (): PatternCollection => ({
  id: uuid(), name: 'Bear', description: '', level: 'beginner', terms: 'us', coverLocalUrl: null, rev: 1, suggestedMinutes: 0, sourceText: '', createdAt: 1, updatedAt: 1, deletedAt: null,
  parts: [
    { id: uuid(), name: 'Head', quantity: 1, text: 'R1: 6sc in MR [6]', assemblyNotes: '' },
    { id: uuid(), name: 'Arms', quantity: 2, text: 'R1: 6sc in MR [6]', assemblyNotes: '' },
  ],
});
const base = { category: 'amigurumi' as const, hook: '3.0', yarn: 'cotton' as const, target: 0, coverLocalUrl: null };

describe('TimerService — recorded work time', () => {
  let store: AppStore;
  let timer: TimerService;
  let db: LocalDb;
  const scope = 'user:timer';

  /** `reuseDb` = a restarted process that sees the same on-device database (IndexedDB survives a force-stop). */
  const boot = async (reuseDb = false) => {
    const useDb = reuseDb && db ? db : new LocalDb();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [AppStore, TimerService, { provide: LocalDb, useValue: useDb }, { provide: AuthService, useValue: { scope: signal(scope) } }] });
    db = TestBed.inject(LocalDb);
    store = TestBed.inject(AppStore);
    timer = TestBed.inject(TimerService);
    TestBed.tick();
    await store.whenScopeLoaded(scope);
    TestBed.tick();
  };

  beforeEach(async () => {
    // setTimeout stays real: the store polls with it while a scope loads.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(T0);
    await boot();
  });
  afterEach(() => vi.useRealTimers());

  const sessions = async () => (await db.outbox(scope)).filter((e) => e.kind === 'session');

  it('accumulates across start → pause → resume → stop with no loss and no double counting', async () => {
    const p = createProject({ name: 'Ball', ...base, patternId: null });
    await store.addProject(p);
    await timer.start(p.id);
    await advance(10 * 60_000);
    expect(timer.elapsedFor(p.id, 0)).toBe(600);
    await timer.pause();
    expect(store.project(p.id)!.workedSeconds).toBe(600);
    expect(timer.stateFor(p.id)).toBe('paused');

    await advance(30 * 60_000); // time while paused is NOT recorded
    expect(store.project(p.id)!.workedSeconds).toBe(600);

    await timer.resume();
    await advance(5 * 60_000);
    await timer.stop();
    expect(store.project(p.id)!.workedSeconds).toBe(900);
    expect(timer.stateFor(p.id)).toBe('idle');
    expect((await sessions()).map((s) => (s.payload as { seconds: number }).seconds).sort()).toEqual([300, 600]);
  });

  it('never allows two overlapping segments: starting elsewhere first commits the other project', async () => {
    const a = createProject({ name: 'A', ...base, patternId: null });
    const b = createProject({ name: 'B', ...base, patternId: null });
    await store.addProject(a);
    await store.addProject(b);
    await timer.start(a.id);
    await advance(120_000);
    await Promise.all([timer.start(b.id), timer.start(b.id)]); // a double tap must not create a second segment
    await advance(60_000);
    await timer.stop();
    expect(store.project(a.id)!.workedSeconds).toBe(120);
    expect(store.project(b.id)!.workedSeconds).toBe(60);
    expect(timer.running()).toBeNull();
  });

  it('starting the same target twice is a no-op (no duplicate session)', async () => {
    const p = createProject({ name: 'Ball', ...base, patternId: null });
    await store.addProject(p);
    await timer.start(p.id);
    await advance(30_000);
    await timer.start(p.id);
    await advance(30_000);
    await timer.stop();
    expect(store.project(p.id)!.workedSeconds).toBe(60);
    expect(await sessions()).toHaveLength(1);
  });

  it('a checkpoint (app goes to background) saves progress and keeps timing', async () => {
    const p = createProject({ name: 'Ball', ...base, patternId: null });
    await store.addProject(p);
    await timer.start(p.id);
    await advance(90_000);
    await timer.checkpoint();
    expect(store.project(p.id)!.workedSeconds).toBe(90);
    expect(timer.isRunningOn(p.id)).toBe(true);
    await advance(30_000);
    await timer.stop();
    expect(store.project(p.id)!.workedSeconds).toBe(120);
  });

  it('records time on the active part and switching parts carries the running timer over without a gap or double count', async () => {
    const col = collection();
    const p = createCollectionProject({ name: 'Bear', ...base }, col);
    await store.addProject(p);
    const [head, arm1, arm2] = p.parts!;
    await timer.start(p.id, arm1.id);
    await advance(10 * 60_000);
    await timer.switchInstance(p.id, arm2.id); // switch to Arm 2
    await advance(4 * 60_000);
    await timer.pause();
    await timer.resume(); // resumes on Arm 2
    await advance(60_000);
    await timer.switchInstance(p.id, head.id);
    await advance(2 * 60_000);
    await timer.stop();

    const now = store.project(p.id)!;
    const by = (id: string) => now.parts!.find((i) => i.id === id)!.workedSeconds;
    expect(by(arm1.id)).toBe(600);
    expect(by(arm2.id)).toBe(300);
    expect(by(head.id)).toBe(120);
    expect(now.workedSeconds).toBe(1020); // the project total is the sum of the segments: nothing counted twice
    expect(now.parts!.reduce((a, i) => a + i.workedSeconds, 0)).toBe(now.workedSeconds);
    const recorded = await sessions();
    expect(recorded.map((s) => (s.payload as { partInstanceId: string }).partInstanceId).sort()).toEqual([arm1.id, arm2.id, arm2.id, head.id].sort());
    expect((await db.outbox(scope)).some((e) => e.kind === 'progress' && e.id === p.id)).toBe(true); // the per-part breakdown is queued for sync
  });

  it('keeps recorded time when the estimate is edited (the two are independent)', async () => {
    const p = createProject({ name: 'Ball', ...base, patternId: null, estimatedMinutes: 120 });
    await store.addProject(p);
    await timer.start(p.id);
    await advance(600_000);
    await timer.stop();
    await store.updateProject(p.id, (x) => ({ ...x, estimatedHours: 4.5 }), ['project']);
    const now = store.project(p.id)!;
    expect(now.workedSeconds).toBe(600);
    expect(now.estimatedHours).toBe(4.5);
  });

  it('survives a force-stop: after a crash the next launch credits time up to the last heartbeat and leaves the timer paused', async () => {
    const p = createProject({ name: 'Ball', ...base, patternId: null });
    await store.addProject(p);
    await timer.start(p.id);
    await advance(12_000); // the 5 s heartbeat has persisted the segment (beat ≈ T0 + 10 s)
    // --- the app is killed here: no stop(), no checkpoint ---
    const persisted = (await db.loadDocs(scope)).timer!;
    expect(persisted).toMatchObject({ projectId: p.id, startedAt: T0 });
    expect(persisted.beat).toBeGreaterThan(T0);
    expect(persisted.beat).toBeLessThanOrEqual(T0 + 12_000);
    expect(store.project(p.id)!.workedSeconds).toBe(0); // nothing was committed before the kill

    vi.clearAllTimers(); // the process is gone: no more heartbeats
    vi.setSystemTime(Date.now() + 5 * 60_000); // the phone sat there for 5 minutes while the app was dead
    await boot(true); // a fresh process: new store, new timer, same on-device database
    await new Promise((r) => setTimeout(r, 40)); // let the launch-time recovery finish
    TestBed.tick();
    await new Promise((r) => setTimeout(r, 40));

    const worked = store.project(p.id)!.workedSeconds;
    expect(worked).toBe(Math.floor((persisted.beat - T0) / 1000)); // credited to the heartbeat, NOT the 5 dead minutes
    expect(worked).toBeLessThanOrEqual(12);
    expect(timer.running()).toBeNull();
    expect(timer.stateFor(p.id)).toBe('paused');
    expect(timer.recovered()).toBe(worked);
    expect((await db.loadDocs(scope)).timer).toBeNull(); // recovery runs exactly once
  });

  it('time keeps counting from timestamps while the app is in the background', async () => {
    const p = createProject({ name: 'Ball', ...base, patternId: null });
    await store.addProject(p);
    await timer.start(p.id);
    await advance(45 * 60_000); // WebView timers are throttled, but the clock is not
    expect(timer.elapsedFor(p.id, 0)).toBe(45 * 60);
    await timer.stop();
    expect(store.project(p.id)!.workedSeconds).toBe(45 * 60);
  });
});
