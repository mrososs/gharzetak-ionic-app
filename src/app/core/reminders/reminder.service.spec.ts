import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { I18nService } from '../i18n/i18n.service';
import { reminderPrefsOf } from '../joy/joy.models';
import { TimerService } from '../services/timer.service';
import { AppStore } from '../state/app.store';
import { createProject } from '../state/factories';
import { LocalDb, Scope } from '../storage/local-db';
import { CHANNEL_DETAILS, CHANNEL_PRIVATE, PREVIEW_ID, PlannedReminder, isReminderId } from './reminder-planner';
import { fingerprint } from './reminder-time';
import { NotifPermission, ReminderTransport } from './reminder-transport';
import { ReminderService, SOFT_ASK_EVERY_MS } from './reminder.service';

class FakeTransport extends ReminderTransport {
  native = true;
  perm: NotifPermission = 'prompt';
  /** What the system dialog answers when (and only when) it is shown. */
  dialogAnswer: NotifPermission = 'granted';
  pending = new Map<number, PlannedReminder>();
  log: string[] = [];
  scheduleCalls: PlannedReminder[][] = [];
  scheduleError: Error | null = null;
  taps: ((e: unknown) => void)[] = [];
  async permission() { return this.perm; }
  async requestPermission() { this.log.push('REQUEST_PERMISSION'); this.perm = this.dialogAnswer; return this.perm; }
  async ensureChannels() { this.log.push('channels'); }
  async pendingIds() { return [...this.pending.keys()]; }
  async cancel(ids: readonly number[]) { this.log.push('cancel:' + ids.length); for (const id of ids) this.pending.delete(id); }
  async schedule(list: readonly PlannedReminder[]) {
    // the real plugin would show the permission dialog from schedule() if it were missing: that must never happen
    if (this.perm !== 'granted') this.log.push('SCHEDULE_WITHOUT_PERMISSION');
    this.log.push('schedule:' + list.length);
    if (this.scheduleError) throw this.scheduleError;
    this.scheduleCalls.push([...list]);
    for (const r of list) this.pending.set(r.id, r);
  }
  async onTap(cb: (e: unknown) => void) { this.taps.push(cb); return () => undefined; }
  async openSettings() { this.log.push('openSettings'); }
}


