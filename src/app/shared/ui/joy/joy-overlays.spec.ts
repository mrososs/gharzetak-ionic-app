import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavController } from '@ionic/angular';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AchievementsPage } from '../../../features/achievements/achievements.page';
import { AuthService } from '../../../core/auth/auth.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { AchievementsService } from '../../../core/joy/achievements.service';
import { JoyLedgerService } from '../../../core/joy/joy-ledger.service';
import { JoyPresenter } from '../../../core/joy/joy-presenter.service';
import { JoyService } from '../../../core/joy/joy.service';
import { ProjectFinishService } from '../../../core/joy/project-finish.service';
import { joyKey } from '../../../core/domain/joy';
import { HapticsService } from '../../../core/services/haptics.service';
import { TimerService } from '../../../core/services/timer.service';
import { AppStore } from '../../../core/state/app.store';
import { LocalDb } from '../../../core/storage/local-db';
import { ShareLauncher } from '../../../core/joy/share-launcher.service';
import { ShareSource } from '../../../core/joy/share-card';
import { UiFeedback } from '../feedback/toast.service';
import { JoyFinaleComponent } from './joy-finale.component';
import { JoyMilestoneComponent } from './joy-milestone.component';
import { JoyPartSheetComponent } from './joy-part-sheet.component';

const flush = () => new Promise((r) => setTimeout(r, 8));
const nav = { back: vi.fn(), navigateRoot: vi.fn(), navigateForward: vi.fn() };

