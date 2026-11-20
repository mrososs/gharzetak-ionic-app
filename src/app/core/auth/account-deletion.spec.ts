import { Injector, runInInjectionContext, signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ secure: new Map<string, string>(), prefs: new Map<string, string>() }));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: h.prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => void h.prefs.set(key, value),
    remove: async ({ key }: { key: string }) => void h.prefs.delete(key),
  },
}));
vi.mock('@aparajita/capacitor-secure-storage', () => ({
  KeychainAccess: { whenUnlockedThisDeviceOnly: 1 },
  SecureStorage: {
    setSynchronize: async () => undefined,
    setDefaultKeychainAccess: async () => undefined,
    get: async (k: string) => h.secure.get(k) ?? null,
    set: async (k: string, v: string) => void h.secure.set(k, v),
    remove: async (k: string) => void h.secure.delete(k),
  },
}));
vi.mock('@capgo/capacitor-native-biometric', () => ({
  AccessControl: { NONE: 0, BIOMETRY_CURRENT_SET: 1, BIOMETRY_ANY: 2 },
  BiometryType: {},
  NativeBiometric: { setData: async () => undefined, getSecureData: async () => ({ value: '' }), deleteData: async () => undefined },
}));
vi.mock('@capgo/capacitor-social-login', () => ({ SocialLogin: {} }));

import { ApiClient, ApiError } from '../api/api.client';
import { TimerService } from '../services/timer.service';
import { LocalDb } from '../storage/local-db';
import { AccountDeletionService } from './account-deletion.service';
import { AuthService } from './auth.service';
import { BiometricService } from './biometric.service';
import { GoogleAuthService, GoogleSignInError } from './google-auth.service';
import { SessionStore } from './session.store';

type Reply = { headers?: Record<string, string>; body?: unknown };
type Handler = (method: string, path: string, body: unknown, token?: string) => Reply | Promise<Reply>;

const user = { id: 'u1', email: 'gina@example.test', name: 'Gina' };

async function signedIn(handler: Handler, google: Partial<GoogleAuthService> = {}) {
  const calls: { method: string; path: string; body: unknown; token?: string }[] = [];
  const api = {
    configured: true,
    raw: vi.fn(async (method: string, path: string, body?: unknown, _auth = true, token?: string) => {
      calls.push({ method, path, body, token });
      const r = await handler(method, path, body, token);
      return { headers: { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null }, body: r.body };
    }),
  };
  const store = new SessionStore();
  const googleSvc = { available: true, getCredential: vi.fn(async () => ({ idToken: 'g.id.token', nonce: 'n1' })), ...google };
  const injector = Injector.create({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: SessionStore, useValue: store },
      { provide: BiometricService, useValue: { supported: false } },
      { provide: GoogleAuthService, useValue: googleSvc },
    ],
  });
  const auth = runInInjectionContext(injector, () => new AuthService());
  await store.save({ token: 'tok-old', user });
  auth.session.set({ token: 'tok-old', user });
  return { auth, store, api, calls, googleSvc };
}

const apiErr = (status: number, code: string) => new ApiError(status, code, code);
const okReply = (storageCleanup?: string): Reply => ({ body: { success: true, message: 'User deleted', ...(storageCleanup ? { storageCleanup } : {}) } });

