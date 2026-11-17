import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavController } from '@ionic/angular';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { AuthService } from '../auth/auth.service';
import { TimerService } from '../services/timer.service';
import { OpenTrackerResult, TrackerNavigator } from '../services/tracker-navigator.service';
import { AppStore } from '../state/app.store';
import { LocalDb, Scope } from '../storage/local-db';
import { NotificationRouter, parseReminderExtra } from './notification-router.service';
import { ReminderExtra } from './reminder-planner';
import { fingerprint } from './reminder-time';
import { NotifPermission, ReminderTransport } from './reminder-transport';

class FakeTransport extends ReminderTransport {
  native = true;
  listeners: ((e: unknown) => void)[] = [];
  async permission(): Promise<NotifPermission> { return 'granted'; }
  async requestPermission(): Promise<NotifPermission> { return 'granted'; }
  async ensureChannels() {}
  async pendingIds() { return []; }
  async cancel() {}
  async schedule() {}
  async onTap(cb: (e: unknown) => void) { this.listeners.push(cb); return () => undefined; }
  async openSettings() {}
}

const payload = (scope: Scope, over: Partial<ReminderExtra> = {}): ReminderExtra => ({ v: 1, kind: 'scheduled', scope: fingerprint(scope), projectId: 'p1', instanceId: null, ...over });

