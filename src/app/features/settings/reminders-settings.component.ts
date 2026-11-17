import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { IsoWeekday, ReminderCadence } from '../../core/joy/joy.models';
import { weeklyCap } from '../../core/reminders/reminder-planner';
import { inQuietHours, parseHm } from '../../core/reminders/reminder-time';
import { ReminderService } from '../../core/reminders/reminder.service';
import { AppStore } from '../../core/state/app.store';
import { IconComponent } from '../../shared/ui/icon/icon.component';

const DAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

/**
 * "تذكيرات غرزتك / Crochet Reminders" — kept deliberately separate from the Celebrations settings (different decisions, and the only
 * one that involves a phone permission). Nothing here asks for permission by itself: turning the switch ON opens the friendly
 * explanation first, and only its "Yes" button shows the system dialog.
 */
@Component({
  selector: 'gz-reminders-settings',
  imports: [IconComponent],
  template: `
    <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ i18n.q('تذكيرات غرزتك', 'Crochet Reminders') }}</h2></div>

    @if (!svc.supported) {
      <div class="gz-note lav" role="status"><svg gzIcon="info" size="s" /><span>{{ i18n.q('تذكيرات الكروشيه شغّالة في تطبيق غرزتك على الموبايل (مش في المتصفح).', 'Crochet reminders work in the Gharzetak app on your phone (not in the browser).') }}</span></div>
    } @else {
      <span class="gz-lbl" id="rm-sw-l">{{ i18n.q('فكّريني بوقت الكروشيه', 'Remind me about crochet time') }}</span>
      <div class="gz-seg" role="group" aria-labelledby="rm-sw-l">
        <button type="button" [class.on]="p().enabled" [attr.aria-pressed]="p().enabled" [disabled]="busy()" (click)="turnOn()">{{ i18n.q('تشغيل', 'On') }}</button>
        <button type="button" [class.on]="!p().enabled" [attr.aria-pressed]="!p().enabled" [disabled]="busy()" (click)="turnOff()">{{ i18n.q('إيقاف', 'Off') }}</button>
      </div>
      <p class="gz-xs gz-mute" style="margin: 6px 2px 0" role="status">{{ statusText() }}</p>

      @if (svc.needsPermission()) {
        <div class="gz-note peach mt-3" role="alert">
          <svg gzIcon="info" size="s" />
          <span class="flex-1">{{ i18n.q('الإشعارات مقفولة من إعدادات الموبايل، فالتذكيرات متوقفة لحد ما تفتحيها.', 'Notifications are turned off in your phone settings, so reminders are paused until you turn them back on.') }}</span>
        </div>
        <button type="button" class="gz-btn3 w mt-2" (click)="svc.openSystemSettings()"><svg gzIcon="sliders" size="s" />{{ i18n.q('افتحي إعدادات الإشعارات', 'Open notification settings') }}</button>
      }

      @if (p().enabled) {
        <label class="gz-lbl" for="rm-time">{{ i18n.q('الوقت المفضّل', 'Preferred time') }}</label>
        <div class="gz-in"><svg gzIcon="clock" /><input id="rm-time" type="time" dir="ltr" [value]="p().time" (change)="setTime($event)" [attr.aria-label]="i18n.q('الوقت المفضّل', 'Preferred time')" /></div>

        <span class="gz-lbl" id="rm-freq-l">{{ i18n.q('كام مرة', 'How often') }}</span>
        <div class="gz-seg" role="group" aria-labelledby="rm-freq-l">
          @for (o of cadences(); track o.id) {
            <button type="button" [class.on]="p().cadence === o.id" [attr.aria-pressed]="p().cadence === o.id" (click)="svc.update({ cadence: o.id })">{{ o.label }}</button>
          }
        </div>

        @if (p().cadence !== 'daily') {
          <span class="gz-lbl" id="rm-days-l">{{ i18n.q('الأيام', 'Days') }}</span>
          <div class="gz-chips" role="group" aria-labelledby="rm-days-l">
            @for (d of days(); track d.id) {
              <button type="button" class="gz-chip sm" [class.on]="d.on" [attr.aria-pressed]="d.on" [attr.aria-label]="d.long" (click)="toggleDay(d.id)">{{ d.short }}</button>
            }
          </div>
          @if (tooManyDays()) {
            <p class="gz-xs gz-mute" style="margin: 6px 2px 0" role="status">{{ i18n.q('هنستخدم أول ' + cap() + ' أيام بس في الأسبوع. اختاري «أيام مخصصة» لو عايزة كلهم.', 'Only the first ' + cap() + ' days of each week are used. Choose "Custom days" to use them all.') }}</p>
          }
        }

        <label class="gz-lbl" for="rm-proj">{{ i18n.q('المشروع', 'Project') }}</label>
        <select id="rm-proj" class="gz-select" (change)="setProject($event)">
          <option value="" [selected]="!p().projectId">{{ i18n.q('آخر مشروع اشتغلتي فيه', 'My latest project') }}</option>
          @for (o of openProjects(); track o.id) {
            <option [value]="o.id" [selected]="p().projectId === o.id">{{ o.name }}</option>
          }
        </select>

        <span class="gz-lbl" id="rm-nudge-l">{{ i18n.q('تذكيرات لطيفة إضافية', 'Extra gentle nudges') }}</span>
        <div class="gz-chips" role="group" aria-labelledby="rm-nudge-l">
          @for (n of nudgeOptions(); track n.id) {
            <button type="button" class="gz-chip sm" [class.on]="p().nudges[n.id]" [attr.aria-pressed]="p().nudges[n.id]" (click)="toggleNudge(n.id)">{{ n.label }}</button>
          }
        </div>
        <p class="gz-xs gz-mute" style="margin: 6px 2px 0">{{ i18n.q('اللمسات دي بتحل محل تذكير مجدول، مش بتزوّد على عددهم.', 'These replace a scheduled reminder — they never add extra ones.') }}</p>

        <span class="gz-lbl">{{ i18n.q('ساعات الهدوء', 'Quiet hours') }}</span>
        <div class="flex items-center gap-2">
          <div class="gz-in flex-1"><input type="time" dir="ltr" [value]="p().quiet.start" (change)="setQuiet('start', $event)" [attr.aria-label]="i18n.q('بداية ساعات الهدوء', 'Quiet hours start')" /></div>
          <span aria-hidden="true">→</span>
          <div class="gz-in flex-1"><input type="time" dir="ltr" [value]="p().quiet.end" (change)="setQuiet('end', $event)" [attr.aria-label]="i18n.q('نهاية ساعات الهدوء', 'Quiet hours end')" /></div>
        </div>
        @if (timeInQuiet()) {
          <div class="gz-note peach mt-2" role="status"><svg gzIcon="info" size="s" /><span>{{ i18n.q('الوقت ده جوه ساعات الهدوء، فمش هيجيلك تذكير. غيّري الوقت أو ساعات الهدوء.', 'That time is inside quiet hours, so no reminder will be sent. Change the time or the quiet hours.') }}</span></div>
        }

        <span class="gz-lbl" id="rm-det-l">{{ i18n.q('اسم المشروع على شاشة القفل', 'Project name on the lock screen') }}</span>
        <div class="gz-seg" role="group" aria-labelledby="rm-det-l">
          <button type="button" [class.on]="p().showDetails" [attr.aria-pressed]="p().showDetails" (click)="svc.update({ showDetails: true })">{{ i18n.q('إظهار', 'Show') }}</button>
          <button type="button" [class.on]="!p().showDetails" [attr.aria-pressed]="!p().showDetails" (click)="svc.update({ showDetails: false })">{{ i18n.q('إخفاء (عام)', 'Hide (generic)') }}</button>
        </div>
        <p class="gz-xs gz-mute" style="margin: 6px 2px 0">{{ i18n.q('الافتراضي نص عام من غير اسم مشروعك، علشان خصوصيتك.', 'By default the text is generic, with no project name, to protect your privacy.') }}</p>

        <button type="button" class="gz-btn3 w mt-4" [disabled]="busy()" (click)="preview()"><svg gzIcon="bell" size="s" />{{ i18n.q('معاينة الإشعار', 'Preview notification') }}</button>
        @if (previewNote(); as n) {
          <p class="gz-xs gz-mute" style="margin: 6px 2px 0" role="status">{{ n }}</p>
        }
        <button type="button" class="gz-btn3 rose w mt-2" [disabled]="busy()" (click)="turnOff()"><svg gzIcon="trash" size="s" />{{ i18n.q('إيقاف كل التذكيرات', 'Turn off all reminders') }}</button>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RemindersSettingsComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly svc = inject(ReminderService);
  private readonly store = inject(AppStore);

  protected readonly p = this.svc.prefs;
  protected readonly busy = signal(false);
  protected readonly previewNote = signal<string | null>(null);

  protected readonly cap = computed(() => weeklyCap(this.p()));
  protected readonly tooManyDays = computed(() => this.p().cadence !== 'custom' && new Set(this.p().days).size > this.cap());
  protected readonly timeInQuiet = computed(() => inQuietHours(parseHm(this.p().time), this.p().quiet.start, this.p().quiet.end));

  protected readonly cadences = computed<{ id: ReminderCadence; label: string }[]>(() => [
    { id: 'twice', label: this.i18n.q('مرتين', 'Twice a week') },
    { id: 'thrice', label: this.i18n.q('٣ مرات', '3 times') },
    { id: 'daily', label: this.i18n.q('كل يوم', 'Every day') },
    { id: 'custom', label: this.i18n.q('أيام مخصصة', 'Custom days') },
  ]);

  protected readonly days = computed(() => {
    const lang = this.i18n.lang();
    const on = new Set(this.p().days);
    const f = (w: 'short' | 'long', i: number) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', { weekday: w, timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 16 + i))); // a fixed week: Mon 16 Nov 2026 …
    return DAYS.map((id, i) => ({ id, on: on.has(id), short: f('short', i), long: f('long', i) }));
  });

  protected readonly nudgeOptions = computed(() => [
    { id: 'inactive' as const, label: this.i18n.q('لو المشروع وقف كام يوم', 'If a project pauses for a few days') },
    { id: 'almostDone' as const, label: this.i18n.q('لو قربتي تخلصي', "When you're close to finishing") },
    { id: 'photo' as const, label: this.i18n.q('اقتراح صورة', 'Suggest a progress photo') },
  ]);

  protected readonly openProjects = computed(() => this.store.projects().filter((x) => x.status === 'active' && !x.deletedAt).map((x) => ({ id: x.id, name: x.name })));

  protected readonly statusText = computed(() => {
    if (!this.p().enabled) return this.i18n.q('التذكيرات مقفولة. مش هنبعتلك أي إشعار.', 'Reminders are off. We will not send you any notification.');
    const next = this.svc.nextAt();
    if (!next) return this.i18n.q('مفيش مشروع شغّال دلوقتي، فمفيش تذكير مجدول.', 'There is no project in progress, so no reminder is scheduled.');
    const when = new Intl.DateTimeFormat(this.i18n.lang() === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(next);
    return this.i18n.q(`أول تذكير جاي: ${when}`, `Next reminder: ${when}`);
  });

  /** The switch is a user action, but it still goes through the friendly explanation first — the system dialog is its "Yes" button. */
  protected turnOn(): void {
    if (this.p().enabled) return;
    this.svc.openSoftAsk();
  }

  protected async turnOff(): Promise<void> {
    if (!this.p().enabled || this.busy()) return;
    this.busy.set(true);
    try {
      await this.svc.disable();
    } finally {
      this.busy.set(false);
    }
  }

  protected setTime(ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    if (/^\d{2}:\d{2}$/.test(v)) void this.svc.update({ time: v });
  }

  protected setQuiet(which: 'start' | 'end', ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    if (/^\d{2}:\d{2}$/.test(v)) void this.svc.update({ quiet: { ...this.p().quiet, [which]: v } });
  }

  protected toggleDay(d: IsoWeekday): void {
    const cur = new Set(this.p().days);
    if (cur.has(d)) cur.delete(d);
    else cur.add(d);
    void this.svc.update({ days: [...cur].sort((a, b) => a - b) as IsoWeekday[] });
  }

  protected setProject(ev: Event): void {
    const v = (ev.target as HTMLSelectElement).value;
    void this.svc.update({ projectId: v || null });
  }

  protected toggleNudge(id: 'inactive' | 'almostDone' | 'photo'): void {
    const n = this.p().nudges;
    void this.svc.update({ nudges: { ...n, [id]: !n[id] } });
  }

  protected async preview(): Promise<void> {
    this.busy.set(true);
    this.previewNote.set(null);
    try {
      const r = await this.svc.preview();
      if (r === 'sent') this.previewNote.set(this.i18n.q('هيوصلك إشعار تجريبي كمان ثواني.', 'A test notification will arrive in a few seconds.'));
      else if (r === 'needs-permission') this.previewNote.set(this.i18n.q('شغّلي التذكيرات الأول وسمحي بالإشعارات.', 'Turn reminders on and allow notifications first.'));
    } finally {
      this.busy.set(false);
    }
  }
}
