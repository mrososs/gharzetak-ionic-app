import { Injectable } from '@angular/core';
import { isNativePlatform } from '../utils/platform';
import { CHANNEL_DETAILS, CHANNEL_PRIVATE, PlannedReminder } from './reminder-planner';

export type NotifPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

/**
 * The bridge to the operating system's notifications. The default implementation uses the OFFICIAL @capacitor/local-notifications
 * plugin (loaded lazily, native only); on the web every method is a harmless no-op. Tests provide a fake.
 *
 * Hard rules implemented here (verified against the plugin's v8.3.1 Android source):
 *  - `schedule()` of that plugin asks for the notification permission by itself when it is missing, so the service NEVER calls it
 *    unless `permission()` already says `granted`; the only place a prompt can ever come from is `requestPermission()`, which the UI
 *    calls only after the user said yes;
 *  - every reminder is scheduled with `isExactNotification: false` + `allowWhileIdle: true`: inexact (never the exact-alarm
 *    permission, never the "Alarms & reminders" screen) but still delivered while the phone is dozing.
 */
@Injectable({ providedIn: 'root', useFactory: () => new CapacitorReminderTransport() })
export abstract class ReminderTransport {
  abstract readonly native: boolean;
  abstract permission(): Promise<NotifPermission>;
  /** Shows the system permission dialog (Android 13+). Only ever called after the user explicitly agreed. */
  abstract requestPermission(): Promise<NotifPermission>;
  abstract ensureChannels(lang: 'ar' | 'en'): Promise<void>;
  abstract pendingIds(): Promise<number[]>;
  abstract cancel(ids: readonly number[]): Promise<void>;
  /** Schedules the reminders. Caller guarantees the permission is already granted. */
  abstract schedule(reminders: readonly PlannedReminder[]): Promise<void>;
  /** Calls `cb` with the payload of a tapped notification (also for the tap that launched the app). Resolves to an unsubscribe function. */
  abstract onTap(cb: (extra: unknown) => void): Promise<() => void>;
  abstract openSettings(): Promise<void>;
}

const mapPermission = (display: string): NotifPermission => (display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'prompt');

export class CapacitorReminderTransport extends ReminderTransport {
  readonly native = isNativePlatform();

  private async plugin() {
    return (await import('@capacitor/local-notifications')).LocalNotifications;
  }

  async permission(): Promise<NotifPermission> {
    if (!this.native) return 'unsupported';
    try {
      return mapPermission((await (await this.plugin()).checkPermissions()).display);
    } catch {
      return 'unsupported';
    }
  }

  async requestPermission(): Promise<NotifPermission> {
    if (!this.native) return 'unsupported';
    try {
      return mapPermission((await (await this.plugin()).requestPermissions()).display);
    } catch {
      return 'denied';
    }
  }

  async ensureChannels(lang: 'ar' | 'en'): Promise<void> {
    if (!this.native) return;
    const ln = await this.plugin();
    const ar = lang === 'ar';
    // importance 3 = default (sound, no heads-up interruption); visibility 0 = private (a locked screen hides the content), 1 = public.
    await ln.createChannel({ id: CHANNEL_PRIVATE, name: ar ? 'تذكيرات غرزتك' : 'Crochet reminders', description: ar ? 'تذكيرات لطيفة بوقت الكروشيه' : 'Gentle reminders for your crochet time', importance: 3, visibility: 0, vibration: true });
    await ln.createChannel({ id: CHANNEL_DETAILS, name: ar ? 'تذكيرات غرزتك (بالتفاصيل)' : 'Crochet reminders (with details)', description: ar ? 'تذكيرات بأسماء مشاريعك' : 'Reminders that name your projects', importance: 3, visibility: 1, vibration: true });
  }

  async pendingIds(): Promise<number[]> {
    if (!this.native) return [];
    return (await (await this.plugin()).getPending()).notifications.map((n) => n.id);
  }

  async cancel(ids: readonly number[]): Promise<void> {
    if (!this.native || !ids.length) return;
    await (await this.plugin()).cancel({ notifications: ids.map((id) => ({ id })) });
  }

  async schedule(reminders: readonly PlannedReminder[]): Promise<void> {
    if (!this.native || !reminders.length) return;
    await (await this.plugin()).schedule({
      notifications: reminders.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        channelId: r.channelId,
        smallIcon: 'ic_stat_gharzetak',
        autoCancel: true,
        isExactNotification: false,
        extra: r.extra,
        schedule: { at: new Date(r.at), allowWhileIdle: true },
      })),
    });
  }

  async onTap(cb: (extra: unknown) => void): Promise<() => void> {
    if (!this.native) return () => undefined;
    const handle = await (await this.plugin()).addListener('localNotificationActionPerformed', (e) => cb(e.notification.extra));
    return () => void handle.remove();
  }

  async openSettings(): Promise<void> {
    if (!this.native) return;
    const { registerPlugin } = await import('@capacitor/core');
    await registerPlugin<{ openNotificationSettings(): Promise<void> }>('SystemSettings').openNotificationSettings();
  }
}