describe('Crochet Joy overlays, achievements screen and finish service', () => {
  let store: AppStore;
  let presenter: JoyPresenter;
  let ledger: JoyLedgerService;
  let i18n: I18nService;
  const timer = { switchInstance: vi.fn(async () => undefined), stateFor: vi.fn(() => 'idle' as 'idle' | 'running' | 'paused'), stop: vi.fn(async () => undefined) };
  const finishSvc = { finish: vi.fn(async () => undefined) };

  beforeEach(async () => {
    vi.clearAllMocks();
    timer.stateFor.mockReturnValue('idle');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AppStore, JoyService, JoyLedgerService, JoyPresenter, AchievementsService, LocalDb, I18nService,
        { provide: HapticsService, useValue: { supported: false, impact: vi.fn(), success: vi.fn() } },
        { provide: UiFeedback, useValue: { say: vi.fn(), toast: vi.fn(), confirm: vi.fn() } },
        { provide: AuthService, useValue: { scope: signal('user:a') } },
        { provide: NavController, useValue: nav },
        { provide: TimerService, useValue: timer },
        { provide: ProjectFinishService, useValue: finishSvc },
      ],
    });
    store = TestBed.inject(AppStore);
    ledger = TestBed.inject(JoyLedgerService);
    presenter = TestBed.inject(JoyPresenter);
    i18n = TestBed.inject(I18nService);
    i18n.lang.set('en');
    TestBed.tick();
    await store.whenScopeLoaded('user:a');
    TestBed.tick();
    await flush();
  });

  describe('<gz-joy-milestone>', () => {
    const show = (badges: ('rounds_10' | 'first_round')[] = []) => presenter.card.set({ id: 1, title: 'Halfway there! 🎉', body: 'Ball · 3 of 5 rounds', pct: 50, badges, share: null, mood: 'celebrate' });

    it('is a polite live region, shows title / project progress / a progress line, and never takes focus', () => {
      const f = TestBed.createComponent(JoyMilestoneComponent);
      const other = document.createElement('button');
      document.body.appendChild(other);
      other.focus();
      f.detectChanges();
      expect(f.nativeElement.querySelector('[aria-live="polite"]')).toBeTruthy();
      expect(f.nativeElement.querySelector('.card')).toBeNull();
      show();
      f.detectChanges();
      const el = f.nativeElement as HTMLElement;
      expect(el.querySelector('.title')?.textContent).toContain('Halfway');
      expect(el.querySelector('.sub')?.textContent).toContain('3 of 5 rounds');
      expect(el.querySelector('.bar i')?.getAttribute('style')).toContain('50%');
      expect(el.querySelector('[role="dialog"], [aria-modal]')).toBeNull();
      expect(document.activeElement).toBe(other);
      other.remove();
    });

    it('a newly earned badge takes the detail line (it is rarer than the progress text)', () => {
      const f = TestBed.createComponent(JoyMilestoneComponent);
      show(['rounds_10']);
      f.detectChanges();
      const sub = (f.nativeElement as HTMLElement).querySelector('.sub')?.textContent ?? '';
      expect(sub).toContain('10 rounds');
      expect(sub).not.toContain('3 of 5 rounds');
    });

    it('stays one compact row: a 44px "Keep going" target and nothing that could grow past the counter', () => {
      const f = TestBed.createComponent(JoyMilestoneComponent);
      show();
      f.detectChanges();
      const el = f.nativeElement as HTMLElement;
      expect(el.querySelectorAll('.card > *').length).toBeLessThanOrEqual(4); // avatar, text, button, progress line
      expect(el.querySelector('button.go')).toBeTruthy();
      expect(f.nativeElement.querySelector('.title')?.textContent).toContain('Halfway');
    });

    it('open-ended counting shows no progress line (no invented percentage); "Keep going" dismisses', () => {
      presenter.card.set({ id: 2, title: '10 rounds! You are amazing 🧶', body: 'Scarf', pct: null, badges: [], share: null, mood: 'celebrate' });
      const f = TestBed.createComponent(JoyMilestoneComponent);
      f.detectChanges();
      expect(f.nativeElement.querySelector('.bar')).toBeNull();
      (f.nativeElement.querySelector('button.go') as HTMLButtonElement).click();
      expect(presenter.card()).toBeNull();
    });
  });

  describe('<gz-joy-part-sheet>', () => {
    it('"Next piece" remembers the piece AND moves the running timer with it, then closes the sheet', async () => {
      const spy = vi.spyOn(store, 'setActiveInstance').mockResolvedValue(null);
      const f = TestBed.createComponent(JoyPartSheetComponent);
      f.detectChanges();
      presenter.part.set({ id: 1, projectId: 'p1', instanceId: 'a', title: 'Head is finished! 🎊', timeText: null, done: 1, total: 3, allDone: false, nextId: 'b', badges: [], share: null, mood: 'celebrate' });
      await (f.componentInstance as unknown as { nextPiece(p: string, i: string): Promise<void> }).nextPiece('p1', 'b');
      expect(spy).toHaveBeenCalledWith('p1', 'b');
      expect(timer.switchInstance).toHaveBeenCalledWith('p1', 'b');
      expect(presenter.part()).toBeNull();
    });

    it('"Mark project as finished" goes through the explicit finish service — never silently', async () => {
      const f = TestBed.createComponent(JoyPartSheetComponent);
      f.detectChanges();
      presenter.part.set({ id: 1, projectId: 'p1', instanceId: 'a', title: 'All the pieces are done! 🧸', timeText: null, done: 3, total: 3, allDone: true, nextId: null, badges: [], share: null, mood: 'celebrate' });
      await (f.componentInstance as unknown as { markFinished(p: string): Promise<void> }).markFinished('p1');
      expect(finishSvc.finish).toHaveBeenCalledWith('p1');
      expect(presenter.part()).toBeNull();
    });
  });

  describe('<gz-joy-finale>', () => {
    it('"Add a photo" closes the finale and opens the project, where photos live', () => {
      const f = TestBed.createComponent(JoyFinaleComponent);
      f.detectChanges();
      presenter.finale.set({ id: 1, projectId: 'p9', name: 'Bunny', title: 'x', photoUrl: null, timeText: null, pieces: null, rounds: 0, badges: [], share: null, mood: 'proud' });
      (f.componentInstance as unknown as { addPhoto(id: string): void }).addPhoto('p9');
      expect(presenter.finale()).toBeNull();
      expect(nav.navigateForward).toHaveBeenCalledWith('/tabs/projects/p9');
    });

    it('drops the confetti when the in-app "reduce motion" preference is on', async () => {
      const f = TestBed.createComponent(JoyFinaleComponent);
      f.detectChanges();
      expect((f.componentInstance as unknown as { still(): boolean }).still()).toBe(false);
      await store.updatePrefs({ joy: { motion: 'reduced' } });
      expect((f.componentInstance as unknown as { still(): boolean }).still()).toBe(true);
    });
  });

  describe('Achievements screen', () => {
    const open = () => {
      const f = TestBed.createComponent(AchievementsPage);
      f.detectChanges();
      return f.nativeElement as HTMLElement;
    };
    /** Rows are written through recordSilently, i.e. tagged as credited-from-earlier (back-fill) — which the screen must say. */
    const unlock = async (id: string, at: number) => {
      await ledger.recordSilently('user:a', { key: joyKey({ kind: 'achievement', achievementId: id }), kind: 'achievement', achievementId: id, at, source: 'backfill' });
    };

    it('empty state: eight locked tiles, an invitation to start, and the device-local notice', async () => {
      const el = open();
      expect(el.querySelectorAll('li.tile')).toHaveLength(8);
      expect(el.querySelectorAll('li.tile.locked')).toHaveLength(8);
      expect(el.textContent).toContain('Your achievements will show up here once you start counting');
      expect(el.textContent).toContain('0/8');
      expect(el.querySelector('.gz-note')?.textContent).toContain('kept on this phone only');
      expect(el.querySelector('.gz-note')?.textContent).toContain('do not move to another phone');
      expect(el.textContent).toContain('Start a project');
    });

    it('unlocked tiles show the badge and its date; credited-from-old-projects ones say so; locked ones keep their hint', async () => {
      await unlock('first_finished', Date.UTC(2026, 10, 3));
      await unlock('first_round', Date.UTC(2026, 10, 5));
      TestBed.tick();
      const el = open();
      expect(el.querySelectorAll('li.tile:not(.locked)')).toHaveLength(2);
      expect(el.textContent).toContain('2/8');
      expect(el.textContent).not.toContain('Your achievements will show up here');
      expect(el.textContent).toContain('From your earlier projects'); // recordSilently tags back-filled rows
      expect(el.textContent).toContain('Finish your first piece'); // a still-locked tile keeps its hint
    });

    it('is bilingual and has an accessible label per tile', () => {
      i18n.lang.set('ar');
      const el = open();
      expect(el.querySelector('h1')?.textContent).toContain('إنجازاتي');
      expect(el.querySelector('.gz-note')?.textContent).toContain('الموبايل ده بس');
      for (const li of Array.from(el.querySelectorAll('li.tile'))) expect(li.getAttribute('aria-label')).toBeTruthy();
    });
  });

  describe('Share entry points (always a user action)', () => {
    const source: ShareSource = { kind: 'milestone', lang: 'en', avatarId: 'bunny', headline: 'Halfway there! 🎉', projectName: 'Ball', photoUrl: null, pct: 50, detail: '3 of 5 rounds', timeText: null, pieces: null, badge: null };

    it('the milestone card shows a share button only when it has something to share, and pressing it opens the share sheet', () => {
      const launcher = TestBed.inject(ShareLauncher);
      presenter.card.set({ id: 1, title: 'Halfway there! 🎉', body: 'Ball', pct: 50, badges: [], share: null, mood: 'celebrate' });
      const f = TestBed.createComponent(JoyMilestoneComponent);
      f.detectChanges();
      expect(f.nativeElement.querySelector('button.sh')).toBeNull();
      presenter.card.set({ id: 2, title: 'Halfway there! 🎉', body: 'Ball', pct: 50, badges: [], share: source, mood: 'celebrate' });
      f.detectChanges();
      const btn = f.nativeElement.querySelector('button.sh') as HTMLButtonElement;
      expect(btn.getAttribute('aria-label')).toBe('Share progress');
      expect(launcher.source()).toBeNull(); // nothing opens by itself
      btn.click();
      expect(launcher.source()).toBe(source);
      expect(presenter.card()).toBeNull();
    });

    it('the part sheet and the finale hand their card to the share sheet and close themselves', () => {
      const launcher = TestBed.inject(ShareLauncher);
      const part = TestBed.createComponent(JoyPartSheetComponent);
      part.detectChanges();
      presenter.part.set({ id: 1, projectId: 'p1', instanceId: 'a', title: 'x', timeText: null, done: 1, total: 3, allDone: false, nextId: 'b', badges: [], share: source, mood: 'celebrate' });
      (part.componentInstance as unknown as { shareCard(s: ShareSource): void }).shareCard(source);
      expect(launcher.source()).toBe(source);
      expect(presenter.part()).toBeNull();
      launcher.close();

      const fin = TestBed.createComponent(JoyFinaleComponent);
      fin.detectChanges();
      presenter.finale.set({ id: 1, projectId: 'p1', name: 'Bunny', title: 'x', photoUrl: null, timeText: null, pieces: null, rounds: 0, badges: [], share: source, mood: 'proud' });
      (fin.componentInstance as unknown as { shareCard(s: ShareSource): void }).shareCard(source);
      expect(launcher.source()).toBe(source);
      expect(presenter.finale()).toBeNull();
    });

    it('an unlocked achievement can be shared; a locked one has no share button', async () => {
      await ledger.recordSilently('user:a', { key: joyKey({ kind: 'achievement', achievementId: 'first_round' }), kind: 'achievement', achievementId: 'first_round', at: 1, source: 'backfill' });
      TestBed.tick();
      const f = TestBed.createComponent(AchievementsPage);
      f.detectChanges();
      const el = f.nativeElement as HTMLElement;
      expect(el.querySelectorAll('li.tile .share')).toHaveLength(1);
      (el.querySelector('li.tile .share') as HTMLButtonElement).click();
      const s = TestBed.inject(ShareLauncher).source()!;
      expect(s).toMatchObject({ kind: 'achievement', projectName: null, photoUrl: null });
      expect(s.badge?.name).toBe('First round');
    });
  });

  describe('ProjectFinishService (the real one)', () => {
    it('stops a running or paused work timer FIRST, then marks the project finished with the explicit origin', async () => {
      TestBed.resetTestingModule();
      const calls: string[] = [];
      const tm = { stateFor: vi.fn(() => 'running' as const), stop: vi.fn(async () => void calls.push('timer.stop')) };
      TestBed.configureTestingModule({
        providers: [ProjectFinishService, { provide: TimerService, useValue: tm }, { provide: AppStore, useValue: { project: () => ({ id: 'p', status: 'active' }), setStatus: vi.fn(async (...a: unknown[]) => void calls.push('setStatus:' + a.join(','))) } }],
      });
      await TestBed.inject(ProjectFinishService).finish('p');
      expect(calls).toEqual(['timer.stop', 'setStatus:p,done,finish']);
    });

    it('does not touch the timer when none is running, and ignores unknown or already finished projects', async () => {
      TestBed.resetTestingModule();
      const setStatus = vi.fn(async () => null);
      const tm = { stateFor: vi.fn(() => 'idle' as const), stop: vi.fn(async () => undefined) };
      let status: 'active' | 'done' | null = 'active';
      TestBed.configureTestingModule({
        providers: [ProjectFinishService, { provide: TimerService, useValue: tm }, { provide: AppStore, useValue: { project: () => (status ? { id: 'p', status } : null), setStatus } }],
      });
      const svc = TestBed.inject(ProjectFinishService);
      await svc.finish('p');
      expect(tm.stop).not.toHaveBeenCalled();
      expect(setStatus).toHaveBeenCalledTimes(1);
      status = 'done';
      await svc.finish('p');
      status = null;
      await svc.finish('p');
      expect(setStatus).toHaveBeenCalledTimes(1);
    });
  });
});
