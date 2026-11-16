import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';
import { environment } from '../../../environments/environment';

export type GoogleFailure = 'cancelled' | 'unavailable' | 'failed';

export class GoogleSignInError extends Error {
  constructor(
    readonly kind: GoogleFailure,
    message?: string,
  ) {
    super(message ?? kind);
  }
}

export interface GoogleCredential {
  /** Google-signed OpenID Connect ID token. Sent ONCE to the Worker (Better Auth) and never stored. */
  readonly idToken: string;
  /** Random per-attempt nonce bound into the ID token (replay protection). */
  readonly nonce: string;
}

/**
 * Native Google account picker (Android Credential Manager / iOS Google Sign-In) via @capgo/capacitor-social-login.
 *
 *  - Only the public WEB client id is used (it is the ID token's audience). The Android OAuth client is matched by Google through
 *    package name + signing SHA-1 and its id is never passed to the app. No client secret exists in the app.
 *  - The ID token is handed straight to the Worker, which verifies it. After every attempt we log out of the plugin so no Google
 *    token or credential state stays on the device, and the next attempt shows the account picker again.
 *  - Browsers have no supported embedded Google flow here, so Google sign-in is native-only (`available` is false on web).
 */
@Injectable({ providedIn: 'root' })
export class GoogleAuthService {
  private initialised: Promise<void> | null = null;

  /** True when a Google flow can really run on this device and build. */
  get available(): boolean {
    if (!Capacitor.isNativePlatform() || !environment.googleWebClientId) return false;
    return Capacitor.getPlatform() === 'ios' ? !!environment.googleIosClientId : true;
  }

  async getCredential(): Promise<GoogleCredential> {
    if (!this.available) throw new GoogleSignInError('unavailable');
    const nonce = randomNonce();
    try {
      await this.init();
      const res = await SocialLogin.login({ provider: 'google', options: { nonce } });
      const result = res.result as { responseType?: string; idToken?: string | null };
      if (result.responseType !== 'online' || !result.idToken) throw new GoogleSignInError('failed', 'no id token');
      return { idToken: result.idToken, nonce };
    } catch (e) {
      throw e instanceof GoogleSignInError ? e : toFailure(e);
    } finally {
      await this.forgetGoogleState();
    }
  }

  private init(): Promise<void> {
    this.initialised ??= SocialLogin.initialize({
      google: {
        webClientId: environment.googleWebClientId,
        ...(Capacitor.getPlatform() === 'ios' ? { iOSClientId: environment.googleIosClientId, iOSServerClientId: environment.googleWebClientId } : {}),
        mode: 'online',
      },
    }).catch((e) => {
      this.initialised = null; // allow a retry
      throw e;
    });
    return this.initialised;
  }

  private async forgetGoogleState(): Promise<void> {
    try {
      await SocialLogin.logout({ provider: 'google' });
    } catch {
      /* nothing to clear */
    }
  }
}

function randomNonce(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Maps the plugin's rejection to a coarse kind. A user cancelling the picker is not an error to show. */
export function toFailure(e: unknown): GoogleSignInError {
  const raw = e as { code?: unknown; message?: unknown } | null;
  const text = `${String(raw?.code ?? '')} ${String(raw?.message ?? e ?? '')}`;
  if (/cancel|dismiss|12501/i.test(text)) return new GoogleSignInError('cancelled', text.slice(0, 120));
  if (/unavailable|not.?supported|not.?initial/i.test(text)) return new GoogleSignInError('unavailable', text.slice(0, 120));
  return new GoogleSignInError('failed', text.slice(0, 120));
}
