import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  native: true,
  secure: new Map<string, string>(),
  prefs: new Map<string, string>(),
  secureFails: false,
  calls: [] as string[],
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => h.native } }));
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
    setSynchronize: async (v: boolean) => void h.calls.push(`sync:${v}`),
    setDefaultKeychainAccess: async (v: number) => void h.calls.push(`access:${v}`),
    get: async (k: string) => {
      if (h.secureFails) throw new Error('keystore unavailable');
      return h.secure.get(k) ?? null;
    },
    set: async (k: string, v: string) => {
      if (h.secureFails) throw new Error('keystore unavailable');
      h.secure.set(k, v);
    },
    remove: async (k: string) => void h.secure.delete(k),
  },
}));

import { SessionStore } from './session.store';

const session = { token: 'tok_1234567890', user: { id: 'u1', email: 'a@b.co', name: 'A' } };

beforeEach(() => {
  h.native = true;
  h.secure.clear();
  h.prefs.clear();
  h.secureFails = false;
  h.calls.length = 0;
});

describe('SessionStore on a native device', () => {
  it('stores the token in the secure store, never in Preferences', async () => {
    const s = new SessionStore();
    await s.save(session);
    expect(h.secure.get('gz.session')).toContain('tok_1234567890');
    expect(h.prefs.size).toBe(0);
    expect(s.token()).toBe('tok_1234567890');
  });

  it('disables iCloud sync and uses this-device-only keychain access', async () => {
    const s = new SessionStore();
    await s.save(session);
    expect(h.calls).toContain('sync:false');
    expect(h.calls).toContain('access:1');
  });

  it('restores the session from the secure store', async () => {
    h.secure.set('gz.session', JSON.stringify(session));
    const s = new SessionStore();
    expect(await s.load()).toEqual(session);
    expect(s.token()).toBe('tok_1234567890');
  });

  it('migrates a legacy plaintext token once, then removes it from Preferences', async () => {
    h.prefs.set('gz.session', JSON.stringify(session));
    const s = new SessionStore();
    expect(await s.load()).toEqual(session);
    expect(h.secure.get('gz.session')).toBeTruthy();
    expect(h.prefs.has('gz.session')).toBe(false);
  });

  it('clear() removes the token from both stores', async () => {
    h.secure.set('gz.session', JSON.stringify(session));
    h.prefs.set('gz.session', JSON.stringify(session));
    const s = new SessionStore();
    await s.load();
    await s.clear();
    expect(h.secure.size).toBe(0);
    expect(h.prefs.size).toBe(0);
    expect(s.token()).toBeNull();
  });

  it('never falls back to plaintext storage if the secure store fails (session stays in memory)', async () => {
    h.secureFails = true;
    const s = new SessionStore();
    await s.save(session);
    expect(h.prefs.size).toBe(0);
    expect(s.token()).toBe('tok_1234567890'); // usable for this run
    expect(await new SessionStore().load()).toBeNull(); // not persisted
  });

  it('rejects malformed stored data', async () => {
    h.secure.set('gz.session', '{"token":"","user":null}');
    expect(await new SessionStore().load()).toBeNull();
    h.secure.set('gz.session', 'not json');
    expect(await new SessionStore().load()).toBeNull();
  });
});

describe('SessionStore on the web', () => {
  it('uses Preferences (no secure store exists in browsers)', async () => {
    h.native = false;
    const s = new SessionStore();
    await s.save(session);
    expect(h.prefs.get('gz.session')).toContain('tok_1234567890');
    expect(h.secure.size).toBe(0);
    expect(await new SessionStore().load()).toEqual(session);
  });
});
