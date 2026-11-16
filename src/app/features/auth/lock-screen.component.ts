import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { IonSpinner, NavController } from '@ionic/angular';
import { AuthService, UnlockFailure } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import type { Strings } from '../../core/i18n/strings';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';

type MessageKey = keyof Pick<Strings, 'lockFailed' | 'lockCancelled' | 'lockLockedOut' | 'lockUnavailable'>;

/**
 * Full-screen biometric lock. It is an opaque overlay AND the router never creates a private screen while the app is locked
 * (route guards wait for `auth.untilUnlocked()`), so this is not a cosmetic cover that can be bypassed by navigating elsewhere.
 *
 * `cover` = privacy splash only (app in the background / task switcher): no buttons, nothing private is drawn.
 */
@Component({
  selector: 'gz-lock-screen',
  imports: [IconComponent, IonSpinner],
  template: `
    <div class="gz-lock" role="dialog" aria-modal="true" [attr.aria-label]="t().lockTitle">
      <div class="gz-lock-logo"><svg gzIcon="yarn" size="l" /></div>
      <h1 class="gz-h1 gz-hd" style="margin: 16px 0 4px">{{ t().brand }}</h1>
      @if (!cover()) {
        <p class="gz-mute gz-sm" style="margin: 0 0 6px">{{ t().lockSub }}</p>
        @if (message(); as m) {
          <div class="gz-note lav" style="margin: 14px 0 0" role="status"><svg gzIcon="info" size="s" /><span>{{ t()[m] }}</span></div>
        }
        <button type="button" class="gz-btn" style="margin-top: 26px; max-width: 360px" [disabled]="busy()" (click)="unlock()">
          @if (busy()) {
            <ion-spinner name="crescent" style="color: #fff" />
          } @else {
            <svg gzIcon="fingerprint" />{{ t().lockUnlock }}
          }
        </button>
        <button type="button" class="gz-btn3 w" style="margin-top: 10px; max-width: 360px" (click)="other()">{{ t().lockOther }}</button>
      }
    </div>
  `,
  styles: [
    `
      .gz-lock {
        position: fixed;
        inset: 0;
        z-index: 100000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--gz-safe-top, env(safe-area-inset-top, 0px)) 24px var(--gz-safe-bottom, env(safe-area-inset-bottom, 0px));
        text-align: center;
        background: var(--gz-bg);
      }
      .gz-lock-logo {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 76px;
        height: 76px;
        border-radius: 24px;
        background: var(--gz-primary, #813db5);
        color: #fff;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LockScreenComponent {
  protected readonly auth = inject(AuthService);
  private readonly i18n = inject(I18nService);
  private readonly nav = inject(NavController);
  private readonly ui = inject(UiFeedback);

  readonly cover = input(false);
  protected readonly t = this.i18n.t;
  protected readonly busy = signal(false);
  protected readonly message = signal<MessageKey | null>(null);
  private prompted = false;

  constructor() {
    // Ask for the fingerprint automatically once per lock, like every native app does.
    effect(() => {
      const locked = this.auth.locked();
      const cover = this.cover();
      untracked(() => {
        if (!locked) return void (this.prompted = false);
        if (!cover && !this.prompted) {
          this.prompted = true;
          setTimeout(() => void this.unlock(), 350);
        }
      });
    });
  }

  protected async unlock(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.message.set(null);
    try {
      const r = await this.auth.unlock();
      if (r.ok) return;
      await this.handleFailure(r.reason ?? 'unknown');
    } finally {
      this.busy.set(false);
    }
  }

  private async handleFailure(reason: UnlockFailure): Promise<void> {
    switch (reason) {
      case 'cancelled':
        return void this.message.set('lockCancelled');
      case 'failed':
        return void this.message.set('lockFailed');
      case 'lockout':
        return void this.message.set('lockLockedOut');
      case 'invalidated':
        await this.ui.toast(this.t().lockChanged);
        return void (await this.nav.navigateRoot('/auth/login', { replaceUrl: true }));
      case 'expired':
        await this.ui.toast(this.t().lockExpired);
        return void (await this.nav.navigateRoot('/auth/login', { replaceUrl: true }));
      default:
        return void this.message.set('lockUnavailable');
    }
  }

  protected async other(): Promise<void> {
    await this.auth.abandonLock();
    await this.nav.navigateRoot('/auth/login', { replaceUrl: true });
  }
}
