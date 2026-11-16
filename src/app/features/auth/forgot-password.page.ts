import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonContent, IonHeader, IonInput, IonSpinner, NavController } from '@ionic/angular';
import { AuthErrorKey, AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';

/** Forgot password — sends a password-reset email (no account enumeration). */
@Component({
  selector: 'gz-forgot-password',
  imports: [IonHeader, IonContent, IonInput, IonSpinner, ReactiveFormsModule, IconComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top">
        <button type="button" class="gz-icb" (click)="nav.navigateBack('/auth/login')" [attr.aria-label]="t().back"><svg gzIcon="arrowl" [flip]="true" /></button>
        <h1 class="gz-ttl gz-hd">{{ t().forgotTitle }}</h1>
        <span style="width: 46px"></span>
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      <form class="gz-pad" (ngSubmit)="send()" novalidate>
        <div class="mt-2 flex flex-col items-center gap-1.5 rounded-lg bg-lavender-200 px-4 py-5 text-center">
          <div class="flex h-[60px] w-[60px] items-center justify-center rounded-md bg-primary text-white"><svg gzIcon="lock" size="l" /></div>
          <p class="gz-mute gz-sm m-0">{{ t().forgotSub }}</p>
        </div>
        <label class="gz-lbl" for="fp-mail">{{ t().email }}</label>
        <div class="gz-in" [class.invalid]="email.invalid && tried()">
          <svg gzIcon="mail" />
          <ion-input id="fp-mail" [formControl]="email" type="email" inputmode="email" autocomplete="email" dir="ltr" placeholder="name@example.com" [attr.aria-label]="t().email" />
        </div>
        @if (email.invalid && tried()) {
          <div class="gz-err" role="alert">{{ t().errEmail }}</div>
        }
        @if (error(); as e) {
          <div class="gz-err" role="alert">{{ t()[e] }}</div>
        }
        @if (sent()) {
          <div class="gz-note sage gz-pulse mt-3" role="status"><svg gzIcon="check" /><span class="gz-b">{{ t().resetSent }}</span></div>
        }
        <button type="submit" class="gz-btn mt-4" [disabled]="busy()">
          @if (busy()) {
            <ion-spinner name="crescent" style="color: #fff" />
          } @else {
            {{ t().sendReset }}
          }
        </button>
        <button type="button" class="gz-lnk mt-2" (click)="nav.navigateBack('/auth/login')">{{ t().backToLogin }}</button>
      </form>
    </ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForgotPasswordPage {
  protected readonly i18n = inject(I18nService);
  protected readonly nav = inject(NavController);
  private readonly auth = inject(AuthService);
  protected readonly t = this.i18n.t;
  protected readonly email = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] });
  protected readonly tried = signal(false);
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal<AuthErrorKey | null>(null);

  protected async send(): Promise<void> {
    this.tried.set(true);
    this.error.set(null);
    if (this.email.invalid) return;
    this.busy.set(true);
    const r = await this.auth.requestPasswordReset(this.email.value);
    this.busy.set(false);
    if (r.ok) this.sent.set(true);
    else this.error.set(r.error ?? 'errGeneric');
  }
}
