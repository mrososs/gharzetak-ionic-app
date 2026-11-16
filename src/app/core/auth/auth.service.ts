import { Injectable, computed, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { ApiClient, ApiError } from '../api/api.client';
import type { Scope } from '../storage/local-db';
import { BiometricFailureKind, toBiometricFailure } from './biometric-errors';
import { BiometricService } from './biometric.service';
import { GoogleAuthService, GoogleCredential, GoogleSignInError } from './google-auth.service';
import { AuthUser, SessionStore, StoredSession } from './session.store';

const GUEST_KEY = 'gz.guest';
/** How long unlock waits for the server to confirm the session before treating the device as offline. */
const VALIDATE_TIMEOUT_MS = 6000;

export type AuthErrorKey =
  | 'errCreds'
  | 'errEmailTaken'
  | 'errNetwork'
  | 'errNotConfirmed'
  | 'errGeneric'
  | 'backendOff'
  | 'resetLinkInvalid'
  | 'errGoogleFailed'
  | 'errGoogleNotLinked';

export interface AuthResult {
  readonly ok: boolean;
  readonly error?: AuthErrorKey;
  /** Sign-up needs email confirmation before the first sign-in. */
  readonly needsConfirm?: boolean;
  /** The user dismissed the Google account picker: not an error, nothing to show. */
  readonly cancelled?: boolean;
  /** Google sign-in created a brand-new account (the caller continues with the setup flow). */
  readonly isNew?: boolean;
}

export type UnlockFailure = BiometricFailureKind | 'expired';

export interface UnlockResult {
  readonly ok: boolean;
  readonly reason?: UnlockFailure;
}

export interface BiometricToggleResult {
  readonly ok: boolean;
  readonly reason?: BiometricFailureKind | 'noSession';
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
  private readonly google = inject(GoogleAuthService);
  private readonly bio = inject(BiometricService);

  readonly backend = this.api.configured;
  readonly session = signal<StoredSession | null>(null);
  /**
   * True while the app is locked behind biometrics: at launch (the token cannot even be read from disk yet) or after the app
   * was in the background for a while. Route guards wait for it, so no private screen is created and no authenticated API call
   * is made until the user passes the biometric check.
   */
  readonly locked = signal(false);
  /** Biometric unlock is switched on for the current session (native only). */
  readonly biometricEnabled = this.store.biometric.asReadonly();
  /** Google sign-in can really run here: native Android/iOS build with the Google client id configured and a backend. */
  get googleAvailable(): boolean {
    return this.backend && this.google.available;
  }
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

  private initPromise: Promise<void> | null = null;
  private resetToken: string | null = null;
  private gate: { promise: Promise<void>; open: () => void } | null = null;

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
      } else if (this.store.biometric()) {
        this.setLocked(true); // biometric unlock is on: start locked, the token is unreadable until the check passes
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
    await this.store.clear(); // also removes the biometric-protected copy and the protection flag
    this.setLocked(false);
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
   * Google sign-in: the native account picker returns a Google-signed ID token, which the Worker's Better Auth verifies
   * (signature, issuer, audience, expiry, nonce) before issuing the SAME bearer session as email + password. The ID token is
   * sent once and never stored; no Google client secret exists in the app.
   */
  async signInWithGoogle(): Promise<AuthResult> {
    if (!this.backend) return { ok: false, error: 'backendOff' };
    let cred: GoogleCredential;
    try {
      cred = await this.google.getCredential();
    } catch (e) {
      return e instanceof GoogleSignInError && e.kind === 'cancelled' ? { ok: false, cancelled: true } : { ok: false, error: 'errGoogleFailed' };
    }
    try {
      const res = await this.api.raw<{ token?: string; user?: BetterAuthUser }>(
        'POST',
        '/api/auth/sign-in/social',
        { provider: 'google', idToken: { token: cred.idToken, nonce: cred.nonce } },
        false,
      );
      const r = await this.adopt(res.headers.get('set-auth-token') ?? res.body?.token ?? null, res.body?.user);
      return r.ok ? { ...r, isNew: await this.isNewAccount() } : r;
    } catch (e) {
      return { ok: false, error: mapGoogleError(e) };
    }
  }

  /** A fresh account is one whose user row was created moments before this session (both timestamps are server clock). */
  private async isNewAccount(): Promise<boolean> {
    try {
      const r = await this.api.raw<{ session?: { createdAt?: string }; user?: { createdAt?: string } } | null>('GET', '/api/auth/get-session');
      const s = Date.parse(r.body?.session?.createdAt ?? '');
      const u = Date.parse(r.body?.user?.createdAt ?? '');
      return Number.isFinite(s) && Number.isFinite(u) && s - u < 30_000;
    } catch {
      return false;
    }
  }

  // ---- biometric unlock -------------------------------------------------------------------------------------------------

  private setLocked(v: boolean): void {
    if (v === this.locked()) return;
    this.locked.set(v);
    if (v) {
      let open!: () => void;
      const promise = new Promise<void>((r) => (open = r));
      this.gate = { promise, open };
    } else {
      this.gate?.open();
      this.gate = null;
    }
  }

  /** Resolves once the app is unlocked (immediately when it is not locked). Route guards await this. */
  untilUnlocked(): Promise<void> {
    return this.gate?.promise ?? Promise.resolve();
  }

  /** Locks a running biometric-protected session again (the app spent a while in the background). */
  lock(): void {
    if (this.store.biometric() && this.signedIn()) this.setLocked(true);
  }

  /**
   * Asks the OS for the fingerprint / Face ID. The protected session is released only after a successful check; a cancel or
   * failure leaves the app locked. A session the server no longer accepts ends here and requires a normal sign-in. Without a
   * network the cached session is used (offline projects stay reachable; the server still authorises every API call).
   */
  async unlock(): Promise<UnlockResult> {
    if (!this.locked()) return { ok: true };
    let stored: StoredSession;
    try {
      stored = await this.store.readProtected(this.bio.prompt());
    } catch (e) {
      const kind = toBiometricFailure(e).kind;
      if (kind === 'invalidated') {
        await this.expire(); // biometrics changed or the entry is gone: the protected session cannot be used any more
        return { ok: false, reason: 'invalidated' };
      }
      return { ok: false, reason: kind };
    }
    const live = this.session();
    if (live) {
      // Re-lock of a running session: it must be the very session the biometric entry protects.
      if (live.token !== stored.token) {
        await this.expire();
        return { ok: false, reason: 'invalidated' };
      }
      this.setLocked(false);
      void this.revalidate();
      return { ok: true };
    }
    // Cold start: confirm with the server BEFORE any private screen is shown (session state is still empty, so nothing syncs yet).
    this.store.token.set(stored.token);
    if ((await this.validate()) === 'expired') {
      await this.expire();
      return { ok: false, reason: 'expired' };
    }
    this.session.set(stored);
    this.setGuest(false);
    this.setLocked(false);
    void this.revalidate(); // refresh the cached name/email
    return { ok: true };
  }

  private async validate(): Promise<'valid' | 'expired' | 'offline'> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const res = await Promise.race([
        this.api.raw<{ user?: BetterAuthUser } | null>('GET', '/api/auth/get-session'),
        new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error('timeout')), VALIDATE_TIMEOUT_MS))),
      ]);
      return res.body?.user ? 'valid' : 'expired';
    } catch (e) {
      return e instanceof ApiError && e.isUnauthorized ? 'expired' : 'offline';
    } finally {
      clearTimeout(timer);
    }
  }

  /** Turns biometric unlock on for the signed-in user. The OS prompts for a real fingerprint before anything is protected. */
  async enableBiometrics(): Promise<BiometricToggleResult> {
    const s = this.session();
    if (!s) return { ok: false, reason: 'noSession' };
    try {
      await this.store.protectWithBiometrics(s, this.bio.prompt());
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: toBiometricFailure(e).kind };
    }
  }

  /** Turns biometric unlock off. Needs a fresh biometric check (reading the protected session), so only the owner can do it. */
  async disableBiometrics(): Promise<BiometricToggleResult> {
    const live = this.session();
    try {
      const s = await this.store.readProtected(this.bio.prompt());
      await this.store.disableBiometrics(s);
      return { ok: true };
    } catch (e) {
      const kind = toBiometricFailure(e).kind;
      if (kind === 'invalidated' && live) {
        // Enrollment changed: the protected copy is already unusable; keep the live session in the normal store.
        await this.store.disableBiometrics(live);
        return { ok: true };
      }
      return { ok: false, reason: kind };
    }
  }

  /** "Sign in another way" from the lock screen: forgets the protected session on this device. Local project data is kept. */
  async abandonLock(): Promise<void> {
    await this.expire();
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

function mapGoogleError(e: unknown): AuthErrorKey {
  if (!(e instanceof ApiError)) return 'errGoogleFailed';
  if (e.isNetwork && e.status !== 429) return 'errNetwork';
  // Better Auth refuses to link a Google login to an email account that is not verified: that is not "Google failed".
  if (/OAUTH_LINK_ERROR|not linked/i.test(`${e.code} ${e.message}`)) return 'errGoogleNotLinked';
  if (e.status === 403 || /EMAIL_NOT_VERIFIED/i.test(e.code)) return 'errNotConfirmed';
  return 'errGoogleFailed';
}

function mapError(e: unknown): AuthErrorKey {
  if (!(e instanceof ApiError)) return 'errGeneric';
  if (e.isNetwork && e.status !== 429) return 'errNetwork';
  if (e.status === 401 || /INVALID_EMAIL_OR_PASSWORD/i.test(e.code)) return 'errCreds';
  if (e.status === 403 || /EMAIL_NOT_VERIFIED/i.test(e.code)) return 'errNotConfirmed';
  if (e.status === 422 || /USER_ALREADY_EXISTS/i.test(e.code)) return 'errEmailTaken';
  return 'errGeneric';
}
