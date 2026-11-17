import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { AuthService } from '../auth/auth.service';
import { joyKey } from '../domain/joy';
import { parsePattern } from '../domain/pattern-parser';
import { patternSetMode, patternTap, simpleNextRound, simpleTap } from '../domain/tracker-engine';
import { I18nService } from '../i18n/i18n.service';
import { PatternCollection, PatternPart } from '../models/models';
import { HapticsService } from '../services/haptics.service';
import { AppStore } from '../state/app.store';
import { createCollectionProject, createProject, uuid } from '../state/factories';
import { LocalDb } from '../storage/local-db';
import { AchievementsService } from './achievements.service';
import { JoyLedgerService } from './joy-ledger.service';
import { BANNER_VISIBLE_MS, CARD_VISIBLE_MS, JoyPresenter } from './joy-presenter.service';
import { PROJECT_DONE_QUIET } from './joy.copy';
import { JoyService } from './joy.service';

const TEXT = 'R1: 6sc in MR [6]\nR2: inc x 6 [12]\nR3: (sc, inc) x 6 [18]\nR4: (2sc, inc) x 6 [24]\nR5: 24sc [24]';
const parsed = parsePattern(TEXT);
const flush = () => new Promise((r) => setTimeout(r, 8));
/** Set to false by the badge tests, which need a genuinely fresh account. */
let firstRoundEarned = true;
const input = (name = 'Bunny') => ({ name, category: 'amigurumi' as const, hook: '3.0', yarn: 'cotton' as const, target: 0, coverLocalUrl: null as string | null, patternId: null as string | null });