beforeEach(() => {
  h.secure.clear();
  h.prefs.clear();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('AuthService.requestAccountDeletion (the remote half)', () => {
  it('sends the password to the delete endpoint and reports success only from the server answer', async () => {
    const { auth, calls } = await signedIn(() => okReply('complete'));
    expect(await auth.requestAccountDeletion('hunter2-pass')).toEqual({ ok: true, storageCleanup: 'complete' });
    expect(calls.at(-1)).toMatchObject({ method: 'POST', path: '/api/auth/delete-user', body: { password: 'hunter2-pass' } });
    expect(auth.session()).not.toBeNull(); // the session is ended by finishAccountDeletion, not here
  });

  it('never claims "complete" unless the server said so', async () => {
    expect(await (await signedIn(() => okReply('pending'))).auth.requestAccountDeletion('p')).toEqual({ ok: true, storageCleanup: 'pending' });
    expect(await (await signedIn(() => okReply())).auth.requestAccountDeletion('p')).toEqual({ ok: true, storageCleanup: 'pending' });
  });

  it('an answer without success:true is a failure, not a success', async () => {
    expect(await (await signedIn(() => ({ body: { success: false } }))).auth.requestAccountDeletion('p')).toEqual({ ok: false, failure: 'failed' });
    expect(await (await signedIn(() => ({ body: null }))).auth.requestAccountDeletion('p')).toEqual({ ok: false, failure: 'failed' });
  });

  it.each([
    [400, 'INVALID_PASSWORD', 'wrongPassword'],
    [429, 'http_429', 'tooMany'],
    [503, 'http_503', 'unavailable'],
    [401, 'http_401', 'sessionEnded'],
    [0, 'network', 'offline'],
    [504, 'http_504', 'offline'],
    [500, 'http_500', 'failed'],
  ])('maps server answer %s %s to %s', async (status, code, failure) => {
    const { auth } = await signedIn(() => {
      throw apiErr(status, code);
    });
    expect(await auth.requestAccountDeletion('p')).toEqual({ ok: false, failure });
  });

  it('without a password and without Google, an old session asks the person to sign in again (nothing deleted)', async () => {
    const { auth, calls } = await signedIn(
      () => {
        throw apiErr(400, 'SESSION_EXPIRED');
      },
      { available: false },
    );
    expect(await auth.requestAccountDeletion(null)).toEqual({ ok: false, failure: 'reauthRequired' });
    expect(calls.filter((c) => c.path.includes('sign-in/social'))).toHaveLength(0);
  });

  it('Google-only account with an old session: re-authenticates with Google (same account), adopts the fresh session and retries', async () => {
    let deletes = 0;
    const { auth, store, calls, googleSvc } = await signedIn((_m, path) => {
      if (path === '/api/auth/delete-user') {
        deletes++;
        if (deletes === 1) throw apiErr(400, 'SESSION_EXPIRED');
        return okReply('complete');
      }
      if (path === '/api/auth/sign-in/social') return { headers: { 'set-auth-token': 'tok-fresh' }, body: { user } };
      return { body: null };
    });
    expect(await auth.requestAccountDeletion(null)).toEqual({ ok: true, storageCleanup: 'complete' });
    expect(googleSvc.getCredential).toHaveBeenCalledTimes(1);
    expect(deletes).toBe(2);
    expect(store.token()).toBe('tok-fresh');
    expect(calls.map((c) => c.path)).toEqual(['/api/auth/delete-user', '/api/auth/sign-in/social', '/api/auth/delete-user']);
  });

  it('a cancelled Google picker deletes nothing', async () => {
    const { auth, calls } = await signedIn(
      () => {
        throw apiErr(400, 'SESSION_EXPIRED');
      },
      {
        getCredential: vi.fn(async () => {
          throw new GoogleSignInError('cancelled');
        }),
      },
    );
    expect(await auth.requestAccountDeletion(null)).toEqual({ ok: false, failure: 'googleCancelled' });
    expect(calls.filter((c) => c.path === '/api/auth/delete-user')).toHaveLength(1);
  });

  it('a DIFFERENT Google account is refused: the stray session is discarded and never adopted; a just-created stray account is removed', async () => {
    const stranger = { id: 'u-stranger', email: 'other@example.test', name: 'Other' };
    const now = new Date().toISOString();
    const { auth, store, calls } = await signedIn((_m, path, _b, token) => {
      if (path === '/api/auth/delete-user' && !token) throw apiErr(400, 'SESSION_EXPIRED');
      if (path === '/api/auth/sign-in/social') return { headers: { 'set-auth-token': 'tok-stranger' }, body: { user: stranger } };
      if (path === '/api/auth/get-session') return { body: { session: { createdAt: now }, user: { createdAt: now } } };
      return { body: { success: true } };
    });
    expect(await auth.requestAccountDeletion(null)).toEqual({ ok: false, failure: 'otherAccount' });
    expect(store.token()).toBe('tok-old'); // the real session is untouched
    expect(auth.session()?.user.id).toBe('u1');
    const stray = calls.filter((c) => c.token === 'tok-stranger');
    expect(stray.map((c) => c.path)).toEqual(['/api/auth/get-session', '/api/auth/delete-user']);
  });

  it('a different but ALREADY EXISTING Google account is only signed out, never deleted', async () => {
    const stranger = { id: 'u-stranger', email: 'other@example.test', name: 'Other' };
    const { auth, calls } = await signedIn((_m, path, _b, token) => {
      if (path === '/api/auth/delete-user' && !token) throw apiErr(400, 'SESSION_EXPIRED');
      if (path === '/api/auth/sign-in/social') return { headers: { 'set-auth-token': 'tok-stranger' }, body: { user: stranger } };
      if (path === '/api/auth/get-session') return { body: { session: { createdAt: new Date().toISOString() }, user: { createdAt: '2020-01-01T00:00:00Z' } } };
      return { body: { success: true } };
    });
    expect(await auth.requestAccountDeletion(null)).toEqual({ ok: false, failure: 'otherAccount' });
    expect(calls.filter((c) => c.token === 'tok-stranger').map((c) => c.path)).toEqual(['/api/auth/get-session', '/api/auth/sign-out']);
  });

  it('is unavailable without a session or backend', async () => {
    const { auth } = await signedIn(() => okReply('complete'));
    auth.session.set(null);
    expect(await auth.requestAccountDeletion('p')).toEqual({ ok: false, failure: 'unavailable' });
  });
});

describe('AuthService.accountKinds', () => {
  it('reports which sign-in methods the account has', async () => {
    const both = await signedIn(() => ({ body: [{ providerId: 'credential' }, { providerId: 'google' }] }));
    expect(await both.auth.accountKinds()).toEqual({ password: true, google: true });
    const g = await signedIn(() => ({ body: [{ providerId: 'google' }] }));
    expect(await g.auth.accountKinds()).toEqual({ password: false, google: true });
  });
  it('returns null when it cannot be determined', async () => {
    const { auth } = await signedIn(() => {
      throw apiErr(0, 'network');
    });
    expect(await auth.accountKinds()).toBeNull();
  });
});

describe('AccountDeletionService (remote first, then local)', () => {
  function build(requestResult: unknown, clearScope = vi.fn(async (_scope: string) => undefined)) {
    const finish = vi.fn(async () => undefined);
    const deleting = signal(false);
    const request = vi.fn(async () => requestResult);
    const authStub = { user: () => user, deleting, requestAccountDeletion: request, finishAccountDeletion: finish };
    const injector = Injector.create({
      providers: [
        { provide: AuthService, useValue: authStub },
        { provide: LocalDb, useValue: { clearScope } },
        { provide: TimerService, useValue: { stop: vi.fn(async () => undefined) } },
      ],
    });
    const svc = runInInjectionContext(injector, () => new AccountDeletionService());
    return { svc, clearScope, finish, deleting, request };
  }

  it('after a confirmed deletion: erases ONLY this account scope, its per-account flag, ends the session', async () => {
    localStorage.setItem('gz.bio.declined.u1', '1');
    localStorage.setItem('gz.bio.declined.someone-else', '1');
    const { svc, clearScope, finish, deleting } = build({ ok: true, storageCleanup: 'complete' });
    expect(await svc.delete('pw')).toEqual({ ok: true, storageCleanup: 'complete', localCleanup: 'done' });
    expect(clearScope.mock.calls.map((c) => c[0])).toEqual(['user:u1', 'user:u1']);
    expect(clearScope).not.toHaveBeenCalledWith('guest'); // guest data is a different scope and is never erased
    expect(localStorage.getItem('gz.bio.declined.u1')).toBeNull();
    expect(localStorage.getItem('gz.bio.declined.someone-else')).toBe('1');
    expect(finish).toHaveBeenCalledTimes(1);
    expect(deleting()).toBe(true); // stays paused until finishAccountDeletion resets it (stubbed here)
    expect(svc.busy()).toBe(false);
  });

  it.each(['wrongPassword', 'offline', 'sessionEnded', 'failed', 'tooMany', 'unavailable'])('on failure "%s" nothing local is touched and sync resumes', async (failure) => {
    const { svc, clearScope, finish, deleting } = build({ ok: false, failure });
    expect(await svc.delete('pw')).toEqual({ ok: false, failure });
    expect(clearScope).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    expect(deleting()).toBe(false);
    expect(svc.busy()).toBe(false);
  });

  it('prevents a double submit: the second call is refused while the first is running and only one request is sent', async () => {
    let release!: (v: unknown) => void;
    const gate = new Promise((r) => (release = r));
    const finish = vi.fn(async () => undefined);
    const request = vi.fn(() => gate);
    const injector = Injector.create({
      providers: [
        { provide: AuthService, useValue: { user: () => user, deleting: signal(false), requestAccountDeletion: request, finishAccountDeletion: finish } },
        { provide: LocalDb, useValue: { clearScope: vi.fn(async () => undefined) } },
        { provide: TimerService, useValue: { stop: vi.fn(async () => undefined) } },
      ],
    });
    const svc = runInInjectionContext(injector, () => new AccountDeletionService());
    const first = svc.delete('pw');
    expect(svc.busy()).toBe(true);
    expect(await svc.delete('pw')).toEqual({ ok: false, failure: 'busy' });
    release({ ok: false, failure: 'failed' });
    await first;
    expect(request).toHaveBeenCalledTimes(1);
    expect(svc.busy()).toBe(false);
  });

  it('reports a local cleanup failure honestly while the remote deletion stands', async () => {
    const { svc, finish } = build({ ok: true, storageCleanup: 'pending' }, vi.fn(async () => { throw new Error('IndexedDB blocked'); }));
    expect(await svc.delete('pw')).toEqual({ ok: true, storageCleanup: 'pending', localCleanup: 'failed' });
    expect(finish).toHaveBeenCalledTimes(1); // the session still ends: the account no longer exists
  });

  it('does nothing without a signed-in account (guest)', async () => {
    const { svc, request } = build({ ok: true, storageCleanup: 'complete' });
    const guest = Injector.create({
      providers: [
        { provide: AuthService, useValue: { user: () => null, deleting: signal(false), requestAccountDeletion: request, finishAccountDeletion: vi.fn() } },
        { provide: LocalDb, useValue: { clearScope: vi.fn() } },
        { provide: TimerService, useValue: { stop: vi.fn() } },
      ],
    });
    const gs = runInInjectionContext(guest, () => new AccountDeletionService());
    expect(await gs.delete(null)).toEqual({ ok: false, failure: 'unavailable' });
    expect(request).not.toHaveBeenCalled();
    expect(svc).toBeTruthy();
  });
});