describe('NotificationRouter', () => {
  const scope = signal<Scope>('user:a');
  const signedIn = signal(true);
  const guest = signal(false);
  let unlock!: () => void;
  let gate: Promise<void>;
  let initCalls: string[];
  let store: AppStore;
  let router: NotificationRouter;
  let tr: FakeTransport;
  const navigator = { open: vi.fn(async (): Promise<OpenTrackerResult> => 'opened') };
  const nav = { navigateRoot: vi.fn(async (_url: string) => true) };
  const ui = { say: vi.fn(async () => undefined), toast: vi.fn(), confirm: vi.fn() };
  const order: string[] = [];

  const lock = () => {
    gate = new Promise<void>((r) => (unlock = r));
  };

  beforeEach(async () => {
    scope.set('user:a');
    signedIn.set(true);
    guest.set(false);
    initCalls = [];
    order.length = 0;
    vi.clearAllMocks();
    navigator.open.mockImplementation(async () => (order.push('open'), 'opened' as OpenTrackerResult));
    nav.navigateRoot.mockImplementation(async (_url: string) => (order.push('navigateRoot'), true));
    gate = Promise.resolve();
    tr = new FakeTransport();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AppStore, NotificationRouter, LocalDb,
        { provide: ReminderTransport, useValue: tr },
        { provide: TrackerNavigator, useValue: navigator },
        { provide: NavController, useValue: nav },
        { provide: UiFeedback, useValue: ui },
        { provide: AuthService, useValue: { signedIn, guest, scope, init: async () => void (initCalls.push('init'), order.push('init')), untilUnlocked: () => (order.push('untilUnlocked'), gate) } },
      ],
    });
    store = TestBed.inject(AppStore);
    router = TestBed.inject(NotificationRouter);
    TestBed.tick();
    await store.whenScopeLoaded('user:a');
  });
  afterEach(() => vi.useRealTimers());

  describe('the happy path', () => {
    it('opens Project → active piece, after authentication initialised and the lock is open', async () => {
      expect(await router.handle(payload('user:a', { projectId: 'p1', instanceId: 'inst-2' }))).toBe('opened');
      expect(navigator.open).toHaveBeenCalledWith('p1', 'inst-2');
      expect(order).toEqual(['init', 'untilUnlocked', 'open']);
    });

    it('works for a guest session too', async () => {
      signedIn.set(false);
      guest.set(true);
      scope.set('guest');
      TestBed.tick();
      await store.whenScopeLoaded('guest');
      expect(await router.handle(payload('guest'))).toBe('opened');
    });

    it('a reminder without a project (nothing was in progress) opens the projects list', async () => {
      expect(await router.handle(payload('user:a', { projectId: null }))).toBe('projects');
      expect(nav.navigateRoot).toHaveBeenCalledWith('/tabs/projects');
      expect(navigator.open).not.toHaveBeenCalled();
    });
  });

  describe('biometric lock', () => {
    it('stays pending while the app is locked and navigates ONLY after the user unlocks (cold or warm start)', async () => {
      lock();
      const done = router.handle(payload('user:a'));
      await new Promise((r) => setTimeout(r, 20));
      expect(navigator.open).not.toHaveBeenCalled();
      expect(nav.navigateRoot).not.toHaveBeenCalled();
      unlock();
      expect(await done).toBe('opened');
      expect(order.indexOf('untilUnlocked')).toBeLessThan(order.indexOf('open'));
    });

    it('re-checks WHO is signed in after the unlock: an account switch during the wait cannot open the first account\'s data', async () => {
      lock();
      const done = router.handle(payload('user:a'));
      await new Promise((r) => setTimeout(r, 10));
      scope.set('user:b'); // while locked, a different account became active
      unlock();
      expect(await done).toBe('wrong-account');
      expect(navigator.open).not.toHaveBeenCalled();
    });
  });

  describe('authentication and account isolation', () => {
    it('does nothing when nobody is signed in: a notification never grants access, the normal start flow runs', async () => {
      signedIn.set(false);
      guest.set(false);
      expect(await router.handle(payload('user:a'))).toBe('blocked');
      expect(navigator.open).not.toHaveBeenCalled();
      expect(nav.navigateRoot).not.toHaveBeenCalled();
      expect(ui.say).not.toHaveBeenCalled();
    });

    it('refuses another account\'s notification and reveals nothing (no navigation, no toast, no state change)', async () => {
      const spy = vi.spyOn(store, 'setCurrentProject');
      const waited = vi.spyOn(store, 'whenScopeLoaded');
      expect(await router.handle(payload('user:SOMEONE-ELSE'))).toBe('wrong-account');
      expect(waited).not.toHaveBeenCalled(); // refused up front: this account's data is not even waited for
      expect(navigator.open).not.toHaveBeenCalled();
      expect(nav.navigateRoot).not.toHaveBeenCalled();
      expect(ui.say).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();
    });

    it('a guest notification is refused for a signed-in account and vice versa', async () => {
      expect(await router.handle(payload('guest'))).toBe('wrong-account');
      signedIn.set(false);
      guest.set(true);
      scope.set('guest');
      TestBed.tick();
      await store.whenScopeLoaded('guest');
      expect(await router.handle(payload('user:a'))).toBe('wrong-account');
    });

    it('a tap that arrives while the account\'s data is still loading (cold start) waits for it, then opens', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      store.loaded.set(false); // the store is mid-load, as right after launching from a notification
      const done = router.handle(payload('user:a'));
      await vi.advanceTimersByTimeAsync(300);
      expect(navigator.open).not.toHaveBeenCalled(); // nothing opens on half-loaded data
      store.loaded.set(true);
      await vi.advanceTimersByTimeAsync(50);
      expect(await done).toBe('opened');
      expect(navigator.open).toHaveBeenCalledTimes(1);
    });

    it('waits for the signed-in account\'s data and refuses if the store never holds that scope', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }); // whenScopeLoaded measures its timeout with Date.now()
      store.scope.set('user:other'); // data of a different identity is loaded
      const done = router.handle(payload('user:a'));
      await vi.advanceTimersByTimeAsync(5200);
      expect(await done).toBe('wrong-account');
      expect(navigator.open).not.toHaveBeenCalled();
    });
  });

  describe('project and piece validation', () => {
    it('a deleted project opens the list with a friendly message (no error page)', async () => {
      navigator.open.mockResolvedValueOnce('missing');
      expect(await router.handle(payload('user:a', { projectId: 'gone' }))).toBe('missing');
      expect(nav.navigateRoot).toHaveBeenCalledWith('/tabs/projects');
      expect(ui.say).toHaveBeenCalledWith('المشروع ده مش موجود تاني', 'That project is not here anymore');
    });

    it('a project finished since opens its page, not the counter', async () => {
      navigator.open.mockResolvedValueOnce('done');
      expect(await router.handle(payload('user:a', { projectId: 'p9' }))).toBe('done');
      expect(nav.navigateRoot).toHaveBeenCalledWith('/tabs/projects/p9');
    });
  });

  describe('untrusted payloads', () => {
    it.each([
      ['null', null], ['undefined', undefined], ['a string', 'p1'], ['a number', 7], ['an array', [1, 2]], ['an empty object', {}],
      ['a wrong version', { ...payload('user:a'), v: 2 }], ['no version', { kind: 'scheduled', scope: 'x', projectId: null, instanceId: null }],
      ['an unknown kind', { ...payload('user:a'), kind: 'attack' }], ['a non-string scope', { ...payload('user:a'), scope: 5 }],
      ['an empty scope', { ...payload('user:a'), scope: '' }], ['an oversized scope', { ...payload('user:a'), scope: 'x'.repeat(40) }],
      ['an object projectId', { ...payload('user:a'), projectId: { a: 1 } }], ['an empty projectId', { ...payload('user:a'), projectId: '' }],
      ['a huge projectId', { ...payload('user:a'), projectId: 'x'.repeat(500) }], ['a numeric instanceId', { ...payload('user:a'), instanceId: 3 }],
    ])('ignores %s', async (_name, raw) => {
      expect(await router.handle(raw)).toBe('ignored');
      expect(navigator.open).not.toHaveBeenCalled();
      expect(nav.navigateRoot).not.toHaveBeenCalled();
      expect(initCalls).toEqual([]); // not even authentication is touched for garbage
    });

    it('forwards only the validated fields — unknown extras are dropped and prototype pollution has no effect', async () => {
      const evil = JSON.parse(`{"__proto__":{"polluted":true},"v":1,"kind":"scheduled","scope":"${fingerprint('user:a')}","projectId":"p1","instanceId":null,"url":"https://evil.example","route":"/admin","extra":{"x":1}}`);
      expect(await router.handle(evil)).toBe('opened');
      expect(navigator.open).toHaveBeenCalledWith('p1', null);
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
      expect(nav.navigateRoot).not.toHaveBeenCalledWith('/admin');
    });

    it('parseReminderExtra returns a clean copy', () => {
      const p = parseReminderExtra({ ...payload('user:a'), junk: 1 });
      expect(p).toEqual({ v: 1, kind: 'scheduled', scope: fingerprint('user:a'), projectId: 'p1', instanceId: null });
      expect(Object.keys(p!)).toEqual(['v', 'kind', 'scope', 'projectId', 'instanceId']);
    });

    it('a notification can never navigate anywhere except the counter, a project page or the projects list', async () => {
      await router.handle(payload('user:a', { projectId: '../../auth/login' }));
      for (const call of nav.navigateRoot.mock.calls) expect(String(call[0])).toMatch(/^\/tabs\/(projects|tracker)/);
    });
  });

  describe('taps that arrive close together', () => {
    it('only the latest tap is acted on', async () => {
      lock();
      const first = router.handle(payload('user:a', { projectId: 'first' }));
      await new Promise((r) => setTimeout(r, 5));
      const second = router.handle(payload('user:a', { projectId: 'second' }));
      unlock();
      const waited = vi.spyOn(store, 'whenScopeLoaded');
      expect(await first).toBe('superseded');
      expect(await second).toBe('opened');
      expect(waited).toHaveBeenCalledTimes(1); // the stale tap stopped as soon as the lock opened: it never went on to touch the data
      expect(navigator.open).toHaveBeenCalledTimes(1);
      expect(navigator.open).toHaveBeenCalledWith('second', null);
    });
  });

  describe('start()', () => {
    it('registers exactly one listener, and a tap is routed', async () => {
      router.start();
      router.start();
      await Promise.resolve();
      expect(tr.listeners).toHaveLength(1);
      tr.listeners[0](payload('user:a'));
      await new Promise((r) => setTimeout(r, 20));
      expect(navigator.open).toHaveBeenCalledTimes(1);
    });

    it('registers nothing in a browser', () => {
      tr.native = false;
      router.start();
      expect(tr.listeners).toHaveLength(0);
    });
  });
});

