/**
 * Coarse biometric outcomes. The native plugin reports numeric `BiometricAuthError` codes (see @capgo/capacitor-native-biometric);
 * the UI only needs to tell these apart:
 *
 *  - cancelled    user / system dismissed the prompt            -> stay locked, offer retry
 *  - failed       a finger/face did not match                   -> stay locked, retry
 *  - lockout      too many attempts (temporary or permanent)    -> stay locked, wait / other sign-in
 *  - notEnrolled  no fingerprint enrolled on the device
 *  - unavailable  no sensor / no secure lock screen / hw error
 *  - invalidated  the protected credential no longer exists (biometrics were changed, or it was deleted)
 *  - unknown
 */
export type BiometricFailureKind = 'cancelled' | 'failed' | 'lockout' | 'notEnrolled' | 'unavailable' | 'invalidated' | 'unknown';

export class BiometricFailure extends Error {
  constructor(
    readonly kind: BiometricFailureKind,
    message?: string,
  ) {
    super(message ?? kind);
  }
}

/** Maps a rejection from NativeBiometric to a {@link BiometricFailure}. */
export function toBiometricFailure(e: unknown): BiometricFailure {
  if (e instanceof BiometricFailure) return e;
  const raw = e as { code?: unknown; errorCode?: unknown; message?: unknown } | null;
  const code = Number(raw?.code ?? raw?.errorCode);
  const msg = String(raw?.message ?? e ?? '');
  switch (code) {
    case 11: // app cancel
    case 15: // system cancel
    case 16: // user cancel
    case 17: // user chose fallback
      return new BiometricFailure('cancelled', msg);
    case 10:
      return new BiometricFailure('failed', msg);
    case 2:
    case 4:
      return new BiometricFailure('lockout', msg);
    case 3:
      return new BiometricFailure('notEnrolled', msg);
    case 1:
    case 12:
    case 13:
    case 14:
      return new BiometricFailure('unavailable', msg);
    case 21:
      return new BiometricFailure('invalidated', msg);
  }
  if (/no protected (credentials|data) found|key permanently invalidated|invalidated/i.test(msg)) return new BiometricFailure('invalidated', msg);
  if (/cancel|dismiss/i.test(msg)) return new BiometricFailure('cancelled', msg);
  if (/lockout|too many/i.test(msg)) return new BiometricFailure('lockout', msg);
  if (/not enrolled|no biometrics enrolled|none enrolled/i.test(msg)) return new BiometricFailure('notEnrolled', msg);
  if (/not available|unavailable|no hardware/i.test(msg)) return new BiometricFailure('unavailable', msg);
  if (/fail|not recogni[sz]ed|authentication/i.test(msg)) return new BiometricFailure('failed', msg);
  return new BiometricFailure('unknown', msg);
}
