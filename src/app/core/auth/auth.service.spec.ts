import { Injector, runInInjectionContext } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  secure: new Map<string, string>(),
  prefs: new Map<string, string>(),
  bio: new Map<string, string>(),
  bioFail: null as null | { code: number; message: string },
}));

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
  BiometryType: { NONE: 0, TOUCH_ID: 1, FACE_ID: 2, FINGERPRINT: 3, FACE_AUTHENTICATION: 4, IRIS_AUTHENTICATION: 5, MULTIPLE: 6, DEVICE_CREDENTIAL: 7 },
  NativeBiometric: {
    setData: async (o: { key: string; value: string }) => {
      if (h.bioFail) throw h.bioFail;
      h.bio.set(o.key, o.value);
    },
    getSecureData: async (o: { key: string }) => {
      if (h.bioFail) throw h.bioFail;
      const v = h.bio.get(o.key);
      if (v === undefined) throw { code: 21, message: 'No protected data found' };
      return { value: v };
    },
    deleteData: async (o: { key: string }) => void h.bio.delete(o.key),
  },
}));
vi.mock('@capgo/capacitor-social-login', () => ({ SocialLogin: {} }));

import { ApiClient, ApiError } from '../api/api.client';
import { AuthService } from './auth.service';
import { BiometricService } from './biometric.service';
import { GoogleAuthService, GoogleSignInError } from './google-auth.service';
import { SessionStore } from './session.store';

interface Reply {
  headers?: Record<string, string>;
  body?: unknown;
}
type Handler = (path: string, body: unknown) => Reply | Promise<Reply>;

const user = { id: 'u1', email: 'gina@gmail.test', name: 'Gina' };
const sessionBody = (userCreatedAt: string, sessionCreatedAt: string) => ({ session: { createdAt: sessionCreatedAt }, user: { id: 'u1', email: user.email, name: user.name, createdAt: userCreatedAt } });

function setup(handler: Handler, google: Partial<GoogleAuthService> = {}) {
  const calls: { method: string; path: string; body: unknown; auth: boolean }[] = [];
  const api = {
    configured: true,
    raw: vi.fn(async (method: string, path: string, body?: unknown, auth = true) => {
      calls.push({ method, path, body, auth });
      const r = await handler(path, body);
      return { headers: { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null }, body: r.body };
    }),
  };
  const store = new SessionStore();
  const bio = { supported: true, check: async () => ({ available: true, kind: 'fingerprint' }), prompt: () => ({ title: 'Unlock', cancel: 'Cancel' }) };
  const googleSvc = { available: true, getCredential: vi.fn(async () => ({ idToken: 'google.id.token', nonce: 'n-123' })), ...google };
  const injector = Injector.create({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: SessionStore, useValue: store },
      { provide: BiometricService, useValue: bio },
      { provide: GoogleAuthService, useValue: googleSvc },
    ],
  });
  const auth = runInInjectionContext(injector, () => new AuthService());
  return { auth, store, api, calls, googleSvc };
}