describe('TrackerNavigator (the shared "Project → active piece" implementation)', () => {
  const setActive = vi.fn(async () => null);
  const switchInstance = vi.fn(async () => undefined);
  const setCurrent = vi.fn(async () => undefined);
  const navRoot = vi.fn(async () => true);
  let project: { id: string; status: string; parts?: { id: string; retired?: boolean }[] } | null;
  let navigatorSvc: TrackerNavigator;

  beforeEach(() => {
    vi.clearAllMocks();
    project = { id: 'p1', status: 'active', parts: [{ id: 'a' }, { id: 'b', retired: true }] };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        TrackerNavigator,
        { provide: AppStore, useValue: { project: () => project, setActiveInstance: setActive, setCurrentProject: setCurrent } },
        { provide: TimerService, useValue: { switchInstance } },
        { provide: NavController, useValue: { navigateRoot: navRoot } },
      ],
    });
    navigatorSvc = TestBed.inject(TrackerNavigator);
  });

  it('remembers the piece, moves a running timer with it, selects the project and opens the counter', async () => {
    expect(await navigatorSvc.open('p1', 'a')).toBe('opened');
    expect(setActive).toHaveBeenCalledWith('p1', 'a');
    expect(switchInstance).toHaveBeenCalledWith('p1', 'a');
    expect(setCurrent).toHaveBeenCalledWith('p1');
    expect(navRoot).toHaveBeenCalledWith('/tabs/tracker');
  });

  it('an unknown or retired piece is ignored (the counter opens on the current piece); a project without pieces just opens', async () => {
    await navigatorSvc.open('p1', 'b');
    await navigatorSvc.open('p1', 'zzz');
    expect(setActive).not.toHaveBeenCalled();
    expect(switchInstance).not.toHaveBeenCalled();
    expect(navRoot).toHaveBeenCalledTimes(2);
    project = { id: 'p1', status: 'active' };
    expect(await navigatorSvc.open('p1', 'a')).toBe('opened');
  });

  it('a missing project opens nothing; a finished one only when the user explicitly chose it', async () => {
    project = null;
    expect(await navigatorSvc.open('gone')).toBe('missing');
    project = { id: 'p1', status: 'done' };
    expect(await navigatorSvc.open('p1')).toBe('done');
    expect(navRoot).not.toHaveBeenCalled();
    expect(await navigatorSvc.open('p1', null, true)).toBe('opened');
    expect(navRoot).toHaveBeenCalledWith('/tabs/tracker');
  });
});

