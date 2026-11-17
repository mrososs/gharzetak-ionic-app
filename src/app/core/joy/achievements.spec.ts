import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { joyKey } from '../domain/joy';
import { simpleNextRound, simpleTap } from '../domain/tracker-engine';
import { PatternCollection, PatternPart } from '../models/models';
import { HapticsService } from '../services/haptics.service';
import { AppStore } from '../state/app.store';
import { createCollectionProject, createProject, uuid } from '../state/factories';
import { LocalDb, Scope } from '../storage/local-db';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { ACHIEVEMENTS, AchievementFacts, EARNED_BY_CREATION, EARNED_BY_EVENT, achievementDef, metAchievements } from './achievements';
import { AchievementsService } from './achievements.service';
import { JoyLedgerService } from './joy-ledger.service';
import { JoyPresenter } from './joy-presenter.service';
import { JoyService } from './joy.service';

/** Lets the async persistence chain settle. A single short timer was flaky when the machine was busy, so wait several turns. */
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 10));
};
const none: AchievementFacts = { rounds: 0, projects: 0, multipart: false, piece: false, finished: false, amigurumiDone: false };

describe('metAchievements — pure rules', () => {
  it('there are exactly the eight approved achievements, each with both languages and a hint', () => {
    expect(ACHIEVEMENTS.map((a) => a.id)).toEqual(['first_round', 'rounds_10', 'rounds_50', 'first_project', 'first_multipart', 'first_piece', 'first_finished', 'first_amigurumi']);
    for (const a of ACHIEVEMENTS) {
      expect(a.name.ar && a.name.en && a.hint.ar && a.hint.en).toBeTruthy();
      expect(achievementDef(a.id)).toBe(a);
    }
    expect(achievementDef('nope')).toBeNull();
  });

  it('nothing is earned from empty facts', () => expect(metAchievements(none)).toEqual([]));

  it('round counts: 1 → first, 10 → +10, 50 → +50 (and 9 / 49 are not enough)', () => {
    expect(metAchievements({ ...none, rounds: 1 })).toEqual(['first_round']);
    expect(metAchievements({ ...none, rounds: 9 })).toEqual(['first_round']);
    expect(metAchievements({ ...none, rounds: 10 })).toEqual(['first_round', 'rounds_10']);
    expect(metAchievements({ ...none, rounds: 49 })).toEqual(['first_round', 'rounds_10']);
    expect(metAchievements({ ...none, rounds: 50 })).toEqual(['first_round', 'rounds_10', 'rounds_50']);
  });

  it('project / multi-part / piece / finished / amigurumi map to their own facts', () => {
    expect(metAchievements({ ...none, projects: 3 })).toEqual(['first_project']);
    expect(metAchievements({ ...none, multipart: true })).toEqual(['first_multipart']);
    expect(metAchievements({ ...none, piece: true })).toEqual(['first_piece']);
    expect(metAchievements({ ...none, finished: true })).toEqual(['first_finished']);
    expect(metAchievements({ ...none, amigurumiDone: true })).toEqual(['first_amigurumi']);
  });
});