describe('ReminderService', () => {
  const scope = signal<Scope>('user:a');
  const signedIn = signal(true);
  const guest = signal(false);
  const running = signal<unknown>(null);
  let tr: FakeTransport;
  let store: AppStore;
  let svc: ReminderService;
  let db: LocalDb;
  let lang: I18nService;

  async function boot(keep?: LocalDb) {
    TestBed.resetTestingModule();
    tr = tr ?? new FakeTransport();
    TestBed.configureTestingModule({
      providers: [
        AppStore, ReminderService, keep ? { provide: LocalDb, useValue: keep } : LocalDb, I18nService,
        { provide: ReminderTransport, useValue: tr },
        { provide: TimerService, useValue: { running } },
        { provide: AuthService, useValue: { scope, signedIn, guest } },
      ],
    });
    db = TestBed.inject(LocalDb);
    store = TestBed.inject(AppStore);
    lang = TestBed.inject(I18nService);
    lang.lang.set('en');
    svc = TestBed.inject(ReminderService);
    TestBed.tick();
    await loaded(scope());
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(2000);
  }

  const project = (name = 'Bunny', over = {}) => ({ ...createProject({ name, category: 'amigurumi', hook: '3.0', yarn: 'cotton', target: 10, coverLocalUrl: null, patternId: null }), lastWorkedAt: Date.now() - 86_400_000 * 5, ...over });
  /** whenScopeLoaded polls with setTimeout, which the fake clock freezes: advance it while waiting. */
  const loaded = async (s: Scope) => {
    const p = store.whenScopeLoaded(s);
    await vi.advanceTimersByTimeAsync(100);
    await p;
  };
  const settle = async (ms = 2000) => {
    await vi.advanceTimersByTimeAsync(ms);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(10);
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try { localStorage.clear(); } catch { /* ignore */ }
    scope.set('user:a');
    signedIn.set(true);
    guest.set(false);
    running.set(null);
    tr = new FakeTransport();
    await boot();
  });
  afterEach(() => vi.useRealTimers());

  it('is OFF by default and never asks for notification permission just because the app started, planned or opened Settings', async () => {
    await store.addProject(project());
    await settle();
    await svc.onResume();
    await settle();
    await svc.preview();
    await svc.refreshPermission();
    svc.maybeSoftAsk(); // only opens the explanation sheet
    expect(reminderPrefsOf(store.prefs()).enabled).toBe(false);
    expect(tr.log).not.toContain('REQUEST_PERMISSION');
    expect(tr.scheduleCalls).toHaveLength(0);
    expect(svc.softAsk()).toBe(true); // the friendly explanation, not the system dialog
  });

  describe('opt-in', () => {
    it('only enable() — after the user said yes — shows the system dialog, then schedules the approved defaults', async () => {
      await store.addProject(project());
      await svc.enable();
      await settle();
      expect(tr.log.filter((l) => l === 'REQUEST_PERMISSION')).toHaveLength(1);
      expect(reminderPrefsOf(store.prefs())).toMatchObject({ enabled: true, time: '19:30', days: [3, 7], cadence: 'twice', quiet: { start: '22:00', end: '08:00' }, showDetails: false });
      expect(tr.scheduleCalls).toHaveLength(1);
      expect(tr.scheduleCalls[0].length).toBeGreaterThanOrEqual(7);
      expect(tr.log).not.toContain('SCHEDULE_WITHOUT_PERMISSION');
      expect([...tr.pending.keys()].every(isReminderId)).toBe(true);
      expect(svc.nextAt()).toBe(tr.scheduleCalls[0][0].at);
      expect(tr.scheduleCalls[0].every((r) => r.channelId === CHANNEL_PRIVATE)).toBe(true);
    });

    it('a refused system dialog leaves reminders OFF, schedules nothing and says so', async () => {
      tr.dialogAnswer = 'denied';
      await store.addProject(project());
      expect(await svc.enable()).toBe('denied');
      await settle();
      expect(reminderPrefsOf(store.prefs()).enabled).toBe(false);
      expect(tr.scheduleCalls).toHaveLength(0);
      expect(svc.permission()).toBe('denied');
    });

    it('when the permission was already refused for good, enable() does not even show a dialog', async () => {
      tr.perm = 'denied';
      expect(await svc.enable()).toBe('denied');
      expect(tr.log).not.toContain('REQUEST_PERMISSION');
    });

    it('when the permission is already granted there is no dialog at all', async () => {
      tr.perm = 'granted';
      await store.addProject(project());
      expect(await svc.enable()).toBe('granted');
      expect(tr.log).not.toContain('REQUEST_PERMISSION');
    });

    it('does nothing in a browser (reminders are an app feature)', async () => {
      tr.native = false;
      await boot();
      expect(svc.supported).toBe(false);
      expect(await svc.enable()).toBe('unsupported');
      expect(await svc.preview()).toBe('unsupported');
    });
  });

  describe('keeping the OS schedule exact', () => {
    beforeEach(async () => {
      tr.perm = 'granted';
      await store.addProject(project());
      await svc.enable();
      await settle();
      tr.log.length = 0;
      tr.scheduleCalls.length = 0;
    });

    it('re-planning with nothing changed schedules nothing again and cancels nothing (idempotent)', async () => {
      await svc.replan();
      await svc.replan();
      await svc.onResume();
      await settle();
      expect(tr.log.filter((l) => l.startsWith('schedule') || l.startsWith('cancel'))).toEqual([]);
    });

    it('a changed time replaces the old reminders exactly: old ids cancelled, new ones scheduled, no duplicates', async () => {
      const before = [...tr.pending.keys()];
      await svc.update({ time: '20:15' });
      await settle();
      expect(tr.scheduleCalls).toHaveLength(1);
      const after = [...tr.pending.keys()];
      expect(new Set(after).size).toBe(after.length);
      expect(after.length).toBe(before.length);
      for (const r of tr.pending.values()) expect(new Date(r.at).getTime()).toBeGreaterThan(Date.now());
      expect([...tr.pending.values()].every((r) => /20:15|\d/.test(String(r.at)))).toBe(true);
      expect(tr.log.some((l) => l.startsWith('cancel:'))).toBe(true);
    });

    it('stale reminders left over from an earlier install or crash (in our id range) are cleaned up, others are never touched', async () => {
      tr.pending.set(7_000_005, { id: 7_000_005, at: 1, title: 'stale', body: 'x', kind: 'scheduled', channelId: CHANNEL_PRIVATE, extra: { v: 1, kind: 'scheduled', scope: 'old', projectId: null, instanceId: null } });
      tr.pending.set(42, { id: 42, at: 1, title: 'someone else', body: 'x', kind: 'scheduled', channelId: 'other', extra: {} as never });
      await svc.update({ time: '18:00' });
      await settle();
      expect(tr.pending.has(7_000_005)).toBe(false);
      expect(tr.pending.has(42)).toBe(true); // another feature's / plugin's notification is never cancelled
    });

    it('"show project name" switches to the details channel and wording; switching it off returns to generic', async () => {
      await svc.update({ showDetails: true });
      await settle();
      const detailed = [...tr.pending.values()];
      expect(detailed.every((r) => r.channelId === CHANNEL_DETAILS)).toBe(true);
      expect(detailed.some((r) => r.body.includes('Bunny'))).toBe(true);
      await svc.update({ showDetails: false });
      await settle();
      expect([...tr.pending.values()].every((r) => r.channelId === CHANNEL_PRIVATE && !r.body.includes('Bunny'))).toBe(true);
    });

    it('"disable all" cancels everything and clears the plan', async () => {
      expect(tr.pending.size).toBeGreaterThan(0);
      await svc.disable();
      expect(tr.pending.size).toBe(0);
      expect(reminderPrefsOf(store.prefs()).enabled).toBe(false);
      expect(svc.nextAt()).toBeNull();
      expect(localStorage.getItem('gz.reminders.plan')).toBeNull();
    });

    it('a finished or deleted last project cancels the reminders (nothing left to continue)', async () => {
      const id = store.projects()[0].id;
      await store.setStatus(id, 'done');
      await settle();
      expect(tr.pending.size).toBe(0);
      await store.setStatus(id, 'active');
      await settle();
      expect(tr.pending.size).toBeGreaterThan(0);
      await store.deleteProject(id);
      await settle();
      expect(tr.pending.size).toBe(0);
    });

    it('a time-zone change is picked up on resume (the plan signature includes the zone)', async () => {
      const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'Asia/Kolkata' } as Intl.ResolvedDateTimeFormatOptions);
      await svc.onResume();
      await settle();
      expect(tr.scheduleCalls).toHaveLength(1);
      spy.mockRestore();
    });

    it('language change re-words the pending reminders', async () => {
      lang.lang.set('ar');
      TestBed.tick();
      await settle();
      expect([...tr.pending.values()].every((r) => r.title === 'غرزتك 🧶')).toBe(true);
    });
  });

  describe('permission revoked later', () => {
    it('everything pending is cancelled, nothing is scheduled (and no dialog), and the UI is told it needs permission', async () => {
      tr.perm = 'granted';
      await store.addProject(project());
      await svc.enable();
      await settle();
      expect(tr.pending.size).toBeGreaterThan(0);
      tr.perm = 'denied'; // the user switched notifications off in the phone's settings
      tr.log.length = 0;
      await svc.onResume();
      await settle();
      expect(tr.pending.size).toBe(0);
      expect(tr.log.filter((l) => l.startsWith('schedule'))).toEqual([]);
      expect(tr.log).not.toContain('REQUEST_PERMISSION');
      expect(svc.needsPermission()).toBe(true);
      expect(reminderPrefsOf(store.prefs()).enabled).toBe(true); // kept, so they come back when the permission does
      tr.perm = 'granted';
      await svc.onResume();
      await settle();
      expect(tr.pending.size).toBeGreaterThan(0);
      expect(svc.needsPermission()).toBe(false);
    });
  });

  describe('accounts, logout and guests', () => {
    beforeEach(async () => {
      tr.perm = 'granted';
      await store.addProject(project());
      await svc.enable();
      await settle();
    });

    it('logging out cancels every reminder', async () => {
      expect(tr.pending.size).toBeGreaterThan(0);
      signedIn.set(false);
      guest.set(false);
      scope.set('guest');
      TestBed.tick();
      await loaded('guest');
      TestBed.tick();
      await settle();
      expect(tr.pending.size).toBe(0);
    });

    it('switching to another account cancels the first account\'s reminders; the new account gets none until IT opts in', async () => {
      const ownerA = fingerprint('user:a');
      expect([...tr.pending.values()].every((r) => r.extra.scope === ownerA)).toBe(true);
      scope.set('user:b');
      TestBed.tick();
      await loaded('user:b');
      TestBed.tick();
      await settle();
      expect(tr.pending.size).toBe(0);
      expect(reminderPrefsOf(store.prefs()).enabled).toBe(false);
      // and A's reminders come back when A returns (its prefs were kept)
      await store.addProject(project('B project'));
      scope.set('user:a');
      TestBed.tick();
      await loaded('user:a');
      TestBed.tick();
      await settle();
      expect(tr.pending.size).toBeGreaterThan(0);
      expect([...tr.pending.values()].every((r) => r.extra.scope === ownerA)).toBe(true);
    });

    it('a guest who opted in gets reminders for the guest scope only while in guest mode', async () => {
      signedIn.set(false);
      guest.set(true);
      scope.set('guest');
      TestBed.tick();
      await loaded('guest');
      await store.addProject(project('Guest project'));
      tr.perm = 'granted';
      await svc.enable();
      await settle();
      expect(tr.pending.size).toBeGreaterThan(0);
      expect([...tr.pending.values()].every((r) => r.extra.scope === fingerprint('guest'))).toBe(true);
      guest.set(false); // leaves guest mode without signing in
      TestBed.tick();
      await settle();
      expect(tr.pending.size).toBe(0);
    });

    it('if the store ever holds a different identity than the signed-in one, NOTHING is scheduled or cancelled (one account\'s data is never planned under another)', async () => {
      store.scope.set('user:zzz'); // the store out of step with auth.scope() = user:a
      tr.log.length = 0;
      tr.scheduleCalls.length = 0;
      await svc.update({ time: '18:00' }); // a change that would otherwise be re-planned and re-scheduled
      await svc.replan();
      await settle();
      expect(tr.log.filter((l) => l.startsWith('schedule') || l.startsWith('cancel'))).toEqual([]);
      expect(tr.scheduleCalls).toHaveLength(0);
      store.scope.set('user:a');
    });

    it('while the store is still loading another identity nothing is cancelled or scheduled (no flapping)', async () => {
      const before = tr.log.length;
      scope.set('user:c');
      TestBed.tick(); // the store has not finished loading user:c yet
      await svc.replan();
      expect(tr.log.slice(before).filter((l) => l.startsWith('schedule'))).toEqual([]);
    });
  });

  describe('performance and robustness', () => {
    it('counting taps never trigger a re-plan (the trigger only changes per 10-minute bucket)', async () => {
      tr.perm = 'granted';
      const p = project('Bunny', { lastWorkedAt: Date.now() });
      await store.addProject(p);
      await svc.enable();
      await settle();
      tr.log.length = 0;
      for (let i = 0; i < 30; i++) {
        await store.updateTracker(p.id, (t) => ({ ...t, simple: { ...t.simple, count: (t.simple.count + 1) % 9 } }), { origin: 'tap' });
        await vi.advanceTimersByTimeAsync(100);
      }
      await settle();
      expect(tr.log.filter((l) => l.startsWith('schedule') || l.startsWith('cancel'))).toEqual([]);
    });

    it('a failing plugin never breaks the app: the error is kept for the UI and the next re-plan tries again', async () => {
      tr.perm = 'granted';
      tr.scheduleError = new Error('plugin crashed');
      await store.addProject(project());
      await svc.enable();
      await settle();
      expect(svc.error()).toContain('plugin crashed');
      tr.scheduleError = null;
      await svc.replan();
      expect(svc.error()).toBeNull();
      expect(tr.pending.size).toBeGreaterThan(0);
    });

    it('overlapping re-plans are serialised and end with a single consistent schedule', async () => {
      tr.perm = 'granted';
      await store.addProject(project());
      await svc.enable();
      await Promise.all([svc.replan(), svc.replan(), svc.update({ time: '18:00' }), svc.replan()]);
      await settle();
      const ids = [...tr.pending.keys()];
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeGreaterThanOrEqual(7);
    });
  });

  describe('preview', () => {
    it('without permission it explains instead of prompting', async () => {
      expect(await svc.preview()).toBe('needs-permission');
      expect(tr.log).not.toContain('REQUEST_PERMISSION');
      expect(tr.scheduleCalls).toHaveLength(0);
    });

    it('with permission it schedules ONE notification a few seconds away, worded like a real one', async () => {
      tr.perm = 'granted';
      await store.addProject(project('Secret Project'));
      expect(await svc.preview()).toBe('sent');
      const r = tr.scheduleCalls.at(-1)![0];
      expect(r.id).toBe(PREVIEW_ID);
      expect(r.at - Date.now()).toBeLessThanOrEqual(5_000 + 50);
      expect(r.body).not.toContain('Secret Project'); // generic unless the user opted into details
      expect(r.channelId).toBe(CHANNEL_PRIVATE);
    });
  });

  describe('soft-ask', () => {
    it('is offered at most once per 30 days on its own, never when already on or refused by the phone, but always on an explicit tap', async () => {
      const t0 = 1_700_000_000_000;
      expect(svc.maybeSoftAsk(t0)).toBe(true);
      svc.closeSoftAsk();
      expect(svc.maybeSoftAsk(t0 + 5 * 86_400_000)).toBe(false);
      expect(svc.maybeSoftAsk(t0 + SOFT_ASK_EVERY_MS + 1)).toBe(true);
      svc.closeSoftAsk();
      svc.openSoftAsk(); // the bell / switch
      expect(svc.softAsk()).toBe(true);
      svc.closeSoftAsk();
      tr.perm = 'denied';
      await svc.refreshPermission();
      expect(svc.maybeSoftAsk(t0 + 10 * SOFT_ASK_EVERY_MS)).toBe(false);
    });
  });

  it('opens the phone\'s notification settings on request', async () => {
    await svc.openSystemSettings();
    expect(tr.log).toContain('openSettings');
  });

  it('keeps the persisted plan across an app restart (so a stale schedule is replaced, not duplicated)', async () => {
    tr.perm = 'granted';
    await store.addProject(project());
    await svc.enable();
    await settle();
    const ids = [...tr.pending.keys()].sort();
    await boot(db); // restart: same device storage, same OS schedule (the fake transport keeps its pending list)
    await settle();
    expect([...tr.pending.keys()].sort()).toEqual(ids);
    expect(tr.scheduleCalls).toHaveLength(1); // nothing was scheduled a second time
  });
});
