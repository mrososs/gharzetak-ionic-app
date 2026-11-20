import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonContent, IonHeader, IonInput, IonSpinner, NavController } from '@ionic/angular';
import { AuthErrorKey, AuthService } from '../../core/auth/auth.service';
import { BiometricService } from '../../core/auth/biometric.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { AppStore } from '../../core/state/app.store';
import { TourCoordinator } from '../../core/tour/tour-coordinator.service';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { LegalConsentLineComponent } from '../../shared/ui/legal/legal-consent-line.component';

/** GZ-S05 Log in · GZ-S06 Sign up — real account auth via the Worker API (email + password), plus guest mode. */
@Component({
  selector: 'gz-auth',
  imports: [IonHeader, IonContent, IonInput, IonSpinner, ReactiveFormsModule, IconComponent, LegalConsentLineComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top" style="justify-content: space-between">
        <button type="button" class="gz-icb" (click)="back()" [attr.aria-label]="t().back"><svg gzIcon="arrowl" [flip]="true" /></button>
        <button type="button" class="gz-chip sm" (click)="i18n.toggle()" [attr.aria-label]="t().langAria"><svg gzIcon="globe" size="s" />{{ t().langBtn }}</button>
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      <form class="gz-pad" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="mt-1 flex flex-col items-center gap-1.5 rounded-lg px-0 pt-1.5 pb-3.5 text-center" [style.background]="isSign() ? 'var(--gz-pink-200)' : 'var(--gz-lavender-200)'">
          <div class="mt-3 flex h-[60px] w-[60px] items-center justify-center rounded-md bg-primary text-white"><svg gzIcon="yarn" size="l" /></div>
          <h1 class="gz-h1 gz-hd">{{ isSign() ? i18n.q('حساب جديد', 'Create your account') : i18n.q('أهلاً بعودتك', 'Welcome back') }}</h1>
          <p class="gz-mute gz-sm mx-6 my-0">
            {{ isSign() ? i18n.q('انضمّي واحفظي مشاريعك وتقدّمك.', 'Join to keep your projects and progress.') : i18n.q('سجّلي الدخول وكمّلي رحلتك في الكروشيه.', 'Sign in and continue your crochet journey.') }}
          </p>
        </div>

        <div class="gz-seg mt-4 mb-1" role="tablist">
          <button type="button" role="tab" [class.on]="!isSign()" [attr.aria-selected]="!isSign()" (click)="switchMode('login')">{{ t().signIn }}</button>
          <button type="button" role="tab" [class.on]="isSign()" [attr.aria-selected]="isSign()" (click)="switchMode('signup')">{{ t().signUp }}</button>
        </div>

        @if (isSign()) {
          <label class="gz-lbl" for="f-name">{{ t().yourName }}</label>
          <div class="gz-in" [class.invalid]="showErr('name')">
            <svg gzIcon="user" />
            <ion-input id="f-name" formControlName="name" autocomplete="name" [placeholder]="t().namePh" [attr.aria-label]="t().yourName" />
          </div>
          @if (showErr('name')) {
            <div class="gz-err" role="alert">{{ t().errName }}</div>
          }
        }
        <label class="gz-lbl" for="f-mail">{{ t().email }}</label>
        <div class="gz-in" [class.invalid]="showErr('email')">
          <svg gzIcon="mail" />
          <ion-input id="f-mail" formControlName="email" type="email" inputmode="email" autocomplete="email" dir="ltr" placeholder="name@example.com" [attr.aria-label]="t().email" />
        </div>
        @if (showErr('email')) {
          <div class="gz-err" role="alert">{{ t().errEmail }}</div>
        }
        <label class="gz-lbl" for="f-pw">{{ t().password }}</label>
        <div class="gz-in" [class.invalid]="showErr('password')">
          <svg gzIcon="lock" />
          <ion-input id="f-pw" formControlName="password" [type]="showPw() ? 'text' : 'password'" [autocomplete]="isSign() ? 'new-password' : 'current-password'" dir="ltr" placeholder="••••••••" [attr.aria-label]="t().password" />
          <button type="button" class="gz-reset flex h-11 w-11 items-center justify-center" style="color: var(--gz-text-2)" (click)="showPw.set(!showPw())" [attr.aria-label]="t().showPw">
            <svg [gzIcon]="showPw() ? 'eyeoff' : 'eye'" />
          </button>
        </div>
        @if (showErr('password')) {
          <div class="gz-err" role="alert">{{ t().errPw }}</div>
        }
        @if (error(); as e) {
          <div class="gz-err" role="alert">{{ t()[e] }}</div>
        }
        @if (info(); as msg) {
          <div class="gz-note sage mt-2" role="status"><svg gzIcon="mail" size="s" /><span>{{ msg }}</span></div>
        }
        @if (!isSign()) {
          @if (auth.passwordResetAvailable) {
            <button type="button" class="gz-lnk mt-1" (click)="nav.navigateForward('/auth/forgot')">{{ t().forgot }}</button>
          }
        }

        <button type="submit" class="gz-btn mt-3.5" [disabled]="busy()">
          @if (busy()) {
            <ion-spinner name="crescent" style="color: #fff" />
          } @else {
            {{ isSign() ? i18n.q('إنشاء الحساب', 'Create account') : t().signIn }}
          }
        </button>
        <!-- Google sign-in also creates accounts, so the notice stays visible in both modes. -->
        <gz-legal-consent-line />

        @if (auth.googleAvailable) {
          <div class="my-4 flex items-center gap-2.5" aria-hidden="true">
            <span class="h-px flex-1 bg-line"></span><span class="gz-xs gz-mute">{{ t().orWith }}</span><span class="h-px flex-1 bg-line"></span>
          </div>
          <button type="button" class="gz-btn2" [disabled]="busy()" (click)="google()">
            <span class="gz-b" style="font-size: 18px; font-family: var(--gz-font-latin)" aria-hidden="true">G</span>{{ t().googleContinue }}
          </button>
        }
        <button type="button" class="gz-btn3 w" [class.mt-3]="auth.googleAvailable" [class.mt-4]="!auth.googleAvailable" (click)="guest()">{{ t().guest }}</button>
        <div class="gz-note lav mt-4">
          <svg gzIcon="info" size="s" />
          <span>{{ auth.backend ? t().authNote : t().backendOff }}</span>
        </div>
      </form>
    </ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthPage {
  protected readonly i18n = inject(I18nService);
  protected readonly auth = inject(AuthService);
  protected readonly nav = inject(NavController);
  private readonly store = inject(AppStore);
  private readonly ui = inject(UiFeedback);
  private readonly bio = inject(BiometricService);
  /** Product tours: told about the entry events only; it decides by itself whether anything is offered (never blocks sign-in). */
  private readonly tour = inject(TourCoordinator);

  readonly mode = input<'login' | 'signup'>('login');
  protected readonly t = this.i18n.t;
  protected readonly isSign = computed(() => this.mode() === 'signup');
  protected readonly showPw = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<AuthErrorKey | null>(null);
  protected readonly info = signal<string | null>(null);
  private readonly submitted = signal(false);

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email, Validators.pattern(/^\S+@\S+\.\S+$/)] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(8)] }),
  });

  protected showErr(ctrl: 'name' | 'email' | 'password'): boolean {
    this.submitted();
    const c = this.form.controls[ctrl];
    if (ctrl === 'name') return this.isSign() && this.submitted() && !c.value.trim();
    return c.invalid && (c.touched || this.submitted());
  }

  protected switchMode(m: 'login' | 'signup'): void {
    this.error.set(null);
    this.info.set(null);
    this.submitted.set(false);
    void this.nav.navigateRoot(`/auth/${m}`, { animated: false });
  }

  protected back(): void {
    void this.nav.navigateBack('/onboarding/welcome');
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    this.error.set(null);
    this.info.set(null);
    const { name, email, password } = this.form.getRawValue();
    if (this.form.controls.email.invalid || this.form.controls.password.invalid || (this.isSign() && !name.trim())) return;
    this.busy.set(true);
    try {
      if (this.isSign()) {
        const r = await this.auth.signUp(name, email, password);
        if (!r.ok) return void this.error.set(r.error ?? 'errGeneric');
        if (r.needsConfirm) {
          this.info.set(this.t().checkEmail);
          this.form.controls.password.reset('');
          return;
        }
        await this.store.whenScopeLoaded(this.auth.scope()); // the account's profile, not the guest's
        await this.store.updateProfile({ displayName: name.trim() });
        void this.tour.arm(); // a brand-new account
        // navigateRoot clears the stack: Back can never return to the sign-up form.
        await this.nav.navigateRoot('/setup/avatar', { replaceUrl: true });
      } else {
        const r = await this.auth.signIn(email, password);
        if (!r.ok) return void this.error.set(r.error ?? 'errGeneric');
        this.form.controls.password.reset('');
        void this.tour.armIfFreshAccount(); // only an account that is demonstrably new (decided after the first sync)
        await this.nav.navigateRoot('/tabs/home', { replaceUrl: true });
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async google(): Promise<void> {
    if (this.busy()) return;
    this.error.set(null);
    this.info.set(null);
    this.busy.set(true);
    try {
      const r = await this.auth.signInWithGoogle();
      if (r.cancelled) return; // the user closed the account picker: nothing to report
      if (!r.ok) return void this.error.set(r.error ?? 'errGoogleFailed');
      if (r.isNew) {
        await this.store.whenScopeLoaded(this.auth.scope());
        await this.store.updateProfile({ displayName: this.auth.user()?.name ?? '' });
      }
      void (r.isNew ? this.tour.arm() : this.tour.armIfFreshAccount());
      await this.offerBiometrics();
      // navigateRoot clears the stack: Back can never return to the sign-in form.
      await this.nav.navigateRoot(r.isNew ? '/setup/avatar' : '/tabs/home', { replaceUrl: true });
    } finally {
      this.busy.set(false);
    }
  }

  /** After a successful sign-in, OFFER (never force) biometric unlock, and only when the device can really do it. */
  private async offerBiometrics(): Promise<void> {
    const user = this.auth.user();
    if (!user || this.auth.biometricEnabled() || wasDeclined(user.id)) return;
    if (!(await this.bio.check()).available) return;
    const t = this.t();
    // Same confirmation dialog as everywhere else: the offered action is the filled primary, "Not now" is the quiet text button.
    const yes = await this.ui.confirm(t.bioAskTitle, t.bioAskBody, t.bioEnable, false, t.bioLater);
    if (!yes) return void markDeclined(user.id);
    const r = await this.auth.enableBiometrics(); // the OS asks for a real fingerprint here
    await this.ui.toast(r.ok ? t.bioOnToast : t.bioEnableFailed);
  }

  protected async guest(): Promise<void> {
    this.auth.continueAsGuest();
    void this.tour.arm(); // a guest starting out: the welcome tour may be offered once on Home
    await this.nav.navigateRoot('/tabs/home', { replaceUrl: true });
  }
}

const declinedKey = (userId: string): string => `gz.bio.declined.${userId}`;

function wasDeclined(userId: string): boolean {
  try {
    return localStorage.getItem(declinedKey(userId)) === '1';
  } catch {
    return false;
  }
}

function markDeclined(userId: string): void {
  try {
    localStorage.setItem(declinedKey(userId), '1');
  } catch {
    /* private mode: ask again next time */
  }
}