beforeEach(() => {
  h.secure.clear();
  h.prefs.clear();
  h.bio.clear();
  h.bioFail = null;
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

describe('Google sign-in', () => {
  it('sends the Google ID token + nonce to Better Auth, adopts the bearer session and stores it securely', async () => {
    const { auth, store, calls } = setup((path) =>
      path === '/api/auth/sign-in/social' ? { headers: { 'set-auth-token': 'bearer-abc' }, body: { redirect: false, token: 'bearer-abc', user } } : { body: sessionBody('2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z') },
    );
    const r = await auth.signInWithGoogle();

    expect(r).toMatchObject({ ok: true, isNew: false });
    const post = calls.find((c) => c.path === '/api/auth/sign-in/social')!;
    expect(post).toMatchObject({ method: 'POST', auth: false, body: { provider: 'google', idToken: { token: 'google.id.token', nonce: 'n-123' } } });
    expect(auth.signedIn()).toBe(true);
    expect(auth.user()).toEqual(user);
    expect(auth.scope()).toBe('user:u1');
    expect(store.token()).toBe('bearer-abc');
    expect(h.secure.get('gz.session')).toContain('bearer-abc'); // secure store, never Preferences
    expect(h.prefs.size).toBe(0);
    // the Google ID token itself is never persisted
    expect([...h.secure.values(), ...h.prefs.values(), ...h.bio.values()].join('|')).not.toContain('google.id.token');
  });

  it('falls back to the response body token when the header is absent', async () => {
    const { auth } = setup((path) => (path === '/api/auth/sign-in/social' ? { body: { token: 'body-token', user } } : { body: sessionBody('2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z') }));
    expect((await auth.signInWithGoogle()).ok).toBe(true);
    expect(auth.session()?.token).toBe('body-token');
  });

  it('flags a brand-new account (user created moments before the session) so the setup flow runs', async () => {
    const { auth } = setup((path) =>
      path === '/api/auth/sign-in/social' ? { headers: { 'set-auth-token': 't' }, body: { user } } : { body: sessionBody('2026-06-01T10:00:00Z', '2026-06-01T10:00:02Z') },
    );
    expect(await auth.signInWithGoogle()).toMatchObject({ ok: true, isNew: true });
  });

  it('treats a cancelled account picker as a silent non-event (no API call, no session)', async () => {
    const { auth, api } = setup(() => ({}), {
      getCredential: vi.fn(async () => {
        throw new GoogleSignInError('cancelled');
      }),
    });
    expect(await auth.signInWithGoogle()).toEqual({ ok: false, cancelled: true });
    expect(api.raw).not.toHaveBeenCalled();
    expect(auth.signedIn()).toBe(false);
  });

  it('reports a Google/plugin failure without touching the session', async () => {
    const { auth, api } = setup(() => ({}), {
      getCredential: vi.fn(async () => {
        throw new GoogleSignInError('failed');
      }),
    });
    expect(await auth.signInWithGoogle()).toEqual({ ok: false, error: 'errGoogleFailed' });
    expect(api.raw).not.toHaveBeenCalled();
  });

  it('maps a rejected ID token (wrong audience / expired / forged) to a Google error and stays signed out', async () => {
    const { auth } = setup(() => {
      throw new ApiError(401, 'INVALID_TOKEN', 'Invalid token');
    });
    expect(await auth.signInWithGoogle()).toEqual({ ok: false, error: 'errGoogleFailed' });
    expect(auth.signedIn()).toBe(false);
    expect(h.secure.size).toBe(0);
  });

  it('explains an email that belongs to an unverified password account (never silently linked)', async () => {
    const { auth } = setup(() => {
      throw new ApiError(401, 'OAUTH_LINK_ERROR', 'account not linked');
    });
    expect(await auth.signInWithGoogle()).toEqual({ ok: false, error: 'errGoogleNotLinked' });
  });

  it('reports a network failure as such', async () => {
    const { auth } = setup(() => {
      throw new ApiError(0, 'network', 'offline');
    });
    expect(await auth.signInWithGoogle()).toEqual({ ok: false, error: 'errNetwork' });
  });

  it('is only offered where it can really run (native + client id + backend)', () => {
    expect(setup(() => ({})).auth.googleAvailable).toBe(true);
    expect(setup(() => ({}), { available: false }).auth.googleAvailable).toBe(false);
  });
});

describe('biometric lock', () => {
  const stored = { token: 'tok-protected', user };

  async function protectedApp(handler: Handler = () => ({ body: { user } })) {
    const ctx = setup(handler);
    h.secure.set('gz.bio', '1');
    h.bio.set('gz.session.bio', JSON.stringify(stored));
    await ctx.auth.init(); // a cold start with biometric unlock already on
    return ctx;
  }

  it('cold start with protection ON: locked, no session, no token in memory, NO API call', async () => {
    const { auth, store, api } = await protectedApp();
    expect(auth.locked()).toBe(true);
    expect(auth.session()).toBeNull();
    expect(auth.signedIn()).toBe(false);
    expect(store.token()).toBeNull();
    expect(api.raw).not.toHaveBeenCalled();
  });

  it('route guards wait: untilUnlocked() stays pending until the user unlocks', async () => {
    const { auth } = await protectedApp();
    let released = false;
    void auth.untilUnlocked().then(() => (released = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(released).toBe(false);
    expect((await auth.unlock()).ok).toBe(true);
    await auth.untilUnlocked();
    expect(released).toBe(true);
  });

  it('a correct biometric check unlocks, restores the session and validates it with the server', async () => {
    const { auth, store, calls } = await protectedApp();
    const r = await auth.unlock();
    expect(r).toEqual({ ok: true });
    expect(auth.locked()).toBe(false);
    expect(auth.user()).toEqual(user);
    expect(store.token()).toBe('tok-protected');
    expect(calls.some((c) => c.path === '/api/auth/get-session')).toBe(true);
  });

  it('cancelling the prompt keeps the app locked and exposes nothing', async () => {
    const { auth, store, api } = await protectedApp();
    h.bioFail = { code: 16, message: 'user cancel' };
    expect(await auth.unlock()).toEqual({ ok: false, reason: 'cancelled' });
    expect(auth.locked()).toBe(true);
    expect(auth.session()).toBeNull();
    expect(store.token()).toBeNull();
    expect(api.raw).not.toHaveBeenCalled();
  });

  it('a failed fingerprint and a lockout keep the app locked', async () => {
    const { auth } = await protectedApp();
    h.bioFail = { code: 10, message: 'no match' };
    expect(await auth.unlock()).toEqual({ ok: false, reason: 'failed' });
    h.bioFail = { code: 4, message: 'temporary lockout' };
    expect(await auth.unlock()).toEqual({ ok: false, reason: 'lockout' });
    expect(auth.locked()).toBe(true);
    expect(auth.session()).toBeNull();
  });

  it('changed biometrics (entry invalidated): the protected session is wiped and a normal sign-in is required', async () => {
    const { auth } = await protectedApp();
    h.bio.clear(); // the Keystore entry no longer exists
    expect(await auth.unlock()).toEqual({ ok: false, reason: 'invalidated' });
    expect(auth.locked()).toBe(false);
    expect(auth.signedIn()).toBe(false);
    expect(h.secure.has('gz.bio')).toBe(false);
    expect(h.secure.size).toBe(0);
  });

  it('an expired/revoked server session ends at unlock and requires a normal login (nothing stays on the device)', async () => {
    const { auth, store } = await protectedApp(() => {
      throw new ApiError(401, 'UNAUTHORIZED', 'expired');
    });
    expect(await auth.unlock()).toEqual({ ok: false, reason: 'expired' });
    expect(auth.signedIn()).toBe(false);
    expect(auth.locked()).toBe(false);
    expect(store.token()).toBeNull();
    expect(h.bio.size).toBe(0);
    expect(h.secure.size).toBe(0);
  });

  it('offline unlock works for the cached session (the server still authorises every API call)', async () => {
    const { auth } = await protectedApp(() => {
      throw new ApiError(0, 'network', 'offline');
    });
    expect((await auth.unlock()).ok).toBe(true);
    expect(auth.signedIn()).toBe(true);
    expect(auth.locked()).toBe(false);
  });

  it('re-lock of a running session: needs the biometric again and must be the same session', async () => {
    const { auth } = await protectedApp();
    await auth.unlock();
    auth.lock();
    expect(auth.locked()).toBe(true);
    expect(auth.signedIn()).toBe(true); // the session object stays; the UI is covered and routes wait
    expect(await auth.unlock()).toEqual({ ok: true });
    expect(auth.locked()).toBe(false);
  });

  it('re-lock with a mismatching protected session is treated as invalid', async () => {
    const { auth } = await protectedApp();
    await auth.unlock();
    auth.lock();
    h.bio.set('gz.session.bio', JSON.stringify({ token: 'someone-else', user }));
    expect(await auth.unlock()).toEqual({ ok: false, reason: 'invalidated' });
    expect(auth.signedIn()).toBe(false);
  });

  it('no lock is ever created when biometric unlock is off', async () => {
    const { auth } = setup(() => ({ body: { user } }));
    h.secure.set('gz.session', JSON.stringify(stored));
    await auth.init();
    expect(auth.locked()).toBe(false);
    expect(auth.signedIn()).toBe(true);
    auth.lock();
    expect(auth.locked()).toBe(false);
  });
});

describe('enabling / disabling biometric unlock', () => {
  async function signedIn() {
    const ctx = setup(() => ({ headers: { 'set-auth-token': 'tok-1' }, body: { user } }));
    await ctx.auth.signIn('gina@gmail.test', 'pw-12345678');
    return ctx;
  }

  it('enable asks the OS for a real biometric (the protected write) and moves the session out of the plain store', async () => {
    const { auth, store } = await signedIn();
    expect(h.secure.get('gz.session')).toContain('tok-1');
    expect(await auth.enableBiometrics()).toEqual({ ok: true });
    expect(auth.biometricEnabled()).toBe(true);
    expect(store.biometric()).toBe(true);
    expect(h.secure.has('gz.session')).toBe(false);
    expect(h.bio.get('gz.session.bio')).toContain('tok-1');
  });

  it('enable fails safely when the user cancels or the sensor is unavailable (nothing changes)', async () => {
    const { auth } = await signedIn();
    h.bioFail = { code: 16, message: 'cancel' };
    expect(await auth.enableBiometrics()).toEqual({ ok: false, reason: 'cancelled' });
    h.bioFail = { code: 3, message: 'none enrolled' };
    expect(await auth.enableBiometrics()).toEqual({ ok: false, reason: 'notEnrolled' });
    expect(auth.biometricEnabled()).toBe(false);
    expect(h.secure.get('gz.session')).toContain('tok-1');
    expect(h.bio.size).toBe(0);
  });

  it('cannot be enabled without a signed-in session', async () => {
    const { auth } = setup(() => ({}));
    expect(await auth.enableBiometrics()).toEqual({ ok: false, reason: 'noSession' });
  });

  it('disable re-authenticates with the fingerprint and restores the normal secure session', async () => {
    const { auth } = await signedIn();
    await auth.enableBiometrics();
    h.bioFail = { code: 10, message: 'wrong finger' };
    expect(await auth.disableBiometrics()).toEqual({ ok: false, reason: 'failed' });
    expect(auth.biometricEnabled()).toBe(true); // still protected
    h.bioFail = null;
    expect(await auth.disableBiometrics()).toEqual({ ok: true });
    expect(auth.biometricEnabled()).toBe(false);
    expect(h.secure.get('gz.session')).toContain('tok-1');
    expect(h.bio.size).toBe(0);
    expect(h.secure.has('gz.bio')).toBe(false);
  });

  it('disable still works after an enrollment change invalidated the entry (live session kept in the normal store)', async () => {
    const { auth } = await signedIn();
    await auth.enableBiometrics();
    h.bio.clear();
    expect(await auth.disableBiometrics()).toEqual({ ok: true });
    expect(h.secure.get('gz.session')).toContain('tok-1');
    expect(auth.biometricEnabled()).toBe(false);
  });

  it('logout clears every stored credential: plain, protected and the flag', async () => {
    const { auth, store } = await signedIn();
    await auth.enableBiometrics();
    await auth.signOut();
    expect(h.secure.size).toBe(0);
    expect(h.bio.size).toBe(0);
    expect(h.prefs.size).toBe(0);
    expect(store.token()).toBeNull();
    expect(auth.signedIn()).toBe(false);
    expect(auth.biometricEnabled()).toBe(false);
  });

  it('"sign in another way" from the lock screen forgets the protected session', async () => {
    const { auth } = setup(() => ({}));
    h.secure.set('gz.bio', '1');
    h.bio.set('gz.session.bio', JSON.stringify({ token: 't', user }));
    await auth.init();
    expect(auth.locked()).toBe(true);
    await auth.abandonLock();
    expect(auth.locked()).toBe(false);
    expect(h.bio.size).toBe(0);
    expect(h.secure.size).toBe(0);
  });
});
