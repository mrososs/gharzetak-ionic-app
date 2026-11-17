import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { I18nService } from '../../../core/i18n/i18n.service';
import { ReminderService } from '../../../core/reminders/reminder.service';
import { AppStore } from '../../../core/state/app.store';
import { AvatarReactionComponent } from '../avatar/avatar-reaction.component';
import { SheetComponent } from '../dialogs/sheet.component';
import { UiFeedback } from '../feedback/toast.service';
import { IconComponent } from '../icon/icon.component';

/**
 * The friendly explanation shown BEFORE the phone's permission dialog. Opened only by a user action (the settings switch, the bell) or,
 * at most once per 30 days, after a happy moment such as a finished project. The system dialog appears only when the user presses
 * "Yes, remind me" here — never because the app opened, a page loaded or a plan was made.
 */
@Component({
  selector: 'gz-reminder-soft-ask',
  imports: [SheetComponent, AvatarReactionComponent, IconComponent],
  template: `
    <gz-sheet [open]="svc.softAsk()" [title]="i18n.q('تحبي نفكرك بوقت الكروشيه؟ 🧶', 'Want a gentle crochet reminder? 🧶')" (closed)="close()">
      <div class="hero"><gz-avatar-reaction [id]="store.avatar()" mood="relaxed" [size]="84" /></div>
      <p class="gz-sm" style="text-align: center; margin: 12px 4px 0">{{ i18n.q('مرتين في الأسبوع بس، في الوقت اللي تختاريه. تقدري تقفليها في أي وقت.', 'Just twice a week, at a time you choose. You can turn it off any time.') }}</p>
      <ul class="pts gz-xs gz-mute">
        <li>{{ i18n.q('الأحد والأربع الساعة 7:30 م — وتقدري تغيّريهم.', 'Sunday and Wednesday at 7:30 PM — and you can change them.') }}</li>
        <li>{{ i18n.q('ساعات هدوء بالليل، وبدون أي إزعاج.', 'Quiet hours at night, and no pressure.') }}</li>
        <li>{{ i18n.q('النص عام ومش بيظهر اسم مشروعك على شاشة القفل.', 'The text is generic and never shows your project name on the lock screen.') }}</li>
      </ul>

      @if (result() === 'denied') {
        <div class="gz-note peach mt-3" role="alert"><svg gzIcon="info" size="s" /><span class="flex-1">{{ i18n.q('الإشعارات مقفولة من إعدادات الموبايل. لو غيّرتي رأيك، افتحي الإعدادات وشغّليها.', 'Notifications are off in your phone settings. If you change your mind, open the settings and turn them on.') }}</span></div>
      } @else if (result() === 'unsupported') {
        <div class="gz-note lav mt-3" role="status"><svg gzIcon="info" size="s" /><span class="flex-1">{{ i18n.q('التذكيرات شغّالة في تطبيق غرزتك على الموبايل.', 'Reminders work in the Gharzetak app on your phone.') }}</span></div>
      }

      <ng-container gzActions>
        @if (result() === 'denied') {
          <button type="button" class="gz-btn" (click)="svc.openSystemSettings()"><svg gzIcon="sliders" size="s" />{{ i18n.q('افتحي الإعدادات', 'Open settings') }}</button>
          <button type="button" class="gz-btn2" (click)="close()">{{ i18n.q('تمام', 'Done') }}</button>
        } @else if (result() === 'unsupported') {
          <button type="button" class="gz-btn" (click)="close()">{{ i18n.q('تمام', 'Done') }}</button>
        } @else {
          <button type="button" class="gz-btn" [disabled]="busy()" (click)="yes()"><svg gzIcon="bell" size="s" />{{ i18n.q('أيوه، فكّريني', 'Yes, remind me') }}</button>
          <button type="button" class="gz-btn2" [disabled]="busy()" (click)="close()">{{ i18n.q('مش دلوقتي', 'Not now') }}</button>
        }
      </ng-container>
    </gz-sheet>
  `,
  styles: `
    .hero { display: flex; justify-content: center; padding-top: 4px; }
    .pts { margin: 10px 4px 0; padding-inline-start: 18px; display: grid; gap: 4px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReminderSoftAskComponent {
  protected readonly svc = inject(ReminderService);
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(AppStore);
  private readonly ui = inject(UiFeedback);

  protected readonly busy = signal(false);
  protected readonly result = signal<'denied' | 'unsupported' | null>(null);
  protected readonly nextWhen = computed(() => {
    const t = this.svc.nextAt();
    return t ? new Intl.DateTimeFormat(this.i18n.lang() === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(t) : '';
  });

  // NOTE: the sheet is deliberately NOT given [busy]. gz-sheet blocks dismissal while busy, and this component closes the sheet
  // right after enable() resolves (still busy): ion-modal ignores that close and the sheet stayed open on a real phone.
  // The buttons are disabled while the request runs instead.
  /** The ONLY path that can show the phone's permission dialog. */
  protected async yes(): Promise<void> {
    this.busy.set(true);
    try {
      const r = await this.svc.enable();
      if (r === 'granted') {
        this.svc.closeSoftAsk();
        await this.svc.replan();
        const when = this.nextWhen();
        void this.ui.say(when ? `تمام! أول تذكير: ${when}` : 'تمام! التذكيرات شغّالة', when ? `Done! First reminder: ${when}` : 'Done! Reminders are on');
      } else this.result.set(r);
    } finally {
      this.busy.set(false);
    }
  }

  protected close(): void {
    this.result.set(null);
    this.svc.closeSoftAsk();
  }
}
