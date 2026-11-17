import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavController } from '@ionic/angular';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { reminderPrefsOf } from '../../core/joy/joy.models';
import { PlannedReminder } from '../../core/reminders/reminder-planner';
import { NotifPermission, ReminderTransport } from '../../core/reminders/reminder-transport';
import { ReminderService } from '../../core/reminders/reminder.service';
import { STRINGS } from '../../core/i18n/strings';
import { TimerService } from '../../core/services/timer.service';
import { AppStore } from '../../core/state/app.store';
import { createProject } from '../../core/state/factories';
import { LocalDb, Scope } from '../../core/storage/local-db';
import { NotificationsSheetBody } from '../../shared/ui/dialogs/common-sheets';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { ReminderSoftAskComponent } from '../../shared/ui/joy/reminder-soft-ask.component';
import { RemindersSettingsComponent } from './reminders-settings.component';

class FakeTransport extends ReminderTransport {
  native = true;
  perm: NotifPermission = 'prompt';
  dialogAnswer: NotifPermission = 'granted';
  log: string[] = [];
  pending = new Map<number, PlannedReminder>();
  async permission() { return this.perm; }
  async requestPermission() { this.log.push('REQUEST_PERMISSION'); this.perm = this.dialogAnswer; return this.perm; }
  async ensureChannels() {}
  async pendingIds() { return [...this.pending.keys()]; }
  async cancel(ids: readonly number[]) { for (const i of ids) this.pending.delete(i); }
  async schedule(list: readonly PlannedReminder[]) { this.log.push('schedule:' + list.length); for (const r of list) this.pending.set(r.id, r); }
  async onTap() { return () => undefined; }
  async openSettings() { this.log.push('openSettings'); }
}

