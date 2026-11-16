import { Injectable, computed, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { ApiClient, ApiError } from '../api/api.client';
import type { Scope } from '../storage/local-db';
import { AuthUser, SessionStore, StoredSession } from './session.store';

const GUEST_KEY = 'gz.guest';

export type AuthErrorKey = 'errCreds' | 'errEmailTaken' | 'errNetwork' | 'errNotConfirmed' | 'errGeneric' | 'backendOff' | 'resetLinkInvalid';

export interface AuthResult {
  readonly ok: boolean;
  readonly error?: AuthErrorKey;
  /** Sign-up needs email confirmation before the first sign-in. */
  readonly needsConfirm?: boolean;
}

interface BetterAuthUser {
  id: string;
  email: string;
  name?: string;
}

/**
 * Real email + password authentication against the Cloudflare Worker (Better Auth), plus an explicit,
 * clearly separate guest mode whose data never leaves the device.
 *
 * Session model: a bearer token (not cookies — cookies are unreliable in cross-origin Capacitor WebViews).
 * The token + last known user are cached so the app restores its session OFFLINE; the token is revalidated
 * in the background and the session is dropped only if the server says it is no longer valid (401).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiClient);
  private readonly store = inject(SessionStore);

  readonly backend = this.api.configured;
  readonly session = signal<StoredSession | null>(null);
  readonly user = computed<AuthUser | null>(() => this.session()?.user ?? null);
  readonly guest = signal<boolean>(readGuest());
  readonly ready = signal(false);
  /** True after arriving from a valid password-reset email link (a one-time reset token is held in memory). */
  readonly recovery = signal(false);
  readonly signedIn = computed(() => !!this.user());
  readonly canEnterApp = computed(() => this.signedIn() || this.guest());
  readonly scope = computed<Scope>(() => {
    const u = this.user();
    return u ? `user:${u.id}` : 'guest';
  });
  readonly email = computed(() => this.user()?.email ?? '');
  readonly oauthProviders = environment.oauthProviders;

  private initPromise: Promise<void> | null = null;
  private resetToken: string | null = null;

  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      if (!this.backend) {
        this.ready.set(true);
        return;
      }
      this.captureResetLinkFromLocation();
      const cached = await this.store.load();
      if (cached) {
        this.session.set(cached);
        this.setGuest(false);
        void this.revalidate(); // never blocks start-up: offline launches keep working
      }
      this.ready.set(true);
    })();
    return this.initPromise;
  }

  /** Confirms the cached token is still valid. Only an explicit 401 / empty session ends it. */
  private async revalidate(): Promise<void> {
    try {
      const res = await this.api.raw<{ user?: BetterAuthUser } | null>('GET', '/api/auth/get-session');
      const u = res.body?.user;
      if (!u) return void (await this.expire());
      const cur = this.session();
      if (cur && cur.user.id === u.id && (cur.user.email !== u.email || cur.user.name !== (u.name ?? ''))) {
        const next = { token: cur.token, user: { id: u.id, email: u.email, name: u.name ?? '' } };
        this.session.set(next);
        await this.store.save(next);
      }
    } catch (e) {
      if (e instanceof ApiError && e.isUnauthorized) await this.expire();
      /* offline / server down: keep the cached session */
    }
  }

  /** The server rejected the token (expired, revoked, password reset elsewhere). Local data is kept for the next sign-in. */
  async expire(): Promise<void> {
    this.session.set(null);
    await this.store.clear();
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    if (!this.backend) return { ok: false, error: 'backendOff' };
    try {
      const res = await this.api.raw<{ user: BetterAuthUser }>('POST', '/api/auth/sign-in/email', { email: email.trim(), password }, false);
      return await this.adopt(res.headers.get('set-auth-token'), res.body?.user);
    } catch (e) {
      return { ok: false, error: mapError(e) };
    }
  }

  async signUp(displayName: string, email: string, password: string): Promise<AuthResult> {
    if (!this.backend) return { ok: false, error: 'backendOff' };
    try {
      const res = await this.api.raw<{ user: BetterAuthUser }>(
        'POST',
        '/api/auth/sign-up/email',
        { email: email.trim(), password, name: displayName.trim(), callbackURL: this.redirect('/auth/login') },
        false,
      );
      const token = res.headers.get('set-auth-token');
      if (!token) return { ok: true, needsConfirm: true }; // the server requires email verification first
      return await this.adopt(token, res.body?.user);
    } catch (e) {
      return { ok: false, error: mapError(e) };
    }
  }

  private async adopt(token: string | null, u: BetterAuthUser | undefined): Promise<AuthResult> {
    if (!token || !u) return { ok: false, error: 'errGeneric' };
    const s: StoredSession = { token, user: { id: u.id, email: u.email, name: u.name ?? '' } };
    await this.store.save(s);
    this.session.set(s);
    this.setGuest(false);
    return { ok: true };
  }

  async requestPasswordReset(email: string): Promise<AuthResult> {
    if (!this.backend) return { ok: false, error: 'backendOff' };
    try {
      await this.api.raw('POST', '/api/auth/request-password-reset', { email: email.trim(), redirectTo: this.redirect('/auth/reset') }, false);
    } catch (e) {
      // Always report success for unknown emails (no account enumeration); only surface network errors.
      if (mapError(e) === 'errNetwork') return { ok: false, error: 'errNetwork' };
    }
    return { ok: true };
  }

  /** Completes the reset started by the emailed link. The user then signs in with the new password (all old sessions are revoked). */
  async updatePassword(password: string): Promise<AuthResult> {
    if (!this.backend) return { ok: false, error: 'backendOff' };
    if (!this.resetToken) return { ok: false, error: 'resetLinkInvalid' };
    try {
      await this.api.raw('POST', '/api/auth/reset-password', { token: this.resetToken, newPassword: password }, false);
      this.resetToken = null;
      this.recovery.set(false);
      await this.expire(); // any cached session was revoked server-side
      return { ok: true };
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        this.resetToken = null;
        this.recovery.set(false);
        return { ok: false, error: 'resetLinkInvalid' };
      }
      return { ok: false, error: mapError(e) };
    }
  }

  /**
   * Google / Apple are NOT wired yet: they need provider credentials on the API plus a native one-time-token
   * hand-off for Capacitor (docs/cloudflare-migration/auth-strategy.md). Kept disabled until then.
   */
  async signInWithProvider(_provider: 'google' | 'apple'): Promise<AuthResult> {
    return { ok: false, error: 'backendOff' };
  }

  async signOut(): Promise<void> {
    this.setGuest(false);
    if (this.backend && this.session()) {
      try {
        await this.api.raw('POST', '/api/auth/sign-out', {});
      } catch {
        /* offline: the local session is still cleared below; the server token expires on its own */
      }
    }
    await this.expire();
  }

  /**
   * Native deep link (com.gharzetak.app://auth/...): picks up the reset token or the post-verification
   * landing and returns the in-app path to open.
   */
  async handleDeepLink(url: string): Promise<string | null> {
    if (!this.backend) return null;
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    const path = `/${u.host}${u.pathname}`.replace(/\/+$/, '');
    if (path.startsWith('/auth/reset')) {
      this.takeResetToken(u.searchParams.get('token'));
      return '/auth/reset';
    }
    return this.signedIn() ? '/tabs/home' : '/auth/login';
  }

  continueAsGuest(): void {
    this.setGuest(true);
  }

  /** Web: the reset email lands on `<origin>/auth/reset?token=…`. Reads and removes the token from the address bar. */
  private captureResetLinkFromLocation(): void {
    if (typeof location === 'undefined' || !location.pathname.startsWith('/auth/reset')) return;
    const params = new URLSearchParams(location.search);
    this.takeResetToken(params.get('token'));
    try {
      history.replaceState(history.state, '', location.pathname);
    } catch {
      /* ignore */
    }
  }

  private takeResetToken(token: string | null): void {
    this.resetToken = token && /^[A-Za-z0-9_-]{8,256}$/.test(token) ? token : null;
    this.recovery.set(!!this.resetToken);
  }

  private setGuest(v: boolean): void {
    this.guest.set(v);
    try {
      if (v) localStorage.setItem(GUEST_KEY, '1');
      else localStorage.removeItem(GUEST_KEY);
    } catch {
      /* ignore */
    }
  }

  private redirect(path: string): string {
    const base = environment.authRedirectUrl || (typeof location !== 'undefined' ? location.origin : '');
    return base.replace(/\/$/, '') + path;
  }
}

function readGuest(): boolean {
  try {
    return localStorage.getItem(GUEST_KEY) === '1';
  } catch {
    return false;
  }
}

function mapError(e: unknown): AuthErrorKey {
  if (!(e instanceof ApiError)) return 'errGeneric';
  if (e.isNetwork && e.status !== 429) return 'errNetwork';
  if (e.status === 401 || /INVALID_EMAIL_OR_PASSWORD/i.test(e.code)) return 'errCreds';
  if (e.status === 403 || /EMAIL_NOT_VERIFIED/i.test(e.code)) return 'errNotConfirmed';
  if (e.status === 422 || /USER_ALREADY_EXISTS/i.test(e.code)) return 'errEmailTaken';
  return 'errGeneric';
}