describe('AchievementsService', () => {
  const scope = signal<Scope>('user:a');
  let store: AppStore;
  let ach: AchievementsService;
  let ledger: JoyLedgerService;
  let joy: JoyService;
  let presenter: JoyPresenter;
  let db: LocalDb;
  const haptics = { supported: true, impact: vi.fn(async () => undefined), success: vi.fn(async () => undefined) };
  const ui = { say: vi.fn(async () => undefined), toast: vi.fn(async () => undefined), confirm: vi.fn(async () => true) };

  async function boot(keepDb?: LocalDb, s: Scope = 'user:a') {
    TestBed.resetTestingModule();
    scope.set(s);
    TestBed.configureTestingModule({
      providers: [
        AppStore, JoyService, JoyLedgerService, JoyPresenter, AchievementsService, keepDb ? { provide: LocalDb, useValue: keepDb } : LocalDb,
        { provide: HapticsService, useValue: haptics }, { provide: UiFeedback, useValue: ui }, { provide: AuthService, useValue: { scope } },
      ],
    });
    db = TestBed.inject(LocalDb);
    store = TestBed.inject(AppStore);
    ledger = TestBed.inject(JoyLedgerService);
    ach = TestBed.inject(AchievementsService);
    joy = TestBed.inject(JoyService);
    presenter = TestBed.inject(JoyPresenter);
    TestBed.tick();
    await store.whenScopeLoaded(s);
    TestBed.tick();
    await flush();
    TestBed.tick();
    await flush();
  }

  beforeEach(async () => {
    haptics.impact.mockClear();
    haptics.success.mockClear();
    ui.say.mockClear();
    await boot();
  });

  const input = (name = 'Bunny', category: 'amigurumi' | 'clothes' = 'amigurumi') => ({ name, category, hook: '3.0', yarn: 'cotton' as const, target: 1, coverLocalUrl: null, patternId: null as string | null });
  const tap = (id: string) => store.updateTracker(id, (t) => ({ ...t, simple: t.simple.count >= t.simple.target ? simpleNextRound(t.simple) : simpleTap(t.simple) }), { origin: 'tap' });
  /** target 1: the first call completes the round, the second moves to the next one. */
  const round = async (id: string) => {
    await tap(id);
    await tap(id);
    await flush();
  };
  const keys = () => ledger.rows('achievement').map((r) => r.achievementId).sort();

  it('creating a project through the app unlocks "First project" (celebrated); the same project added by import/demo does not celebrate', async () => {
    await store.addProject(createProject(input('Mine')), true);
    await flush();
    expect(keys()).toEqual(['first_project']);
    expect(ledger.row(joyKey({ kind: 'achievement', achievementId: 'first_project' }))?.source).toBe('live');
    expect(presenter.banner()?.text).toBe('🏅 إنجاز جديد: أول مشروع');

    await boot(); // fresh db: a user whose project arrives WITHOUT the "fresh" flag (import / demo / sync)
    await store.addProject(createProject(input('Imported')));
    await flush();
    expect(keys()).toEqual([]);
    expect(presenter.banner()).toBeNull();
    expect(joy.batch()).toBeNull();
  });

  it('back-fill credits existing durable projects silently and tags them as credited earlier (never celebrated)', async () => {
    const done = { ...createProject(input('Old bunny')), status: 'done' as const };
    await store.addProject(done);
    await ach.backfill();
    await flush();
    expect(keys()).toEqual(['first_amigurumi', 'first_finished', 'first_project']);
    for (const r of ledger.rows('achievement')) expect(r.source).toBe('backfill');
    expect(joy.batch()).toBeNull();
    expect(presenter.banner()).toBeNull();
    expect(haptics.impact).not.toHaveBeenCalled();
  });

  it('back-fill finds an already finished piece of a multi-part project, and the multi-part project itself', async () => {
    const part = (name: string, q = 1): PatternPart => ({ id: uuid(), name, quantity: q, text: 'R1: 6sc in MR [6]\nR2: inc x 6 [12]', assemblyNotes: '' });
    const col: PatternCollection = { id: uuid(), name: 'Bear', description: '', level: 'beginner', terms: 'us', coverLocalUrl: null, parts: [part('Head'), part('Arm', 2)], rev: 1, suggestedMinutes: 0, sourceText: '', createdAt: 1, updatedAt: 1, deletedAt: null };
    await store.addCollection(col);
    const p = createCollectionProject({ ...input('Teddy', 'clothes'), patternId: null } as never, col);
    const finished = { ...p, parts: p.parts!.map((i, ix) => (ix === 0 ? { ...i, mode: 'pattern' as const, cursor: { ...i.cursor, roundIndex: 1, ptr: 99 } } : i)) };
    await store.addProject(finished);
    await ach.backfill();
    await flush();
    expect(keys()).toEqual(['first_multipart', 'first_piece', 'first_project']);
  });

  it('never fabricates round history: a tracker sitting on round 8 (jumped, imported or edited) earns no round achievement', async () => {
    const p = createProject(input());
    await store.addProject({ ...p, tracker: { ...p.tracker, simple: { ...p.tracker.simple, round: 8, count: 1, totalRounds: 20 } } });
    await ach.backfill();
    await store.updateTracker(p.id, (t) => ({ ...t, simple: { ...t.simple, round: 60 } }), { origin: 'edit' });
    await ach.backfill();
    await flush();
    expect(keys()).toEqual(['first_project']);
    expect(ledger.counts().round).toBe(0);
  });

  it('rounds_10 unlocks on exactly the 10th real round, rounds_50 is not reachable from 10, and each unlock happens once', async () => {
    const p = createProject(input());
    await store.addProject(p);
    for (let i = 0; i < 9; i++) await round(p.id);
    expect(keys()).not.toContain('rounds_10');
    await tap(p.id); // 10th round complete
    await flush();
    expect(keys()).toEqual(expect.arrayContaining(['first_round', 'rounds_10']));
    expect(keys()).not.toContain('rounds_50');
    expect(ledger.counts().round).toBe(10);
    expect(await ach.evaluate('user:a', 'live', false, EARNED_BY_EVENT.round)).toEqual([]); // nothing new the second time
  });

  it('is never re-locked: undo, reverting a finished project and deleting it all leave the badges and counts untouched', async () => {
    const p = createProject(input());
    await store.addProject(p, true);
    await round(p.id);
    await store.setStatus(p.id, 'done', 'finish');
    await flush();
    const before = keys();
    expect(before).toEqual(expect.arrayContaining(['first_finished', 'first_amigurumi', 'first_round', 'first_project']));
    await store.setStatus(p.id, 'active');
    await store.deleteProject(p.id);
    await ach.backfill();
    await flush();
    expect(keys()).toEqual(before);
    expect(ledger.counts().round).toBe(1);
  });

  it('is persisted per scope: a restart keeps them, another account starts empty', async () => {
    await store.addProject(createProject(input()), true);
    await flush();
    expect(ach.count()).toBe(1);
    await boot(db);
    expect(ach.count()).toBe(1);
    scope.set('user:b');
    TestBed.tick();
    await store.whenScopeLoaded('user:b');
    TestBed.tick();
    await flush();
    expect(ach.count()).toBe(0);
    expect(ach.list().every((x) => x.row === null)).toBe(true);
  });

  it('a back-filled badge is silently replaced by nothing when it was already earned live (insert-if-absent)', async () => {
    const p = createProject(input());
    await store.addProject(p, true);
    await flush();
    await ach.backfill();
    const row = ledger.row(joyKey({ kind: 'achievement', achievementId: 'first_project' }));
    expect(row?.source).toBe('live');
  });

  it('a round on a project that merely exists (synced / imported) earns First round only — never First project out of the blue', async () => {
    const p = createProject(input());
    await store.addProject(p); // not created by the user just now
    await tap(p.id);
    await flush();
    expect(keys()).toEqual(['first_round']);
    expect(presenter.banner()?.text).toBe('🏅 إنجاز جديد: أول دور');
    await ach.backfill(); // the silent pass then credits the project itself, without a celebration
    expect(keys()).toEqual(['first_project', 'first_round']);
    expect(ledger.row(joyKey({ kind: 'achievement', achievementId: 'first_project' }))?.source).toBe('backfill');
  });

  it('a live evaluation only credits what the triggering action can earn; the rest waits for the silent back-fill', async () => {
    await store.addProject(createProject(input())); // a project that merely EXISTS (e.g. synced from another phone), not created by the user now
    expect(await ach.evaluate('user:a', 'live', false, EARNED_BY_EVENT.round)).toEqual([]); // a round event must not "earn" First project
    expect(keys()).toEqual([]);
    expect(await ach.evaluate('user:a', 'live', false, EARNED_BY_CREATION)).toEqual(['first_project']);
    expect(EARNED_BY_EVENT.project).toEqual(['first_finished', 'first_amigurumi']);
  });

  it('celebrating nothing when celebrations are off, but still recording', async () => {
    await store.updatePrefs({ joy: { celebrate: 'off' } });
    const p = createProject(input());
    await store.addProject(p, true);
    await round(p.id);
    expect(presenter.banner()).toBeNull();
    expect(keys()).toEqual(expect.arrayContaining(['first_project', 'first_round']));
  });
});
