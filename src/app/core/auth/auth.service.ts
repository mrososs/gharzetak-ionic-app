import { Injectable, computed, inject, signal } from '@angular/core';
import type { AuthError, Session } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import type { Scope } from '../storage/local-db';
import { SUPABASE } from '../supabase/supabase.client';

const GUEST_KEY = 'gz.guest';

export type AuthErrorKey = 'errCreds' | 'errEmailTaken' | 'errNetwork' | 'errNotConfirmed' | 'errGeneric' | 'backendOff' | 'resetLinkInvalid';

export interface AuthResult {
  readonly ok: boolean;
  readonly error?: AuthErrorKey;
  /** Sign-up needs email confirmation before the first sign-in. */
  readonly needsConfirm?: boolean;
}

/**
 * Real Supabase Auth (email + password, session restore, recovery) plus an explicit,
 * clearly separate guest mode whose data never leaves the device.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly sb = inject(SUPABASE);

  readonly backend = !!this.sb;
  readonly session = signal<Session | null>(null);
  readonly user = computed(() => this.session()?.user ?? null);
  readonly guest = signal<boolean>(readGuest());
  readonly ready = signal(false);
  /** True after arriving from a password-recovery email link. */
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

  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      if (!this.sb) {
        this.ready.set(true);
        return;
      }
      this.sb.auth.onAuthStateChange((event, session) => {
        this.session.set(session);
        if (event === 'PASSWORD_RECOVERY') this.recovery.set(true);
        if (session) this.setGuest(false);
      });
      try {
        const { data } = await this.sb.auth.getSession();
        this.session.set(data.session);
      } catch {
        /* offline with no cached session */
      }
      this.ready.set(true);
    })();
    return this.initPromise;
  }

  async signIn(email: string, password: string): Promise<AuthResult> {
    if (!this.sb) return { ok: false, error: 'backendOff' };
    const { data, error } = await this.sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return { ok: false, error: mapError(error) };
    this.session.set(data.session);
    this.setGuest(false);
    return { ok: true };
  }

  async signUp(displayName: string, email: string, password: string): Promise<AuthResult> {
    if (!this.sb) return { ok: false, error: 'backendOff' };
    const { data, error } = await this.sb.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: displayName.trim() }, emailRedirectTo: this.redirect('/auth/login') },
    });
    if (error) return { ok: false, error: mapError(error) };
    // Supabase returns a user with no identities when the email already exists (enumeration-safe).
    if (data.user && data.user.identities && data.user.identities.length === 0) return { ok: false, error: 'errEmailTaken' };
    if (!data.session) return { ok: true, needsConfirm: true };
    this.session.set(data.session);
    this.setGuest(false);
    return { ok: true };
  }

  async requestPasswordReset(email: string): Promise<AuthResult> {
    if (!this.sb) return { ok: false, error: 'backendOff' };
    const { error } = await this.sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: this.redirect('/auth/reset') });
    // Always report success for unknown emails (no account enumeration); only surface network errors.
    if (error && mapError(error) === 'errNetwork') return { ok: false, error: 'errNetwork' };
    return { ok: true };
  }

  async updatePassword(password: string): Promise<AuthResult> {
    if (!this.sb) return { ok: false, error: 'backendOff' };
    if (!this.session()) return { ok: false, error: 'resetLinkInvalid' };
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) return { ok: false, error: mapError(error) };
    this.recovery.set(false);
    return { ok: true };
  }

  async signInWithProvider(provider: 'google' | 'apple'): Promise<AuthResult> {
    if (!this.sb || !this.oauthProviders.includes(provider)) return { ok: false, error: 'backendOff' };
    const { error } = await this.sb.auth.signInWithOAuth({ provider, options: { redirectTo: this.redirect('/tabs/home') } });
    return error ? { ok: false, error: mapError(error) } : { ok: true };
  }

  async signOut(): Promise<void> {
    this.setGuest(false);
    if (this.sb) {
      try {
        await this.sb.auth.signOut({ scope: 'local' });
      } catch {
        /* offline: local session is still cleared below */
      }
    }
    this.session.set(null);
  }

  /**
   * Native deep link (com.gharzetak.app://auth/...): completes the PKCE exchange from a
   * confirmation / recovery email and returns the in-app path to open.
   */
  async handleDeepLink(url: string): Promise<string | null> {
    if (!this.sb) return null;
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    const code = u.searchParams.get('code');
    if (code) {
      const { error } = await this.sb.auth.exchangeCodeForSession(code);
      if (error) return '/auth/login';
    }
    const path = `/${u.host}${u.pathname}`.replace(/\/+$/, '');
    return path.startsWith('/auth/reset') ? '/auth/reset' : this.signedIn() ? '/tabs/home' : '/auth/login';
  }

  continueAsGuest(): void {
    this.setGuest(true);
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

function mapError(e: AuthError): AuthErrorKey {
  const code = (e as AuthError & { code?: string }).code ?? '';
  if (e.name === 'AuthRetryableFetchError' || e.status === 0 || /fetch|network/i.test(e.message)) return 'errNetwork';
  if (code === 'invalid_credentials' || /invalid login/i.test(e.message)) return 'errCreds';
  if (code === 'email_not_confirmed') return 'errNotConfirmed';
  if (code === 'user_already_exists' || /already registered/i.test(e.message)) return 'errEmailTaken';
  return 'errGeneric';
}
