import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonContent, IonHeader, IonInput, IonSpinner, NavController } from '@ionic/angular';
import { AuthErrorKey, AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';

/** Landing page of the recovery email link: set a new password using the one-time reset token. */
@Component({
  selector: 'gz-reset-password',
  imports: [IonHeader, IonContent, IonInput, IonSpinner, ReactiveFormsModule, IconComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top">
        <span style="width: 46px"></span>
        <h1 class="gz-ttl gz-hd">{{ t().setNewPassword }}</h1>
        <span style="width: 46px"></span>
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      <form class="gz-pad" (ngSubmit)="save()" novalidate>
        @if (!auth.recovery()) {
          <div class="gz-note err mt-3" role="alert"><svg gzIcon="info" size="s" /><span>{{ t().resetLinkInvalid }}</span></div>
          <button type="button" class="gz-btn3 w mt-3" (click)="nav.navigateRoot('/auth/forgot')">{{ t().forgotTitle }}</button>
        } @else {
          <label class="gz-lbl" for="rp-pw">{{ t().newPassword }}</label>
          <div class="gz-in" [class.invalid]="pw.invalid && tried()">
            <svg gzIcon="lock" />
            <ion-input id="rp-pw" [formControl]="pw" [type]="show() ? 'text' : 'password'" autocomplete="new-password" dir="ltr" [attr.aria-label]="t().newPassword" />
            <button type="button" class="gz-reset flex h-11 w-11 items-center justify-center" (click)="show.set(!show())" [attr.aria-label]="t().showPw"><svg [gzIcon]="show() ? 'eyeoff' : 'eye'" /></button>
          </div>
          @if (pw.invalid && tried()) {
            <div class="gz-err" role="alert">{{ t().errPw }}</div>
          }
          @if (error(); as e) {
            <div class="gz-err" role="alert">{{ t()[e] }}</div>
          }
          <button type="submit" class="gz-btn mt-4" [disabled]="busy()">
            @if (busy()) {
              <ion-spinner name="crescent" style="color: #fff" />
            } @else {
              {{ t().setNewPassword }}
            }
          </button>
        }
      </form>
    </ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResetPasswordPage {
  protected readonly i18n = inject(I18nService);
  protected readonly auth = inject(AuthService);
  protected readonly nav = inject(NavController);
  private readonly ui = inject(UiFeedback);
  protected readonly t = this.i18n.t;
  protected readonly pw = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(8)] });
  protected readonly show = signal(false);
  protected readonly tried = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<AuthErrorKey | null>(null);

  protected async save(): Promise<void> {
    this.tried.set(true);
    this.error.set(null);
    if (this.pw.invalid) return;
    this.busy.set(true);
    const r = await this.auth.updatePassword(this.pw.value);
    this.busy.set(false);
    if (!r.ok) return void this.error.set(r.error ?? 'errGeneric');
    await this.ui.toast(this.t().pwUpdated);
    // A reset revokes every existing session, so the user signs in with the new password.
    await this.nav.navigateRoot('/auth/login', { replaceUrl: true });
  }
}
