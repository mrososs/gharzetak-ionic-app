import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  native: true,
  secure: new Map<string, string>(),
  prefs: new Map<string, string>(),
  secureFails: false,
  calls: [] as string[],
  bio: new Map<string, string>(),
  bioFail: null as null | { code: number; message: string },
  bioOps: [] as { op: string; accessControl?: number; authValidity?: number }[],
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

vi.mock('@capgo/capacitor-native-biometric', () => ({
  AccessControl: { NONE: 0, BIOMETRY_CURRENT_SET: 1, BIOMETRY_ANY: 2 },
  BiometryType: { NONE: 0, TOUCH_ID: 1, FACE_ID: 2, FINGERPRINT: 3, FACE_AUTHENTICATION: 4, IRIS_AUTHENTICATION: 5, MULTIPLE: 6, DEVICE_CREDENTIAL: 7 },
  NativeBiometric: {
    setData: async (o: { key: string; value: string; accessControl?: number; authValidityDuration?: number }) => {
      if (h.bioFail) throw h.bioFail;
      h.bioOps.push({ op: 'set', accessControl: o.accessControl, authValidity: o.authValidityDuration });
      h.bio.set(o.key, o.value);
    },
    getSecureData: async (o: { key: string }) => {
      if (h.bioFail) throw h.bioFail;
      const v = h.bio.get(o.key);
      if (v === undefined) throw { code: 21, message: 'No protected data found' };
      h.bioOps.push({ op: 'get' });
      return { value: v };
    },
    deleteData: async (o: { key: string }) => void h.bio.delete(o.key),
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
  h.bio.clear();
  h.bioFail = null;
  h.bioOps.length = 0;
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

const prompt = { title: 'Unlock', cancel: 'Cancel' };

describe('SessionStore biometric protection (native)', () => {
  it('protects the session behind BIOMETRY_CURRENT_SET with a fresh check per read, then removes the plain copy', async () => {
    const s = new SessionStore();
    await s.save(session);
    expect(h.secure.get('gz.session')).toContain('tok_1234567890');

    await s.protectWithBiometrics(session, prompt);

    expect(h.bioOps[0]).toEqual({ op: 'set', accessControl: 1, authValidity: 0 }); // current-set, no validity window
    expect(h.bio.get('gz.session.bio')).toContain('tok_1234567890');
    expect(h.secure.has('gz.session')).toBe(false); // the unprotected copy is gone
    expect(h.secure.get('gz.bio')).toBe('1');
    expect(h.prefs.size).toBe(0);
    expect(s.biometric()).toBe(true);
  });

  it('a cancelled or failed prompt changes NOTHING (plain session stays, protection stays off)', async () => {
    const s = new SessionStore();
    await s.save(session);
    h.bioFail = { code: 16, message: 'user cancel' };
    await expect(s.protectWithBiometrics(session, prompt)).rejects.toMatchObject({ kind: 'cancelled' });
    expect(h.secure.get('gz.session')).toContain('tok_1234567890');
    expect(h.secure.has('gz.bio')).toBe(false);
    expect(h.bio.size).toBe(0);
    expect(s.biometric()).toBe(false);
  });

  it('starts locked: load() returns no session and never reads the token while protection is on', async () => {
    const s = new SessionStore();
    await s.save(session);
    await s.protectWithBiometrics(session, prompt);

    const fresh = new SessionStore(); // simulates an app restart
    expect(await fresh.load()).toBeNull();
    expect(fresh.biometric()).toBe(true);
    expect(fresh.token()).toBeNull(); // not even in memory until the biometric check passes
  });

  it('readProtected releases the session only through the biometric-bound read', async () => {
    const s = new SessionStore();
    await s.save(session);
    await s.protectWithBiometrics(session, prompt);
    expect(await new SessionStore().readProtected(prompt)).toEqual(session);
    expect(h.bioOps.filter((o) => o.op === 'get')).toHaveLength(1);
  });

  it('maps cancel, failed match, lockout and enrollment change to distinct outcomes', async () => {
    const s = new SessionStore();
    await s.save(session);
    await s.protectWithBiometrics(session, prompt);
    for (const [code, kind] of [[16, 'cancelled'], [10, 'failed'], [2, 'lockout'], [4, 'lockout'], [3, 'notEnrolled'], [1, 'unavailable']] as const) {
      h.bioFail = { code, message: 'x' };
      await expect(s.readProtected(prompt)).rejects.toMatchObject({ kind });
    }
    h.bioFail = null;
    h.bio.clear(); // biometrics changed -> the Keystore entry is invalidated
    await expect(s.readProtected(prompt)).rejects.toMatchObject({ kind: 'invalidated' });
  });

  it('rejects a corrupted protected value as invalidated', async () => {
    h.bio.set('gz.session.bio', '{"token":""}');
    await expect(new SessionStore().readProtected(prompt)).rejects.toMatchObject({ kind: 'invalidated' });
  });

  it('disableBiometrics(restore) puts the session back in the normal store and removes the protected copy + flag', async () => {
    const s = new SessionStore();
    await s.save(session);
    await s.protectWithBiometrics(session, prompt);
    await s.disableBiometrics(session);
    expect(h.secure.get('gz.session')).toContain('tok_1234567890');
    expect(h.secure.has('gz.bio')).toBe(false);
    expect(h.bio.size).toBe(0);
    expect(s.biometric()).toBe(false);
    expect(h.prefs.size).toBe(0); // never plaintext
  });

  it('clear() (logout / expiry / account switch) wipes the protected session, the flag and the token', async () => {
    const s = new SessionStore();
    await s.save(session);
    await s.protectWithBiometrics(session, prompt);
    await s.clear();
    expect(h.bio.size).toBe(0);
    expect(h.secure.size).toBe(0);
    expect(h.prefs.size).toBe(0);
    expect(s.token()).toBeNull();
    expect(s.biometric()).toBe(false);
    expect(await new SessionStore().load()).toBeNull();
  });

  it('a refreshed profile of the SAME session is not re-written (no extra biometric prompt, no plain copy)', async () => {
    const s = new SessionStore();
    await s.save(session);
    await s.protectWithBiometrics(session, prompt);
    h.bioOps.length = 0;
    await s.save({ ...session, user: { ...session.user, name: 'Renamed' } });
    expect(h.bioOps).toHaveLength(0);
    expect(h.secure.has('gz.session')).toBe(false);
  });

  it('a DIFFERENT session (account switch) drops the old protection instead of mixing sessions', async () => {
    const s = new SessionStore();
    await s.save(session);
    await s.protectWithBiometrics(session, prompt);
    await s.save({ token: 'tok_other_account', user: { id: 'u2', email: 'x@y.co', name: 'B' } });
    expect(s.biometric()).toBe(false);
    expect(h.bio.size).toBe(0);
    expect(h.secure.get('gz.session')).toContain('tok_other_account');
  });

  it('is unavailable on the web: nothing is stored and the request is refused', async () => {
    h.native = false;
    const s = new SessionStore();
    await expect(s.protectWithBiometrics(session, prompt)).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(s.readProtected(prompt)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(h.bio.size).toBe(0);
  });
});
