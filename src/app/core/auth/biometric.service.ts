import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { BiometryType, NativeBiometric } from '@capgo/capacitor-native-biometric';
import { I18nService } from '../i18n/i18n.service';
import type { BiometricPromptText } from './session.store';

export interface BiometricAvailability {
  readonly available: boolean;
  /** Why it is not available (only when `available` is false). */
  readonly reason?: 'unsupported' | 'unavailable' | 'notEnrolled';
  readonly kind?: 'fingerprint' | 'face' | 'multiple' | 'other';
}

/**
 * Real native biometric capability check (Android BiometricPrompt / iOS Face ID + Touch ID). On the web there is no such
 * thing, so nothing is offered there and the normal login experience is unchanged.
 */
@Injectable({ providedIn: 'root' })
export class BiometricService {
  private readonly i18n = inject(I18nService);

  /** True only inside the Android / iOS app. */
  get supported(): boolean {
    return Capacitor.isNativePlatform();
  }

  async check(): Promise<BiometricAvailability> {
    if (!this.supported) return { available: false, reason: 'unsupported' };
    try {
      const r = await NativeBiometric.isAvailable({ useFallback: false });
      if (r.isAvailable) return { available: true, kind: kindOf(r.biometryType) };
      return { available: false, reason: r.errorCode === 3 ? 'notEnrolled' : 'unavailable' };
    } catch {
      return { available: false, reason: 'unavailable' };
    }
  }

  /** Localised text of the OS biometric prompt. */
  prompt(): BiometricPromptText {
    const t = this.i18n.t();
    return { title: t.bioPromptTitle, subtitle: t.bioPromptSub, cancel: t.cancel };
  }
}

function kindOf(t: BiometryType | undefined): BiometricAvailability['kind'] {
  switch (t) {
    case BiometryType.FINGERPRINT:
    case BiometryType.TOUCH_ID:
      return 'fingerprint';
    case BiometryType.FACE_ID:
    case BiometryType.FACE_AUTHENTICATION:
      return 'face';
    case BiometryType.MULTIPLE:
      return 'multiple';
    default:
      return 'other';
  }
}
