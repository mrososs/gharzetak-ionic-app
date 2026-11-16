import { Injectable, signal } from '@angular/core';
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
 * Uses Capacitor Preferences (UserDefaults / SharedPreferences; localStorage on the web).
 * NOTE: this is not hardware-backed storage. Moving the token to Keychain/Keystore needs a secure-storage
 * plugin (see docs/cloudflare-migration/auth-strategy.md); the token is a revocable, expiring session id.
 */
@Injectable({ providedIn: 'root' })
export class SessionStore {
  /** Current token, read synchronously by the HTTP client. */
  readonly token = signal<string | null>(null);

  async load(): Promise<StoredSession | null> {
    try {
      const { value } = await Preferences.get({ key: KEY });
      if (!value) return null;
      const s = JSON.parse(value) as Partial<StoredSession>;
      if (typeof s.token !== 'string' || !s.token || !s.user || typeof s.user.id !== 'string') return null;
      this.token.set(s.token);
      return { token: s.token, user: { id: s.user.id, email: String(s.user.email ?? ''), name: String(s.user.name ?? '') } };
    } catch {
      return null;
    }
  }

  async save(s: StoredSession): Promise<void> {
    this.token.set(s.token);
    try {
      await Preferences.set({ key: KEY, value: JSON.stringify(s) });
    } catch {
      /* storage unavailable: the in-memory session still works for this run */
    }
  }

  async clear(): Promise<void> {
    this.token.set(null);
    try {
      await Preferences.remove({ key: KEY });
    } catch {
      /* ignore */
    }
  }
}
