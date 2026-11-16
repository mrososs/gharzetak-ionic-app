import { Injectable, signal } from '@angular/core';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

export interface StoredSession {
  readonly token: string;
  readonly user: AuthUser;
}

const KEY = 'gz.session';

/**
 * Persists the bearer session token + last known user so the app restores its session offline.
 *
 *  - Native (Android / iOS): iOS Keychain / Android Keystore-backed storage (`@aparajita/capacitor-secure-storage`),
 *    this-device-only and NOT synced to iCloud Keychain. A token left in plain Preferences by an earlier build is migrated
 *    once, then removed. If the secure store fails the session lives in memory only (the user signs in again next launch);
 *    it is deliberately never written to plaintext storage as a fallback.
 *  - Web: Capacitor Preferences (localStorage). Browsers have no secure token store; the token is an expiring, revocable
 *    session id and the API sends no cookies.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  /** Current token, read synchronously by the HTTP client. */
  readonly token = signal<string | null>(null);

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

  async load(): Promise<StoredSession | null> {
    try {
      let raw: string | null = null;
      if (this.native) {
        await this.init();
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
      if (!raw) return null;
      const s = JSON.parse(raw) as Partial<StoredSession>;
      if (typeof s.token !== 'string' || !s.token || !s.user || typeof s.user.id !== 'string') return null;
      this.token.set(s.token);
      return { token: s.token, user: { id: s.user.id, email: String(s.user.email ?? ''), name: String(s.user.name ?? '') } };
    } catch {
      return null;
    }
  }

  async save(s: StoredSession): Promise<void> {
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

  async clear(): Promise<void> {
    this.token.set(null);
    try {
      if (this.native) {
        await this.init();
        await SecureStorage.remove(KEY);
      }
    } catch {
      /* missing key / store unavailable */
    }
    try {
      await Preferences.remove({ key: KEY }); // also clears any legacy plaintext copy
    } catch {
      /* ignore */
    }
  }
}
