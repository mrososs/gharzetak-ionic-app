import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { joyKey } from '../domain/joy';
import { parsePattern } from '../domain/pattern-parser';
import { createSimpleCounter, patternSetMode, patternTap, simpleNextRound, simpleReset, simpleTap, simpleUndo, patternUndo } from '../domain/tracker-engine';
import { PatternCollection, PatternPart, Project } from '../models/models';
import { AppStore } from '../state/app.store';
import { createCollectionProject, createProject, uuid } from '../state/factories';
import { LocalDb, Scope } from '../storage/local-db';
import { JoyLedgerService } from './joy-ledger.service';
import { JoyService } from './joy.service';
import { DEFAULT_JOY_PREFS, joyPrefsOf } from './joy.models';

const TEXT = 'R1: 6sc in MR [6]\nR2: inc x 6 [12]\nR3: (sc, inc) x 6 [18]\nR4: (2sc, inc) x 6 [24]\nR5: 24sc [24]';
const parsed = parsePattern(TEXT);
const flush = () => new Promise((r) => setTimeout(r, 8));
const input = (name = 'Bear', target = 3) => ({ name, category: 'amigurumi' as const, hook: '3.0', yarn: 'cotton' as const, target, coverLocalUrl: null, patternId: null as string | null });

describe('Crochet Joy — events, ledger and presentation pipeline', () => {
  let store: AppStore;
  let joy: JoyService;
  let ledger: JoyLedgerService;
  let db: LocalDb;
  const scope = signal<Scope>('user:a');

  /** (Re)creates the whole app graph on the SAME LocalDb: simulates an app restart. */
  async function boot(sameDb?: LocalDb, s: Scope = 'user:a'): Promise<void> {
    TestBed.resetTestingModule();
    scope.set(s);
    TestBed.configureTestingModule({
      providers: [AppStore, JoyService, JoyLedgerService, sameDb ? { provide: LocalDb, useValue: sameDb } : LocalDb, { provide: AuthService, useValue: { scope } }],
    });
    db = TestBed.inject(LocalDb);
    store = TestBed.inject(AppStore);
    ledger = TestBed.inject(JoyLedgerService);
    joy = TestBed.inject(JoyService);
    TestBed.tick();
    await store.whenScopeLoaded(s);
    TestBed.tick();
    await flush();
  }

  beforeEach(async () => {
    await boot();
  });

  const seq = () => joy.batch()?.seq ?? 0;
  const lastKinds = () => joy.batch()?.requests.map((r) => r.event.kind) ?? [];
  const tapSimple = (id: string) => store.updateTracker(id, (t) => ({ ...t, simple: simpleRoundComplete(t) ? simpleNextRound(t.simple) : simpleTap(t.simple) }), { origin: 'tap' });
  const simpleRoundComplete = (t: { simple: { count: number; target: number } }) => t.simple.count >= t.simple.target;

  async function newProject(over: Partial<Project> = {}): Promise<Project> {
    const p = { ...createProject(input()), ...over };
    await store.addProject(p);
    return p;
  }

  it('a real counting tap that completes a round stores ONE ledger row and presents it once', async () => {
    const p = await newProject();
    await tapSimple(p.id);
    await tapSimple(p.id);
    await flush();
    expect(seq()).toBe(0); // mid-round taps never celebrate
    await tapSimple(p.id);
    await flush();
    expect(seq()).toBe(1);
    expect(lastKinds()).toEqual(['round']);
    expect(ledger.has(joyKey({ kind: 'round', projectId: p.id, instanceId: null, round: 1 }))).toBe(true);
    expect(ledger.counts().round).toBe(1);
  });

  it('undo then re-completing the same round does not celebrate or store a second row', async () => {
    const p = await newProject();
    for (let i = 0; i < 3; i++) await tapSimple(p.id);
    await flush();
    expect(seq()).toBe(1);
    await store.updateTracker(p.id, (t) => ({ ...t, simple: simpleUndo(t.simple) }), { origin: 'undo' });
    await tapSimple(p.id);
    await flush();
    expect(seq()).toBe(1);
    expect(ledger.counts().round).toBe(1);
  });

  it('reset then re-completing the same round is silent too', async () => {
    const p = await newProject();
    for (let i = 0; i < 3; i++) await tapSimple(p.id);
    await store.updateTracker(p.id, (t) => ({ ...t, simple: simpleReset(t.simple) }), { origin: 'reset' });
    await flush();
    for (let i = 0; i < 3; i++) await tapSimple(p.id);
    await flush();
    expect(seq()).toBe(1);
  });

  it('survives an app restart: the ledger is persisted, so the same round is never celebrated again', async () => {
    const p = await newProject();
    for (let i = 0; i < 3; i++) await tapSimple(p.id);
    await flush();
    expect(seq()).toBe(1);
    const sameDb = db;
    await boot(sameDb);
    expect(store.projects()).toHaveLength(1);
    expect(seq()).toBe(0); // loading never celebrates
    expect(ledger.counts().round).toBe(1);
    // undo + redo after the restart: key already present
    await store.updateTracker(p.id, (t) => ({ ...t, simple: simpleUndo(t.simple) }), { origin: 'undo' });
    await tapSimple(p.id);
    await flush();
    expect(seq()).toBe(0);
    expect(ledger.counts().round).toBe(1);
  });

  it('every non-tap origin is silent even when it leaves the round complete (edit / settings / default)', async () => {
    const p = await newProject();
    await store.updateTracker(p.id, (t) => ({ ...t, simple: { ...t.simple, count: t.simple.target } })); // no origin at all
    await store.updateTracker(p.id, (t) => ({ ...t, simple: { ...t.simple, count: 0 } }), { origin: 'edit' });
    await store.updateTracker(p.id, (t) => ({ ...t, simple: { ...t.simple, count: t.simple.target } }), { origin: 'settings' });
    await store.updateTracker(p.id, (t) => ({ ...t, simple: { ...t.simple, count: 0 } }), { origin: 'sync' });
    await store.updateTracker(p.id, (t) => ({ ...t, simple: { ...t.simple, count: t.simple.target } }), { origin: 'import' });
    await flush();
    expect(seq()).toBe(0);
    expect(ledger.counts().round).toBe(0);
  });

  it('sync / merge / load replace project state without touching the ledger', async () => {
    const p = await newProject();
    // What SyncService.applyMerged does: it sets the signal directly, never through updateTracker.
    store.projects.update((list) => list.map((x) => (x.id === p.id ? { ...x, tracker: { ...x.tracker, simple: { ...x.tracker.simple, count: x.tracker.simple.target, round: 4 } } } : x)));
    await store.load('user:a');
    await flush();
    expect(seq()).toBe(0);
    expect(ledger.counts().round).toBe(0);
  });

  it('pattern ROUND mode (jumps straight to the next round) is recognised and fires once per round', async () => {
    const pat = { ...parsedPattern(), };
    await store.addPattern(pat);
    const p = createProject({ ...input('Ball', 0), patternId: pat.id, totalRounds: 5 });
    await store.addProject(p);
    await store.updateTracker(p.id, (t) => ({ ...t, cursor: patternSetMode(t.cursor, 'round') }), { origin: 'edit' });
    const tap = () => store.updateTracker(p.id, (t) => ({ ...t, cursor: patternTap(parsed, t.cursor) }), { origin: 'tap', parsed });
    await tap();
    await flush();
    expect(lastKinds()).toEqual(['round']);
    await tap();
    await flush();
    expect(lastKinds()).toEqual(['round', 'milestone']); // 2 of 5 rounds = 40 % → the 25 % mark
    expect(seq()).toBe(2);
    const cur = store.project(p.id)!.tracker.cursor;
    expect(cur.roundIndex).toBe(2);
    // undo + tap again: same round 2 key
    await store.updateTracker(p.id, (t) => ({ ...t, cursor: patternUndo(t.cursor) }), { origin: 'undo' });
    await tap();
    await flush();
    expect(seq()).toBe(2);
    expect(ledger.counts()).toMatchObject({ round: 2, milestone: 1 });
  });

  it('a tap without the pinned `parsed` pattern is never guessed at', async () => {
    const pat = parsedPattern();
    await store.addPattern(pat);
    const p = createProject({ ...input('Ball', 0), patternId: pat.id, totalRounds: 5 });
    await store.addProject(p);
    await store.updateTracker(p.id, (t) => ({ ...t, cursor: patternSetMode(t.cursor, 'round') }), { origin: 'edit' });
    await store.updateTracker(p.id, (t) => ({ ...t, cursor: patternTap(parsed, t.cursor) }), { origin: 'tap' }); // parsed omitted
    await flush();
    expect(seq()).toBe(0);
  });

  describe('multi-part projects', () => {
    const part = (name: string, quantity = 1): PatternPart => ({ id: uuid(), name, quantity, text: 'R1: 6sc in MR [6]\nR2: inc x 6 [12]', assemblyNotes: '' });
    const collection = (parts: PatternPart[]): PatternCollection => ({
      id: uuid(), name: 'Bear', description: '', level: 'beginner', terms: 'us', coverLocalUrl: null, parts, rev: 1, suggestedMinutes: 0, sourceText: '', createdAt: 1, updatedAt: 1, deletedAt: null,
    });

    it('finishing a piece fires part; the last open piece also fires allParts; the project needs an explicit finish', async () => {
      const col = collection([part('Head'), part('Arm', 2)]);
      await store.addCollection(col);
      const p = createCollectionProject(input('Bear', 0), col);
      await store.addProject(p);
      const snaps = p.partSnapshots!;
      const pr = (instId: string) => parsePattern(snaps.find((s) => s.partId === p.parts!.find((i) => i.id === instId)!.partId)!.text);
      const finishPiece = async (instId: string) => {
        const pp = pr(instId);
        await store.updatePartTracker(p.id, instId, (t) => ({ ...t, mode: 'pattern', cursor: { ...patternSetMode(t.cursor, 'round'), roundIndex: 1, ptr: 0 } }), { origin: 'edit' });
        await store.updatePartTracker(p.id, instId, (t) => ({ ...t, cursor: patternTap(pp, t.cursor) }), { origin: 'tap', parsed: pp });
        await flush();
      };
      const [head, arm1, arm2] = p.parts!;
      await finishPiece(head.id);
      expect(lastKinds()).toEqual(['round', 'part']);
      expect(joy.batch()?.requests[1].level).toBe(3);
      await finishPiece(arm1.id);
      expect(lastKinds()).toEqual(['round', 'part']);
      await finishPiece(arm2.id);
      expect(lastKinds()).toEqual(['round', 'part', 'allParts']);
      expect(ledger.counts()).toMatchObject({ part: 3, allParts: 1, project: 0 });
      expect(store.project(p.id)!.status).toBe('active'); // never completed silently
    });

    it('Arm 1 and Arm 2 have independent ledger rows (same round number, different instance)', async () => {
      const col = collection([part('Arm', 2)]);
      await store.addCollection(col);
      const p = createCollectionProject(input('Bear', 0), col);
      await store.addProject(p);
      const [a1, a2] = p.parts!;
      const pp = parsePattern(p.partSnapshots![0].text);
      for (const inst of [a1, a2]) {
        await store.updatePartTracker(p.id, inst.id, (t) => ({ ...t, mode: 'pattern', cursor: patternSetMode(t.cursor, 'round') }), { origin: 'edit' });
        await store.updatePartTracker(p.id, inst.id, (t) => ({ ...t, cursor: patternTap(pp, t.cursor) }), { origin: 'tap', parsed: pp });
      }
      await flush();
      expect(ledger.counts().round).toBe(2);
    });
  });

  describe('explicit project completion', () => {
    it('finish celebrates once; reverting to active and finishing again does not', async () => {
      const p = await newProject();
      await store.setStatus(p.id, 'done', 'finish');
      await flush();
      expect(lastKinds()).toEqual(['project']);
      expect(joy.batch()?.requests[0].level).toBe(4);
      await store.setStatus(p.id, 'active', 'edit');
      await store.setStatus(p.id, 'done', 'finish');
      await flush();
      // The repeat is reported (so the user gets a quiet confirmation) but it is NOT a celebration: no request, nothing new stored.
      expect(joy.batch()!.requests).toEqual([]);
      expect(joy.batch()!.repeats).toEqual(['project']);
      expect(ledger.counts().project).toBe(1);
    });

    it('status changes without the finish origin never celebrate', async () => {
      const p = await newProject();
      await store.setStatus(p.id, 'done');
      await flush();
      expect(seq()).toBe(0);
    });
  });

  describe('scope isolation', () => {
    it('events in one account never appear in another or in the guest scope', async () => {
      const p = await newProject();
      for (let i = 0; i < 3; i++) await tapSimple(p.id);
      await flush();
      expect(ledger.counts().round).toBe(1);
      scope.set('user:b');
      TestBed.tick();
      await store.whenScopeLoaded('user:b');
      TestBed.tick();
      await flush();
      expect(ledger.counts().round).toBe(0);
      expect((await db.loadJoy('user:b')).length).toBe(0);
      expect((await db.loadJoy('guest')).length).toBe(0);
      // the round and the "First round" badge it earned — and nothing else
      expect((await db.loadJoy('user:a')).map((r) => r.kind).sort()).toEqual(['achievement', 'round']);
    });

    it('an event persisted for an account that was switched away from is recorded but not presented to the next account', async () => {
      const p = await newProject();
      await store.updateTracker(p.id, (t) => ({ ...t, simple: { ...t.simple, count: t.simple.target - 1 } }), { origin: 'edit' });
      const before = seq();
      const pending = tapSimple(p.id);
      scope.set('user:b');
      TestBed.tick();
      await pending;
      await store.whenScopeLoaded('user:b');
      TestBed.tick();
      await flush();
      expect(seq()).toBe(before);
      expect((await db.loadJoy('user:a')).length).toBe(1);
    });
  });

  describe('failure isolation — counting must keep working', () => {
    it('a failing ledger never breaks the tracker or presents anything', async () => {
      const p = await newProject();
      vi.spyOn(db, 'putJoyIfAbsent').mockRejectedValue(new Error('disk full'));
      for (let i = 0; i < 3; i++) await expect(tapSimple(p.id)).resolves.toBeTruthy();
      await flush();
      expect(store.project(p.id)!.tracker.simple.count).toBe(3);
      expect(seq()).toBe(0);
    });

    it('a throwing detector hook never breaks the tracker', async () => {
      const p = await newProject();
      store.onJoy = () => {
        throw new Error('boom');
      };
      for (let i = 0; i < 3; i++) await expect(tapSimple(p.id)).resolves.toBeTruthy();
      expect(store.project(p.id)!.tracker.simple.count).toBe(3);
    });

    it('detection is skipped (and costs nothing) when no celebration layer is attached', async () => {
      const p = await newProject();
      store.onJoy = null;
      for (let i = 0; i < 3; i++) await tapSimple(p.id);
      expect(store.project(p.id)!.tracker.simple.count).toBe(3);
    });
  });

  describe('preferences', () => {
    it('existing users get safe defaults', () => {
      expect(joyPrefsOf(store.prefs())).toEqual(DEFAULT_JOY_PREFS);
    });

    it('persists per scope, merges partial updates and survives a restart', async () => {
      await store.updatePrefs({ joy: { haptics: false } });
      await store.updatePrefs({ joy: { celebrate: 'milestones' }, reminders: { enabled: false, time: '20:00' } });
      expect(joyPrefsOf(store.prefs())).toEqual({ ...DEFAULT_JOY_PREFS, haptics: false, celebrate: 'milestones' });
      await boot(db);
      expect(joyPrefsOf(store.prefs())).toEqual({ ...DEFAULT_JOY_PREFS, haptics: false, celebrate: 'milestones' });
      expect(store.prefs().reminders?.time).toBe('20:00');
      scope.set('user:b');
      TestBed.tick();
      await store.whenScopeLoaded('user:b');
      expect(joyPrefsOf(store.prefs())).toEqual(DEFAULT_JOY_PREFS);
    });
  });

  it('keeps the existing counter tests honest: a normal tap changes only the counter', async () => {
    const p = await newProject({ tracker: { ...createProject(input()).tracker, simple: createSimpleCounter({ target: 5, perTap: 2 }) } });
    await tapSimple(p.id);
    expect(store.project(p.id)!.tracker.simple.count).toBe(2);
    expect(seq()).toBe(0);
  });
});

function parsedPattern() {
  return { id: uuid(), isSample: false, name: 'Ball', level: 'beginner' as const, terms: 'us' as const, source: 'text' as const, text: TEXT, file: null, attribution: '', sourceUrl: '', position: 0, updatedAt: 1, deletedAt: null };
}
