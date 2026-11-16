import { Injectable, signal } from '@angular/core';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { AccessControl, NativeBiometric } from '@capgo/capacitor-native-biometric';
import { BiometricFailure, toBiometricFailure } from './biometric-errors';

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

export interface StoredSession {
  readonly token: string;
  readonly user: AuthUser;
}

/** Texts of the native biometric prompt (Android BiometricPrompt / iOS Face ID sheet). */
export interface BiometricPromptText {
  readonly title: string;
  readonly subtitle?: string;
  readonly cancel: string;
}

const KEY = 'gz.session';
/** "1" while the session lives ONLY in the biometric-protected store. The flag itself is not a secret. */
const BIO_FLAG = 'gz.bio';
/** Key of the session inside the biometric-protected native store. */
const BIO_KEY = 'gz.session.bio';

/**
 * Persists the bearer session token + last known user so the app restores its session offline.
 *
 *  - Native (Android / iOS): iOS Keychain / Android Keystore-backed storage (`@aparajita/capacitor-secure-storage`),
 *    this-device-only and NOT synced to iCloud Keychain. A token left in plain Preferences by an earlier build is migrated
 *    once, then removed. If the secure store fails the session lives in memory only (the user signs in again next launch);
 *    it is deliberately never written to plaintext storage as a fallback.
 *  - Biometric unlock (opt-in, native only): the session is moved into a Keystore/Keychain entry whose decryption key REQUIRES a
 *    live fingerprint / Face ID check on every read (`@capgo/capacitor-native-biometric`, access control BIOMETRY_CURRENT_SET,
 *    auth validity 0 => each read is bound to its own BiometricPrompt via a CryptoObject). While it is on, the plain copy is
 *    removed, so without a successful biometric check the token cannot be read from disk. Adding a fingerprint invalidates the
 *    entry (the user signs in again). Raw biometric data is never seen or stored by the app.
 *  - Web: Capacitor Preferences (localStorage). Browsers have no secure token store; the token is an expiring, revocable
 *    session id and the API sends no cookies. Biometric unlock is not offered on web.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  /** Current token, read synchronously by the HTTP client. */
  readonly token = signal<string | null>(null);
  /** True while the session is protected by biometrics (the app starts locked and the token is not readable without a check). */
  readonly biometric = signal(false);

  private readonly native = Capacitor.isNativePlatform();
  private ready: Promise<void> | null = null;

  private init(): Promise<void> {
    this.ready ??= (async () => {
      try {
        await SecureStorage.setSynchronize(false); // never put the session in iCloud Keychain
        await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);
      } catch {
        /* Android has no such options */
      }
    })();
    return this.ready;
  }

  /**
   * Loads the persisted session. When biometric unlock is on this returns null on purpose: the token cannot be read until the
   * user passes the biometric check (see {@link readProtected}); `biometric()` tells the caller to start locked.
   */
  async load(): Promise<StoredSession | null> {
    try {
      let raw: string | null = null;
      if (this.native) {
        await this.init();
        if ((await SecureStorage.get(BIO_FLAG)) === '1') {
          this.biometric.set(true);
          return null;
        }
        raw = (await SecureStorage.get(KEY)) as string | null;
        if (!raw) {
          // one-time migration from the plaintext store used before secure storage
          const legacy = (await Preferences.get({ key: KEY })).value;
          if (legacy) {
            await SecureStorage.set(KEY, legacy);
            await Preferences.remove({ key: KEY });
            raw = legacy;
          }
        }
      } else {
        raw = (await Preferences.get({ key: KEY })).value;
      }
      return this.parse(raw, true);
    } catch {
      return null;
    }
  }

  async save(s: StoredSession): Promise<void> {
    if (this.biometric()) {
      // Same session (e.g. a refreshed display name): keep it in memory only, the protected copy stays as it is.
      if (s.token === this.token()) return;
      // A different session while protection is on: protection belonged to the old one, so it is removed. The user can re-enable it.
      await this.disableBiometrics(null);
    }
    this.token.set(s.token);
    const value = JSON.stringify(s);
    try {
      if (this.native) {
        await this.init();
        await SecureStorage.set(KEY, value);
      } else {
        await Preferences.set({ key: KEY, value });
      }
    } catch {
      /* storage unavailable: the in-memory session still works for this run (never downgraded to plaintext on native) */
    }
  }

  /** Forgets the session everywhere: plain store, biometric-protected store and the protection flag. */
  async clear(): Promise<void> {
    this.token.set(null);
    this.biometric.set(false);
    try {
      if (this.native) {
        await this.init();
        await SecureStorage.remove(KEY);
      }
    } catch {
      /* missing key / store unavailable */
    }
    if (this.native) {
      // Independent best-effort deletes: a failure of one must never leave the other behind.
      await NativeBiometric.deleteData({ key: BIO_KEY }).catch(() => undefined);
      await SecureStorage.remove(BIO_FLAG).catch(() => undefined);
    }
    try {
      await Preferences.remove({ key: KEY }); // also clears any legacy plaintext copy
    } catch {
      /* ignore */
    }
  }

  /**
   * Turns biometric protection ON for this session. The user must pass a real biometric check to store it (Android shows the
   * BiometricPrompt for the write). Only after that succeeds is the plain copy removed, so a cancelled prompt changes nothing.
   */
  async protectWithBiometrics(s: StoredSession, prompt: BiometricPromptText): Promise<void> {
    if (!this.native) throw new BiometricFailure('unavailable', 'biometric protection is native-only');
    try {
      await this.init();
      await NativeBiometric.setData({
        key: BIO_KEY,
        value: JSON.stringify(s),
        accessControl: AccessControl.BIOMETRY_CURRENT_SET,
        authValidityDuration: 0,
        title: prompt.title,
        negativeButtonText: prompt.cancel,
      });
    } catch (e) {
      throw toBiometricFailure(e);
    }
    try {
      await SecureStorage.set(BIO_FLAG, '1');
    } catch (e) {
      await NativeBiometric.deleteData({ key: BIO_KEY }).catch(() => undefined); // keep exactly one source of truth
      throw toBiometricFailure(e);
    }
    this.token.set(s.token);
    this.biometric.set(true);
    await SecureStorage.remove(KEY).catch(() => undefined);
    await Preferences.remove({ key: KEY }).catch(() => undefined);
  }

  /** Reads the protected session. The OS shows the biometric prompt; the key is released only after a successful check. */
  async readProtected(prompt: BiometricPromptText): Promise<StoredSession> {
    if (!this.native) throw new BiometricFailure('unavailable', 'biometric protection is native-only');
    let value: string;
    try {
      ({ value } = await NativeBiometric.getSecureData({ key: BIO_KEY, title: prompt.title, subtitle: prompt.subtitle, reason: prompt.title, negativeButtonText: prompt.cancel }));
    } catch (e) {
      throw toBiometricFailure(e);
    }
    const s = this.parse(value, false);
    if (!s) throw new BiometricFailure('invalidated', 'protected session is unreadable');
    return s;
  }

  /**
   * Turns biometric protection OFF. `restore` (the session, read after a successful check) is written back to the normal secure
   * store first; pass null to simply forget the protected session (the user then signs in again).
   */
  async disableBiometrics(restore: StoredSession | null): Promise<void> {
    if (restore) {
      try {
        await this.init();
        await SecureStorage.set(KEY, JSON.stringify(restore));
        this.token.set(restore.token);
      } catch {
        /* storage unavailable: in-memory only, never plaintext */
      }
    }
    try {
      await NativeBiometric.deleteData({ key: BIO_KEY });
    } catch {
      /* already gone */
    }
    await SecureStorage.remove(BIO_FLAG).catch(() => undefined);
    this.biometric.set(false);
    if (!restore) this.token.set(null);
  }

  private parse(raw: string | null, publish: boolean): StoredSession | null {
    if (!raw) return null;
    try {
      const s = JSON.parse(raw) as Partial<StoredSession>;
      if (typeof s.token !== 'string' || !s.token || !s.user || typeof s.user.id !== 'string') return null;
      if (publish) this.token.set(s.token);
      return { token: s.token, user: { id: s.user.id, email: String(s.user.email ?? ''), name: String(s.user.name ?? '') } };
    } catch {
      return null;
    }
  }
}
