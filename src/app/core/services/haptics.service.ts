import { Injectable } from '@angular/core';
import { isNativePlatform } from '../utils/platform';

/**
 * Thin, failure-proof wrapper over the official Capacitor Haptics plugin (loaded lazily, only on a native device). On the web — and on
 * devices without a vibrator — every call is a silent no-op, and an error can never reach the caller.
 * Callers decide WHEN to vibrate (only after a genuine new celebration event, and only when the user's haptics preference allows it).
 */
@Injectable({ providedIn: 'root' })
export class HapticsService {
  readonly supported = isNativePlatform();

  /** A short tick for a round (light) or a milestone (medium). */
  async impact(level: 'light' | 'medium'): Promise<void> {
    if (!this.supported) return;
    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: level === 'light' ? ImpactStyle.Light : ImpactStyle.Medium });
    } catch {
      /* haptics are decoration */
    }
  }

  /** The "well done" pattern for a finished piece / project. */
  async success(): Promise<void> {
    if (!this.supported) return;
    try {
      const { Haptics, NotificationType } = await import('@capacitor/haptics');
      await Haptics.notification({ type: NotificationType.Success });
    } catch {
      /* haptics are decoration */
    }
  }
}