describe('JoyPresenter — levels 2, 3 and 4', () => {
  let store: AppStore;
  let presenter: JoyPresenter;
  let ledger: JoyLedgerService;
  let ach: AchievementsService;
  const haptics = { supported: true, impact: vi.fn(async () => undefined), success: vi.fn(async () => undefined) };
  const ui = { say: vi.fn(async () => undefined), toast: vi.fn(async () => undefined), confirm: vi.fn(async () => true) };
  const scope = signal<'user:a'>('user:a');
  let now = 5_000_000;

  beforeEach(async () => {
    haptics.impact.mockClear();
    haptics.success.mockClear();
    ui.say.mockClear();
    now = 5_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [AppStore, JoyService, JoyLedgerService, JoyPresenter, AchievementsService, LocalDb, I18nService, { provide: HapticsService, useValue: haptics }, { provide: UiFeedback, useValue: ui }, { provide: AuthService, useValue: { scope } }],
    });
    store = TestBed.inject(AppStore);
    ledger = TestBed.inject(JoyLedgerService);
    ach = TestBed.inject(AchievementsService);
    TestBed.inject(JoyService);
    presenter = TestBed.inject(JoyPresenter);
    TestBed.inject(I18nService).lang.set('en');
    TestBed.tick();
    await store.whenScopeLoaded('user:a');
    TestBed.tick();
    await flush();
    if (firstRoundEarned) {
      await ledger.recordSilently('user:a', { key: joyKey({ kind: 'achievement', achievementId: 'first_round' }), kind: 'achievement', achievementId: 'first_round', at: 1, source: 'backfill' });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** A project that follows a 5-round pattern in "round" mode: one tap = one round. */
  async function patternProject(name = 'Ball') {
    const pat = { id: uuid(), isSample: false, name, level: 'beginner' as const, terms: 'us' as const, source: 'text' as const, text: TEXT, file: null, attribution: '', sourceUrl: '', position: 0, updatedAt: 1, deletedAt: null };
    await store.addPattern(pat);
    const p = createProject({ ...input(name), patternId: pat.id, totalRounds: 5 });
    await store.addProject(p);
    await store.updateTracker(p.id, (t) => ({ ...t, cursor: patternSetMode(t.cursor, 'round') }));
    return p;
  }
  const tapPattern = async (id: string) => {
    await store.updateTracker(id, (t) => ({ ...t, cursor: patternTap(parsed, t.cursor) }), { origin: 'tap', parsed });
    await flush();
    TestBed.tick();
  };

  describe('Level 2 — milestones', () => {
    it('25 % shows a compact card with the project, progress and a medium haptic — never a modal, and it replaces the round banner', async () => {
      const p = await patternProject('Ball');
      await tapPattern(p.id); // 1 of 5 = 20 %: just the round banner
      expect(presenter.card()).toBeNull();
      expect(presenter.banner()).not.toBeNull();
      await tapPattern(p.id); // 2 of 5 = 40 %: crosses 25 %
      const c = presenter.card()!;
      expect(c.title).toBe('A quarter done 🌱');
      expect(c.pct).toBe(25);
      expect(c.body).toBe('Ball · 2 of 5 rounds');
      expect(presenter.banner()).toBeNull(); // the higher level replaced the lighter one
      expect(haptics.impact).toHaveBeenLastCalledWith('medium');
      expect(presenter.part()).toBeNull();
      expect(presenter.finale()).toBeNull();
    });

    it('50 % and 75 % follow, each exactly once even after undo-and-redo', async () => {
      const p = await patternProject();
      for (let i = 0; i < 3; i++) await tapPattern(p.id);
      expect(presenter.card()!.title).toBe('Halfway there! 🎉');
      await tapPattern(p.id);
      expect(presenter.card()!.title).toBe('Nearly there! 💪');
      const id = presenter.card()!.id;
      await store.updateTracker(p.id, (t) => ({ ...t, cursor: { ...t.cursor, roundIndex: 3, ptr: 0 } }), { origin: 'undo' });
      await tapPattern(p.id); // round 4 again
      expect(presenter.card()!.id).toBe(id); // no new card
    });

    it('open-ended counting celebrates every 10th round with a round count, never an invented percentage', async () => {
      const p = createProject({ ...input('Scarf'), target: 1 });
      await store.addProject({ ...p, tracker: { ...p.tracker, simple: { ...p.tracker.simple, round: 10, count: 0, totalRounds: 0 } } });
      await store.updateTracker(p.id, (t) => ({ ...t, simple: simpleTap(t.simple) }), { origin: 'tap' });
      await flush();
      TestBed.tick();
      const c = presenter.card()!;
      expect(c.pct).toBeNull();
      expect(c.title).toBe('10 rounds! You are amazing 🧶');
      expect(c.body).toBe('Scarf');
    });

    it('collapses by itself after a few seconds and can be dismissed by hand', async () => {
      const p = await patternProject();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await store.updateTracker(p.id, (t) => ({ ...t, cursor: { ...t.cursor, roundIndex: 1 } }), { origin: 'edit' });
      await store.updateTracker(p.id, (t) => ({ ...t, cursor: patternTap(parsed, t.cursor) }), { origin: 'tap', parsed });
      await vi.advanceTimersByTimeAsync(30);
      TestBed.tick();
      expect(presenter.card()).not.toBeNull();
      await vi.advanceTimersByTimeAsync(CARD_VISIBLE_MS + 50);
      expect(presenter.card()).toBeNull();
      vi.useRealTimers();
    });

    it('"milestones only" shows the card but never a per-round banner; "off" shows nothing at all', async () => {
      await store.updatePrefs({ joy: { celebrate: 'milestones' } });
      const p = await patternProject();
      await tapPattern(p.id);
      expect(presenter.banner()).toBeNull();
      await tapPattern(p.id);
      expect(presenter.card()).not.toBeNull();
      presenter.dismissCard();

      await store.updatePrefs({ joy: { celebrate: 'off' } });
      await tapPattern(p.id); // 3 of 5 = 60 %: would be the 50 % card
      expect(presenter.card()).toBeNull();
      expect(ledger.counts().milestone).toBe(2); // still recorded
    });

    it('a milestone with messages off shows only the project name (no motivational body)', async () => {
      await store.updatePrefs({ joy: { messages: false } });
      const p = await patternProject('Ball');
      await tapPattern(p.id);
      await tapPattern(p.id);
      expect(presenter.card()!.body).toBe('Ball');
    });
  });

  describe('Level 3 — finished pieces', () => {
    const part = (name: string, quantity = 1): PatternPart => ({ id: uuid(), name, quantity, text: 'R1: 6sc in MR [6]\nR2: inc x 6 [12]', assemblyNotes: '' });
    const collection = (parts: PatternPart[]): PatternCollection => ({ id: uuid(), name: 'Bear', description: '', level: 'beginner', terms: 'us', coverLocalUrl: null, parts, rev: 1, suggestedMinutes: 0, sourceText: '', createdAt: 1, updatedAt: 1, deletedAt: null });

    async function bear() {
      const col = collection([part('Head'), part('Arm', 2)]);
      await store.addCollection(col);
      const p = createCollectionProject({ ...input('Teddy'), patternId: null } as never, col);
      await store.addProject(p);
      return p;
    }
    const finishPiece = async (p: { id: string; parts?: readonly { id: string }[]; partSnapshots?: readonly { text: string }[] }, instId: string, snapText: string) => {
      const pp = parsePattern(snapText);
      await store.updatePartTracker(p.id, instId, (t) => ({ ...t, mode: 'pattern', cursor: { ...patternSetMode(t.cursor, 'round'), roundIndex: 1, ptr: 0 } }), { origin: 'edit' });
      await store.updatePartTracker(p.id, instId, (t) => ({ ...t, cursor: patternTap(pp, t.cursor) }), { origin: 'tap', parsed: pp });
      await flush();
      TestBed.tick();
    };

    it('shows the part sheet: name, time on the piece, pieces done, next piece — with a success haptic', async () => {
      const p = await bear();
      const [head] = p.parts!;
      await store.updateProject(p.id, (x) => ({ ...x, parts: x.parts!.map((i) => (i.id === head.id ? { ...i, workedSeconds: 1500 } : i)) }));
      await finishPiece(p, head.id, p.partSnapshots![0].text);
      const v = presenter.part()!;
      expect(v.title).toBe('Head is finished! 🎊');
      expect(v.timeText).toBe('25 minutes');
      expect([v.done, v.total]).toEqual([1, 3]);
      expect(v.allDone).toBe(false);
      expect(v.nextId).toBe(p.parts![1].id);
      expect(haptics.success).toHaveBeenCalledTimes(1);
      expect(presenter.finale()).toBeNull();
    });

    it('the last piece offers to mark the project finished — it is NEVER completed silently', async () => {
      const p = await bear();
      const snap = (i: number) => p.partSnapshots!.find((s) => s.partId === p.parts![i].partId)!.text;
      for (let i = 0; i < 3; i++) await finishPiece(p, p.parts![i].id, snap(i));
      const v = presenter.part()!;
      expect(v.allDone).toBe(true);
      expect(v.title).toBe('All the pieces are done! 🧸');
      expect(v.nextId).toBeNull();
      expect(store.project(p.id)!.status).toBe('active');
      expect(ledger.counts()).toMatchObject({ part: 3, allParts: 1, project: 0 });
    });

    it('on the video page it becomes ONE inline line — no sheet, nothing covers or interrupts the video', async () => {
      presenter.surface.set('video');
      const p = await bear();
      await finishPiece(p, p.parts![0].id, p.partSnapshots![0].text);
      expect(presenter.part()).toBeNull();
      expect(presenter.banner()!.text).toBe('🎊 Head is finished — continue from the counter');
    });

    it('stays silent when celebrations are off (the piece is still recorded)', async () => {
      await store.updatePrefs({ joy: { celebrate: 'off' } });
      const p = await bear();
      await finishPiece(p, p.parts![0].id, p.partSnapshots![0].text);
      expect(presenter.part()).toBeNull();
      expect(ledger.counts().part).toBe(1);
    });
  });

  describe('Level 4 — project finale', () => {
    async function finishedProject(over: { cover?: string | null; seconds?: number } = {}) {
      const p = createProject({ ...input('Bunny'), target: 1, coverLocalUrl: over.cover ?? null });
      await store.addProject({ ...p, workedSeconds: over.seconds ?? 0 }, true);
      for (let i = 0; i < 3; i++) {
        await store.updateTracker(p.id, (t) => ({ ...t, simple: simpleTap(t.simple) }), { origin: 'tap' });
        await store.updateTracker(p.id, (t) => ({ ...t, simple: simpleNextRound(t.simple) }), { origin: 'tap' });
      }
      await flush();
      presenter.dismissBanner();
      return p;
    }

    it('shows the finale only after the explicit finish: name, photo, recorded time, counted rounds, NEW badges, proud avatar', async () => {
      const p = await finishedProject({ cover: 'data:image/jpeg;base64,AAAA', seconds: 3 * 3600 + 20 * 60 });
      expect(presenter.finale()).toBeNull(); // counting never completes the project
      await store.setStatus(p.id, 'done', 'finish');
      await flush();
      TestBed.tick();
      const f = presenter.finale()!;
      expect(f.title).toBe('A masterpiece! You finished Bunny 🏆');
      expect(f.photoUrl).toBe('data:image/jpeg;base64,AAAA');
      expect(f.timeText).toBe('3 hours 20 minutes');
      expect(f.rounds).toBe(3);
      expect(f.mood).toBe('proud');
      expect(f.pieces).toBeNull();
      expect(f.badges).toEqual(expect.arrayContaining(['first_finished', 'first_amigurumi']));
      expect(haptics.success).toHaveBeenCalledTimes(1);
      expect(ui.say).not.toHaveBeenCalled(); // no duplicate toast
    });

    it('without a photo or recorded time those facts are simply absent (nothing invented)', async () => {
      const p = await finishedProject();
      await store.setStatus(p.id, 'done', 'finish');
      await flush();
      const f = presenter.finale()!;
      expect(f.photoUrl).toBeNull();
      expect(f.timeText).toBeNull();
    });

    it('finishing again (revert + finish) gives only a quiet confirmation, never a second finale', async () => {
      const p = await finishedProject();
      await store.setStatus(p.id, 'done', 'finish');
      await flush();
      presenter.dismissFinale();
      await store.setStatus(p.id, 'active');
      await store.setStatus(p.id, 'done', 'finish');
      await flush();
      expect(presenter.finale()).toBeNull();
      expect(ui.say).toHaveBeenCalledWith(PROJECT_DONE_QUIET.ar, PROJECT_DONE_QUIET.en);
      expect(ledger.counts().project).toBe(1);
    });

    it('with celebrations off the finish still gets a plain confirmation, and the project event is still recorded', async () => {
      await store.updatePrefs({ joy: { celebrate: 'off' } });
      const p = await finishedProject();
      await store.setStatus(p.id, 'done', 'finish');
      await flush();
      expect(presenter.finale()).toBeNull();
      expect(ui.say).toHaveBeenCalledWith(PROJECT_DONE_QUIET.ar, PROJECT_DONE_QUIET.en);
      expect(ledger.counts().project).toBe(1);
      expect(haptics.success).not.toHaveBeenCalled();
    });

    it('a status change without the finish origin celebrates nothing and says nothing', async () => {
      const p = await finishedProject();
      await store.setStatus(p.id, 'done');
      await flush();
      expect(presenter.finale()).toBeNull();
      expect(ui.say).not.toHaveBeenCalled();
    });

    it('a finale replaces any lighter celebration still on screen', async () => {
      const p = await finishedProject();
      const pb = await patternProject('Other');
      now += 21_000; // past the banner rate-limit window of the taps above
      await tapPattern(pb.id);
      expect(presenter.banner()).not.toBeNull();
      await store.setStatus(p.id, 'done', 'finish');
      await flush();
      expect(presenter.finale()).not.toBeNull();
      expect(presenter.banner()).toBeNull();
    });
  });

  describe('badges', () => {
    beforeAll(() => {
      firstRoundEarned = false;
    });
    afterAll(() => {
      firstRoundEarned = true;
    });

    it('a new badge takes the plain round banner\'s place (the round is recorded either way)', async () => {
      const p = createProject({ ...input(), target: 1 });
      await store.addProject(p);
      await store.updateTracker(p.id, (t) => ({ ...t, simple: simpleTap(t.simple) }), { origin: 'tap' });
      await flush();
      TestBed.tick();
      expect(presenter.banner()!.text).toBe('🏅 New achievement: First round');
      expect(presenter.banner()!.mood).toBe('proud');
      expect(ledger.counts().round).toBe(1);
      expect(ach.count()).toBeGreaterThanOrEqual(1);
    });

    it('a badge banner goes away by itself', async () => {
      const p = createProject({ ...input(), target: 1 });
      await store.addProject(p);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await store.updateTracker(p.id, (t) => ({ ...t, simple: simpleTap(t.simple) }), { origin: 'tap' });
      await vi.advanceTimersByTimeAsync(40);
      TestBed.tick();
      expect(presenter.banner()).not.toBeNull();
      await vi.advanceTimersByTimeAsync(BANNER_VISIBLE_MS + 50);
      expect(presenter.banner()).toBeNull();
      vi.useRealTimers();
    });
  });
});
