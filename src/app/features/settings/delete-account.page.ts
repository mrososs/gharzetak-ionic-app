import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { IonContent, IonHeader, IonSpinner, NavController } from '@ionic/angular';
import { AccountDeletionService, type DeletionOutcome } from '../../core/auth/account-deletion.service';
import type { DeleteFailure } from '../../core/auth/auth.service';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { NetworkService } from '../../core/services/network.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { DELETE_ACCOUNT_COPY } from './delete-account.content';

type Methods = { readonly password: boolean; readonly google: boolean };

/**
 * Settings → Account → Delete account.
 *
 * What the screen guarantees:
 *  - it explains what is deleted, what can remain and why, and that deletion is irreversible, BEFORE anything can be sent;
 *  - the button stays disabled until the person ticks the explicit confirmation (and, for password accounts, types the password);
 *  - one request at a time (the service refuses a second call, and every control is disabled while it runs);
 *  - success is shown ONLY when the server confirmed (AccountDeletionService returns ok); every failure says plainly that nothing
 *    was deleted — except the two ambiguous ones (lost connection, session ended), which say so instead of guessing;
 *  - guests never see a delete form: they have no account; their device data is erased from the existing Settings action.
 */
@Component({
  selector: 'gz-delete-account',
  imports: [IonHeader, IonContent, IonSpinner, IconComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top">
        <button type="button" class="gz-icb" (click)="back()" [disabled]="svc.busy()" [attr.aria-label]="i18n.t().back"><svg gzIcon="arrowl" [flip]="true" /></button>
        <h1 class="gz-ttl gz-hd">{{ c().title }}</h1>
        <span style="width: 46px"></span>
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      <div class="gz-pad" data-testid="delete-account">
        @if (result(); as r) {
          <div class="gz-note sage mt-3" role="status" data-testid="delete-success">
            <svg gzIcon="check" />
            <span>
              <strong class="gz-b">{{ c().successTitle }}</strong><br />
              {{ r.storageCleanup === 'complete' ? c().successComplete : c().successPending }}
            </span>
          </div>
          @if (r.localCleanup === 'failed') {
            <div class="gz-note mt-2" role="alert"><svg gzIcon="info" /><span>{{ c().localFailed }}</span></div>
          }
          <button type="button" class="gz-btn mt-4" (click)="finish()">{{ c().done }}</button>
        } @else if (!auth.signedIn()) {
          <div class="gz-note lav mt-3" data-testid="delete-guest">
            <svg gzIcon="info" />
            <span><strong class="gz-b">{{ c().guestTitle }}</strong><br />{{ c().guestBody }}</span>
          </div>
          <button type="button" class="gz-btn3 w mt-4" (click)="back()">{{ c().backToSettings }}</button>
        } @else {
          <p class="gz-sm m-0 mt-2">{{ c().intro }}</p>

          <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ c().deletesTitle }}</h2></div>
          <ul class="gz-sm m-0 flex list-disc flex-col gap-1.5 ps-5" data-testid="delete-list">
            @for (line of c().deletes; track line) {
              <li>{{ line }}</li>
            }
          </ul>

          <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ c().exceptionsTitle }}</h2></div>
          <ul class="gz-sm m-0 flex list-disc flex-col gap-1.5 ps-5" data-testid="exceptions-list">
            @for (line of c().exceptions; track line) {
              <li>{{ line }}</li>
            }
          </ul>
          <p class="gz-xs gz-mute" style="margin: 8px 2px 0">{{ c().otherDevices }}</p>
          <p class="gz-xs gz-mute" style="margin: 4px 2px 0">{{ c().guestUntouched }}</p>

          <div class="gz-note rose mt-4" role="alert" data-testid="irreversible">
            <svg gzIcon="info" />
            <span><strong class="gz-b">{{ c().irreversibleTitle }}</strong><br />{{ c().irreversible }}</span>
          </div>

          @if (methods() === 'loading') {
            <p class="gz-xs gz-mute" style="margin: 10px 2px 0" role="status">{{ c().checkingMethod }}</p>
          } @else if (needsPassword()) {
            <label class="gz-lbl" for="da-pw">{{ c().passwordLabel }}</label>
            <div class="gz-in"><svg gzIcon="lock" /><input id="da-pw" type="password" autocomplete="current-password" dir="ltr" maxlength="128" [value]="password()" [disabled]="svc.busy()" (input)="onPassword($event)" /></div>
            <p class="gz-xs gz-mute" style="margin: 6px 2px 0">{{ c().passwordHint }}</p>
          } @else if (isGoogleOnly()) {
            <p class="gz-xs gz-mute" style="margin: 10px 2px 0">{{ c().googleHint }}</p>
          }

          <label class="mt-4 flex items-start gap-2.5" for="da-ok">
            <input id="da-ok" type="checkbox" style="margin-top: 4px; width: 20px; height: 20px; accent-color: var(--gz-rose-ink, #b4234a)" [checked]="confirmed()" [disabled]="svc.busy()" (change)="onConfirm($event)" />
            <span class="gz-sm flex-1">{{ c().confirmCheck }}</span>
          </label>

          @if (!online()) {
            <div class="gz-note mt-3" role="status"><svg gzIcon="info" /><span>{{ c().offline }}</span></div>
          }
          @if (error(); as e) {
            <div class="gz-err" role="alert" data-testid="delete-error">{{ c().errors[e] }}</div>
          }

          <button type="button" class="gz-btn danger mt-4" data-testid="delete-confirm" [disabled]="!canSubmit()" (click)="submit()">
            @if (svc.busy()) {
              <ion-spinner name="crescent" style="color: #fff" /> <span>{{ c().deleting }}</span>
            } @else {
              <svg gzIcon="trash" size="s" />{{ c().deleteButton }}
            }
          </button>
          <button type="button" class="gz-btn-text" [disabled]="svc.busy()" (click)="back()">{{ c().cancel }}</button>
        }
      </div>
    </ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeleteAccountPage {
  protected readonly i18n = inject(I18nService);
  protected readonly auth = inject(AuthService);
  protected readonly svc = inject(AccountDeletionService);
  private readonly nav = inject(NavController);
  private readonly net = inject(NetworkService);

  protected readonly c = computed(() => DELETE_ACCOUNT_COPY[this.i18n.lang()]);
  protected readonly online = this.net.online;
  protected readonly confirmed = signal(false);
  protected readonly password = signal('');
  protected readonly error = signal<DeleteFailure | null>(null);
  protected readonly result = signal<Extract<DeletionOutcome, { ok: true }> | null>(null);
  /** 'loading' until the account's sign-in methods are known; null = could not be determined. */
  protected readonly methods = signal<Methods | null | 'loading'>('loading');

  protected readonly needsPassword = computed(() => {
    const m = this.methods();
    return m !== 'loading' && m?.password === true;
  });
  protected readonly isGoogleOnly = computed(() => {
    const m = this.methods();
    return m !== 'loading' && m?.password === false && m.google;
  });
  protected readonly canSubmit = computed(
    () => this.auth.signedIn() && this.methods() !== 'loading' && this.confirmed() && !this.svc.busy() && this.online() && (!this.needsPassword() || this.password().length > 0),
  );

  constructor() {
    if (this.auth.signedIn()) void this.auth.accountKinds().then((m) => this.methods.set(m));
  }

  protected onPassword(ev: Event): void {
    this.password.set((ev.target as HTMLInputElement).value);
  }

  protected onConfirm(ev: Event): void {
    this.confirmed.set((ev.target as HTMLInputElement).checked);
  }

  protected async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.error.set(null);
    const out = await this.svc.delete(this.needsPassword() ? this.password() : null);
    this.password.set(''); // never keep the password in memory longer than the request
    if (out.ok) {
      this.result.set(out);
      return;
    }
    if (out.failure === 'busy') return; // a request is already running: the UI is already showing it
    this.error.set(out.failure); // the confirmation stays ticked: only what failed needs to be redone
  }

  protected back(): void {
    if (this.svc.busy()) return;
    void this.nav.navigateBack('/tabs/home/settings');
  }

  protected finish(): void {
    void this.nav.navigateRoot('/onboarding/welcome');
  }
}
