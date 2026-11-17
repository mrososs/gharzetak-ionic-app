import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { I18nService } from '../i18n/i18n.service';
import { simpleNextRound, simpleReset, simpleTap, simpleUndo } from '../domain/tracker-engine';
import { HapticsService } from '../services/haptics.service';
import { AppStore } from '../state/app.store';
import { createProject } from '../state/factories';
import { LocalDb } from '../storage/local-db';
import { ROUND_MESSAGES, ROUNDS_IN_A_ROW, arOrdinal, arRounds, nextIndex } from './joy.copy';
import { JoyLedgerService } from './joy-ledger.service';
import { BANNER_VISIBLE_MS, BANNER_WINDOW_MS, JoyPresenter } from './joy-presenter.service';
import { JoyService } from './joy.service';

const flush = () => new Promise((r) => setTimeout(r, 8));
const input = (name = 'Bunny') => ({ name, category: 'amigurumi' as const, hook: '3.0', yarn: 'cotton' as const, target: 1, coverLocalUrl: null, patternId: null as string | null });

describe('JoyPresenter — Level 1 round banner', () => {
  let store: AppStore;
  let presenter: JoyPresenter;
  let ledger: JoyLedgerService;
  let i18n: I18nService;
  const haptics = { supported: true, impact: vi.fn(async () => undefined), success: vi.fn(async () => undefined) };
  const scope = signal<'user:a' | 'user:b'>('user:a');
  let now = 1_000_000;

  beforeEach(async () => {
    haptics.impact.mockClear();
    haptics.success.mockClear();
    scope.set('user:a');
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [AppStore, JoyService, JoyLedgerService, JoyPresenter, LocalDb, I18nService, { provide: HapticsService, useValue: haptics }, { provide: AuthService, useValue: { scope } }],
    });
    store = TestBed.inject(AppStore);
    ledger = TestBed.inject(JoyLedgerService);
    TestBed.inject(JoyService);
    presenter = TestBed.inject(JoyPresenter);
    i18n = TestBed.inject(I18nService);
    i18n.lang.set('en');
    TestBed.tick();
    await store.whenScopeLoaded('user:a');
    TestBed.tick();
    await flush();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Target 1 per round: the first tap completes the round, the second moves to the next one. */
  const complete = async (id: string) => {
    await store.updateTracker(id, (t) => ({ ...t, simple: t.simple.count >= t.simple.target ? simpleNextRound(t.simple) : simpleTap(t.simple) }), { origin: 'tap' });
    await flush();
    TestBed.tick();
  };
  const advance = async (id: string) => complete(id); // the "next round" tap (no event)
  const newProject = async () => {
    const p = createProject(input());
    await store.addProject(p);
    return p;
  };

  it('shows one banner with the written round number, gives one light haptic, and records the round', async () => {
    const p = await newProject();
    await complete(p.id);
    const b = presenter.banner();
    expect(b).not.toBeNull();
    expect(b!.mood).toBe('happy');
    expect(b!.rounds).toBe(1);
    expect(haptics.impact).toHaveBeenCalledTimes(1);
    expect(haptics.impact).toHaveBeenCalledWith('light');
    expect(ledger.counts().round).toBe(1);
  });

  it('rate limit: at most one banner per window; quick rounds are still recorded and folded into the next banner as a summary', async () => {
    const p = await newProject();
    await complete(p.id); // round 1 → banner
    const firstId = presenter.banner()!.id;
    await advance(p.id);
    now += 5_000;
    await complete(p.id); // round 2 inside the window → suppressed
    await advance(p.id);
    now += 5_000;
    await complete(p.id); // round 3 inside the window → suppressed
    expect(presenter.banner()!.id).toBe(firstId);
    expect(ledger.counts().round).toBe(3); // the ledger is never rate-limited
    expect(haptics.impact).toHaveBeenCalledTimes(1);

    await advance(p.id);
    now += BANNER_WINDOW_MS + 1; // window over
    await complete(p.id); // round 4 → one summary for the 2 suppressed + this one
    const summary = presenter.banner()!;
    expect(summary.id).not.toBe(firstId);
    expect(summary.rounds).toBe(3);
    expect(summary.text).toContain('3');
    expect(ROUNDS_IN_A_ROW.some((m) => summary.text === m.en.replace('{k}', '3'))).toBe(true);
    expect(ledger.counts().round).toBe(4);
    expect(haptics.impact).toHaveBeenCalledTimes(2);
  });

  it('undo, reset and re-completing the same round never show a banner or vibrate', async () => {
    const p = await newProject();
    await complete(p.id);
    presenter.dismissBanner();
    haptics.impact.mockClear();
    now += BANNER_WINDOW_MS + 1;
    await store.updateTracker(p.id, (t) => ({ ...t, simple: simpleUndo(t.simple) }), { origin: 'undo' });
    await complete(p.id); // same round again
    await store.updateTracker(p.id, (t) => ({ ...t, simple: simpleReset(t.simple) }), { origin: 'reset' });
    await flush();
    expect(presenter.banner()).toBeNull();
    expect(haptics.impact).not.toHaveBeenCalled();
    expect(ledger.counts().round).toBe(1);
  });

  it('sync / load / edit never produce a banner or a vibration', async () => {
    const p = await newProject();
    store.projects.update((l) => l.map((x) => (x.id === p.id ? { ...x, tracker: { ...x.tracker, simple: { ...x.tracker.simple, count: 1 } } } : x)));
    await store.load('user:a');
    await store.updateTracker(p.id, (t) => ({ ...t, simple: { ...t.simple, count: 1 } }), { origin: 'sync' });
    await flush();
    expect(presenter.banner()).toBeNull();
    expect(haptics.impact).not.toHaveBeenCalled();
  });

  it('auto-dismisses after a short time and can be dismissed by hand', async () => {
    const p = await newProject();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await complete2(p.id);
    expect(presenter.banner()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(BANNER_VISIBLE_MS + 50);
    expect(presenter.banner()).toBeNull();
    vi.useRealTimers();

    now += BANNER_WINDOW_MS + 1;
    await advance(p.id);
    await complete(p.id);
    expect(presenter.banner()).not.toBeNull();
    presenter.dismissBanner();
    expect(presenter.banner()).toBeNull();
  });

  // (with fake timers the helper must not rely on a real setTimeout)
  async function complete2(id: string) {
    await store.updateTracker(id, (t) => ({ ...t, simple: simpleTap(t.simple) }), { origin: 'tap' });
    await vi.advanceTimersByTimeAsync(20);
    TestBed.tick();
  }

  describe('preferences', () => {
    it('celebrate: off → nothing at all (no banner, no haptic) but the ledger still records', async () => {
      await store.updatePrefs({ joy: { celebrate: 'off' } });
      const p = await newProject();
      await complete(p.id);
      expect(presenter.banner()).toBeNull();
      expect(haptics.impact).not.toHaveBeenCalled();
      expect(ledger.counts().round).toBe(1);
    });

    it('celebrate: milestones only → no per-round banner', async () => {
      await store.updatePrefs({ joy: { celebrate: 'milestones' } });
      const p = await newProject();
      await complete(p.id);
      expect(presenter.banner()).toBeNull();
      expect(ledger.counts().round).toBe(1);
    });

    it('messages off → a plain confirmation instead of a motivational sentence', async () => {
      await store.updatePrefs({ joy: { messages: false } });
      const p = await newProject();
      await complete(p.id);
      expect(presenter.banner()!.text).toBe('✓ Round 1');
    });

    it('haptics off → the banner still shows but the phone never vibrates', async () => {
      await store.updatePrefs({ joy: { haptics: false } });
      const p = await newProject();
      await complete(p.id);
      expect(presenter.banner()).not.toBeNull();
      expect(haptics.impact).not.toHaveBeenCalled();
    });

    it('Arabic uses ordinal words up to ten and plain numbers after', async () => {
      i18n.lang.set('ar');
      expect(arOrdinal(6)).toBe('السادس');
      expect(arOrdinal(11)).toBe('11');
      expect(arRounds(2)).toBe('دورين');
      expect(arRounds(4)).toBe('4 أدوار');
      expect(arRounds(12)).toBe('12 دور');
      const p = await newProject();
      await store.updatePrefs({ joy: { messages: false } });
      await complete(p.id);
      expect(presenter.banner()!.text).toBe('✓ الدور الأول');
    });
  });

  it('never repeats the same message twice in a row', () => {
    let last = -1;
    const seen: number[] = [];
    for (let i = 0; i < 200; i++) {
      last = nextIndex(ROUND_MESSAGES.length, last, () => (i % 7) / 7);
      seen.push(last);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    expect(nextIndex(1, 0)).toBe(0);
  });

  it('every message has both languages', () => {
    for (const m of [...ROUND_MESSAGES, ...ROUNDS_IN_A_ROW]) {
      expect(m.ar.length).toBeGreaterThan(5);
      expect(m.en.length).toBeGreaterThan(5);
    }
  });

  it('a banner never survives an account switch', async () => {
    const p = await newProject();
    await complete(p.id);
    expect(presenter.banner()).not.toBeNull();
    scope.set('user:b');
    TestBed.tick();
    await store.whenScopeLoaded('user:b');
    TestBed.tick();
    expect(presenter.banner()).toBeNull();
  });

  it('a throwing haptics plugin never affects the banner or the counter', async () => {
    haptics.impact.mockRejectedValueOnce(new Error('no vibrator'));
    const p = await newProject();
    await complete(p.id);
    expect(presenter.banner()).not.toBeNull();
    expect(store.project(p.id)!.tracker.simple.count).toBe(1);
  });
});