describe('Crochet Reminders UI', () => {
  const scope = signal<Scope>('user:a');
  let tr: FakeTransport;
  let store: AppStore;
  let svc: ReminderService;
  let i18n: I18nService;
  const ui = { say: vi.fn(async () => undefined), toast: vi.fn(), confirm: vi.fn() };
  const nav = { navigateForward: vi.fn(), back: vi.fn(), navigateRoot: vi.fn() };

  const settle = async () => {
    await vi.advanceTimersByTimeAsync(2000);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(10);
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try { localStorage.clear(); } catch { /* ignore */ }
    vi.clearAllMocks();
    tr = new FakeTransport();
    scope.set('user:a');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AppStore, ReminderService, LocalDb, I18nService,
        { provide: ReminderTransport, useValue: tr },
        { provide: TimerService, useValue: { running: signal(null) } },
        { provide: AuthService, useValue: { scope, signedIn: signal(true), guest: signal(false) } },
        { provide: UiFeedback, useValue: ui },
        { provide: NavController, useValue: nav },
      ],
    });
    store = TestBed.inject(AppStore);
    svc = TestBed.inject(ReminderService);
    i18n = TestBed.inject(I18nService);
    i18n.lang.set('en');
    TestBed.tick();
    const p = store.whenScopeLoaded('user:a');
    await vi.advanceTimersByTimeAsync(100);
    await p;
    await store.addProject({ ...createProject({ name: 'Bunny', category: 'amigurumi', hook: '3.0', yarn: 'cotton', target: 10, coverLocalUrl: null, patternId: null }), lastWorkedAt: Date.now() - 5 * 86_400_000 });
    await settle();
  });
  afterEach(() => vi.useRealTimers());

  const open = () => {
    const f = TestBed.createComponent(RemindersSettingsComponent);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement };
  };
  const press = (el: HTMLElement, text: string) => {
    const b = [...el.querySelectorAll('button')].find((x) => x.textContent?.trim().startsWith(text)) as HTMLButtonElement;
    expect(b, `button "${text}"`).toBeTruthy();
    b.click();
  };
  const enableViaSoftAsk = async () => {
    const f = TestBed.createComponent(ReminderSoftAskComponent);
    f.detectChanges();
    await (f.componentInstance as unknown as { yes(): Promise<void> }).yes();
    await settle();
  };

  describe('off by default', () => {
    it('shows the section title, the Off state, a clear status, and none of the settings', () => {
      const { el } = open();
      expect(el.querySelector('h2')?.textContent).toContain('Crochet Reminders');
      const seg = [...el.querySelectorAll('.gz-seg button')];
      expect(seg.map((b) => [b.textContent?.trim(), b.getAttribute('aria-pressed')])).toEqual([['On', 'false'], ['Off', 'true']]);
      expect(el.textContent).toContain('We will not send you any notification');
      expect(el.querySelector('input[type="time"]')).toBeNull();
      expect(el.textContent).not.toContain('Preview notification');
    });

    it('is bilingual: Arabic title and labels', () => {
      i18n.lang.set('ar');
      const { el } = open();
      expect(el.querySelector('h2')?.textContent).toContain('تذكيرات غرزتك');
      expect(el.textContent).toContain('فكّريني بوقت الكروشيه');
    });

    it('pressing On only opens the friendly explanation — it never shows the system permission dialog', async () => {
      const { el } = open();
      press(el, 'On');
      await settle();
      expect(svc.softAsk()).toBe(true);
      expect(tr.log).not.toContain('REQUEST_PERMISSION');
      expect(reminderPrefsOf(store.prefs()).enabled).toBe(false);
    });

    it('in a browser the section only explains that reminders belong to the app (no switch, no prompt)', () => {
      tr.native = false;
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [AppStore, ReminderService, LocalDb, I18nService, { provide: ReminderTransport, useValue: tr }, { provide: TimerService, useValue: { running: signal(null) } }, { provide: AuthService, useValue: { scope, signedIn: signal(true), guest: signal(false) } }, { provide: UiFeedback, useValue: ui }],
      });
      TestBed.inject(I18nService).lang.set('en');
      const { el } = open();
      expect(el.textContent).toContain('work in the Gharzetak app on your phone');
      expect(el.querySelector('.gz-seg')).toBeNull();
    });
  });

  describe('after opting in (soft-ask → Yes)', () => {
    beforeEach(async () => {
      await enableViaSoftAsk();
    });

    it('asked for the permission exactly once, only after the Yes, and scheduled the approved defaults', () => {
      expect(tr.log.filter((l) => l === 'REQUEST_PERMISSION')).toHaveLength(1);
      expect(reminderPrefsOf(store.prefs())).toMatchObject({ enabled: true, time: '19:30', days: [3, 7], cadence: 'twice' });
      expect(tr.pending.size).toBeGreaterThanOrEqual(7);
    });

    it('shows the approved defaults: 19:30, Wed + Sun, twice a week, quiet 22:00–08:00, generic lock screen', () => {
      const { el } = open();
      expect((el.querySelector('#rm-time') as HTMLInputElement).value).toBe('19:30');
      const pressed = [...el.querySelectorAll('.gz-chips[aria-labelledby="rm-days-l"] .gz-chip')].filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.getAttribute('aria-label'));
      expect(pressed).toEqual(['Wednesday', 'Sunday']);
      expect([...el.querySelectorAll('[aria-labelledby="rm-freq-l"] button')].find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent?.trim()).toBe('Twice a week');
      const quiet = [...el.querySelectorAll('input[type="time"]')].map((x) => (x as HTMLInputElement).value);
      expect(quiet).toEqual(['19:30', '22:00', '08:00']);
      expect([...el.querySelectorAll('[aria-labelledby="rm-det-l"] button')].find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent).toContain('Hide');
      expect(el.textContent).toMatch(/Next reminder: /);
      expect(el.textContent).toContain('Preview notification');
      expect(el.textContent).toContain('Turn off all reminders');
    });

    it('changing the time, days, frequency, nudges, quiet hours and details is saved and re-plans', async () => {
      const { f, el } = open();
      const time = el.querySelector('#rm-time') as HTMLInputElement;
      time.value = '20:15';
      time.dispatchEvent(new Event('change'));
      press(el, [...el.querySelectorAll('.gz-chips[aria-labelledby="rm-days-l"] .gz-chip')][4].textContent!.trim()); // Friday
      press(el, '3 times');
      press(el, 'Suggest a progress photo');
      const q = el.querySelectorAll('input[type="time"]');
      (q[1] as HTMLInputElement).value = '21:30';
      q[1].dispatchEvent(new Event('change'));
      press(el, 'Show');
      await settle();
      f.detectChanges();
      expect(reminderPrefsOf(store.prefs())).toMatchObject({ time: '20:15', cadence: 'thrice', showDetails: true, quiet: { start: '21:30', end: '08:00' } });
      expect(reminderPrefsOf(store.prefs()).days).toEqual([3, 5, 7]);
      expect(reminderPrefsOf(store.prefs()).nudges.photo).toBe(true);
      expect([...tr.pending.values()].every((r) => r.channelId === 'gz_reminders_details_v1')).toBe(true);
    });

    it('ignores a malformed time (the browser never sends one, but the handler is defensive)', async () => {
      const { el } = open();
      const time = el.querySelector('#rm-time') as HTMLInputElement;
      time.value = '';
      time.dispatchEvent(new Event('change'));
      await settle();
      expect(reminderPrefsOf(store.prefs()).time).toBe('19:30');
    });

    it('offers only unfinished projects, and choosing one is saved', async () => {
      await store.addProject({ ...createProject({ name: 'Finished one', category: 'amigurumi', hook: '3.0', yarn: 'cotton', target: 10, coverLocalUrl: null, patternId: null }), status: 'done' });
      const second = { ...createProject({ name: 'Scarf', category: 'clothes', hook: '3.0', yarn: 'cotton', target: 10, coverLocalUrl: null, patternId: null }) };
      await store.addProject(second);
      const { el } = open();
      const opts = [...el.querySelectorAll('#rm-proj option')].map((o) => o.textContent?.trim());
      expect(opts).toEqual(['My latest project', 'Bunny', 'Scarf']);
      const sel = el.querySelector('#rm-proj') as HTMLSelectElement;
      sel.value = second.id;
      sel.dispatchEvent(new Event('change'));
      await settle();
      expect(reminderPrefsOf(store.prefs()).projectId).toBe(second.id);
    });

    it('warns when the chosen time is inside quiet hours', async () => {
      await svc.update({ time: '23:00' });
      const { el } = open();
      expect(el.textContent).toContain('inside quiet hours');
      expect(el.querySelector('.gz-note.peach')).toBeTruthy();
    });

    it('explains when more days are ticked than the frequency allows', async () => {
      await svc.update({ days: [1, 2, 3, 4], cadence: 'twice' });
      const { el } = open();
      expect(el.textContent).toContain('Only the first 2 days of each week are used');
      await svc.update({ cadence: 'custom' });
      const again = open().el;
      expect(again.textContent).not.toContain('Only the first');
    });

    it('"Every day" hides the day chips', async () => {
      await svc.update({ cadence: 'daily' });
      const { el } = open();
      expect(el.querySelector('[aria-labelledby="rm-days-l"]')).toBeNull();
    });

    it('Preview schedules one test notification, and "Turn off all reminders" cancels everything', async () => {
      const { f, el } = open();
      press(el, 'Preview notification');
      await settle();
      f.detectChanges();
      expect(el.textContent).toContain('A test notification will arrive in a few seconds');
      expect([...tr.pending.keys()].includes(7_999_990)).toBe(true);
      press(el, 'Turn off all reminders');
      await settle();
      f.detectChanges();
      expect(reminderPrefsOf(store.prefs()).enabled).toBe(false);
      expect(tr.pending.size).toBe(0);
      expect(el.querySelector('input[type="time"]')).toBeNull();
    });
  });

  describe('permission states', () => {
    it('a refused system dialog keeps reminders off and the soft-ask offers the phone settings', async () => {
      tr.dialogAnswer = 'denied';
      const f = TestBed.createComponent(ReminderSoftAskComponent);
      f.detectChanges();
      const c = f.componentInstance as unknown as { yes(): Promise<void>; result(): string | null };
      await c.yes();
      expect(c.result()).toBe('denied');
      expect(reminderPrefsOf(store.prefs()).enabled).toBe(false);
      expect(tr.pending.size).toBe(0);
    });

    it('revoking the permission later shows a clear warning and a button to the phone\'s notification settings', async () => {
      await enableViaSoftAsk();
      tr.perm = 'denied';
      await svc.onResume();
      await settle();
      const { f, el } = open();
      f.detectChanges();
      expect(el.querySelector('[role="alert"]')?.textContent).toContain('turned off in your phone settings');
      press(el, 'Open notification settings');
      expect(tr.log).toContain('openSettings');
      expect(tr.pending.size).toBe(0);
    });
  });

  describe('the notification sheet (replaces the "coming soon" placeholder)', () => {
    const sheet = () => {
      const f = TestBed.createComponent(NotificationsSheetBody);
      const done = vi.fn();
      f.componentInstance.done.subscribe(done);
      f.detectChanges();
      return { f, el: f.nativeElement as HTMLElement, done };
    };

    it('no longer says reminders are "coming soon"', () => {
      expect(Object.keys(STRINGS.ar)).not.toContain('notifDemo');
      expect(Object.keys(STRINGS.en)).not.toContain('notifDemo');
      const { el } = sheet();
      expect(el.textContent).not.toMatch(/not available yet|لسه مش متاحة/);
      expect(el.textContent).toContain('Crochet Reminders');
    });

    it('off: the button opens the friendly explanation (never the system dialog) and closes the sheet', () => {
      const { el, done } = sheet();
      press(el, 'Set up reminders');
      expect(done).toHaveBeenCalled();
      expect(svc.softAsk()).toBe(true);
      expect(tr.log).not.toContain('REQUEST_PERMISSION');
    });

    it('on: the button goes to the reminder settings', async () => {
      await enableViaSoftAsk();
      const { f, el, done } = sheet();
      f.detectChanges();
      expect(el.textContent).toContain('Reminders are on');
      press(el, 'Reminder settings');
      expect(done).toHaveBeenCalled();
      expect(nav.navigateForward).toHaveBeenCalledWith('/tabs/home/settings');
    });
  });
});
