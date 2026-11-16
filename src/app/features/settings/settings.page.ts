import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { IonContent, IonHeader, NavController } from '@ionic/angular';
import { AuthService } from '../../core/auth/auth.service';
import { BiometricAvailability, BiometricService } from '../../core/auth/biometric.service';
import { AvatarId } from '../../core/data/avatars';
import { LVL, LVL_IDS } from '../../core/data/catalog';
import { I18nService } from '../../core/i18n/i18n.service';
import { TimerService } from '../../core/services/timer.service';
import { AppStore } from '../../core/state/app.store';
import { SyncService } from '../../core/sync/sync.service';
import { ToolsSheetBody } from '../../shared/ui/dialogs/common-sheets';
import { SheetComponent } from '../../shared/ui/dialogs/sheet.component';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { AvatarPickerComponent } from '../../shared/ui/avatar/avatar-picker.component';
import { CrochetAvatarComponent } from '../../shared/ui/avatar/crochet-avatar.component';

/** GZ-S25 settings · GZ-T07 tools sheet · GZ-T09 erase-data sheet. */
@Component({
  selector: 'gz-settings',
  imports: [IonHeader, IonContent, IconComponent, SheetComponent, ToolsSheetBody, AvatarPickerComponent, CrochetAvatarComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top">
        <button type="button" class="gz-icb" (click)="nav.back()" [attr.aria-label]="t().back"><svg gzIcon="arrowl" [flip]="true" /></button>
        <h1 class="gz-ttl gz-hd">{{ t().settings }}</h1>
        <span style="width: 46px"></span>
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      <div class="gz-pad">
        <div class="flex items-center gap-3.5" style="margin: 6px 0 4px">
          <button type="button" class="gz-avatar-btn" (click)="openAvatar()" [attr.aria-label]="i18n.q('شخصيتي في غرزتك', 'My Crochet Avatar')"><gz-crochet-avatar [id]="store.avatar()" [size]="64" [decorative]="true" /></button>
          <div class="min-w-0 flex-1">
            <div class="gz-hd truncate" style="font-size: 18px">{{ displayName() }}</div>
            <div class="gz-sm gz-mute truncate">{{ auth.signedIn() ? t().signedInAs + ' ' + auth.email() : t().guestAccount }}</div>
          </div>
        </div>
        @if (auth.signedIn()) {
          <div class="gz-note lav mt-2">
            <svg gzIcon="cloud" size="s" />
            <span>{{ syncLabel() }}</span>
          </div>
        } @else if (auth.backend) {
          <button type="button" class="gz-btn3 w mt-2" (click)="nav.navigateForward('/auth/signup')"><svg gzIcon="user" size="s" />{{ t().createAccount }}</button>
        }

        <label class="gz-lbl" for="se-name">{{ t().yourName }}</label>
        <div class="gz-in"><svg gzIcon="user" /><input id="se-name" type="text" maxlength="80" [value]="store.profile().displayName" (input)="onName($event)" [placeholder]="t().namePh" /></div>
        <button type="button" class="gz-btn3 w mt-4 gz-avrow" (click)="openAvatar()">
          <gz-crochet-avatar [id]="store.avatar()" [size]="34" [decorative]="true" />
          <span class="flex-1 text-start">{{ i18n.q('شخصيتي في غرزتك', 'My Crochet Avatar') }}</span>
          @if (!store.avatarChosen()) {
            <span class="gz-badge pur">{{ i18n.q('اختاري', 'Choose') }}</span>
          } @else {
            <svg gzIcon="arrow" size="s" [flip]="true" />
          }
        </button>
        <span class="gz-lbl">{{ t().language }}</span>
        <div class="gz-seg">
          <button type="button" [class.on]="i18n.isAr()" (click)="setLang('ar')" lang="ar">العربية</button>
          <button type="button" [class.on]="!i18n.isAr()" (click)="setLang('en')" lang="en">English</button>
        </div>
        <span class="gz-lbl">{{ t().termQ }}</span>
        <div class="gz-seg">
          <button type="button" [class.on]="store.profile().terms === 'us'" (click)="setTerms('us')">{{ t().us }}</button>
          <button type="button" [class.on]="store.profile().terms === 'uk'" (click)="setTerms('uk')">{{ t().uk }}</button>
        </div>
        <span class="gz-lbl">{{ t().expQ }}</span>
        <div class="gz-chips">
          @for (l of levels; track l) {
            <button type="button" class="gz-chip sm" [class.on]="store.profile().level === l" [attr.aria-pressed]="store.profile().level === l" (click)="store.updateProfile({ level: l })">{{ LVL[l][i18n.lang()] }}</button>
          }
        </div>
        @if (auth.signedIn() && bio.supported) {
          <span class="gz-lbl">{{ t().bioSettings }}</span>
          <div class="gz-seg" role="group" [attr.aria-label]="t().bioSettings">
            <button type="button" [class.on]="auth.biometricEnabled()" [attr.aria-pressed]="auth.biometricEnabled()" [disabled]="bioBusy() || !bioAvailable().available" (click)="setBiometrics(true)">{{ i18n.q('تشغيل', 'On') }}</button>
            <button type="button" [class.on]="!auth.biometricEnabled()" [attr.aria-pressed]="!auth.biometricEnabled()" [disabled]="bioBusy()" (click)="setBiometrics(false)">{{ i18n.q('إيقاف', 'Off') }}</button>
          </div>
          <p class="gz-xs gz-mute" style="margin: 6px 2px 0" role="status">{{ bioHint() }}</p>
        }
        <button type="button" class="gz-btn3 w mt-4" (click)="sheet.set('tools')"><svg gzIcon="hook" size="s" />{{ t().editTools }}</button>
        <button type="button" class="gz-btn3 w mt-2" (click)="replayIntro()"><svg gzIcon="reset" size="s" />{{ t().replayIntro }}</button>
        <button type="button" class="gz-btn3 rose w mt-2" (click)="sheet.set('erase')"><svg gzIcon="trash" size="s" />{{ t().resetDemo }}</button>
        <button type="button" class="gz-btn2 mt-2" (click)="logout()">{{ t().logout }}</button>

        <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ t().aboutProto }}</h2></div>
        <div class="gz-card soft flex flex-col gap-2">
          <div class="flex items-start gap-2.5"><svg gzIcon="check" size="s" style="color: var(--gz-mint-ink); margin-top: 4px" /><span class="gz-sm flex-1">{{ t().about1 }}</span></div>
          <div class="flex items-start gap-2.5"><svg gzIcon="info" size="s" style="color: var(--gz-peach-ink); margin-top: 4px" /><span class="gz-sm flex-1">{{ t().about2 }}</span></div>
          <div class="flex items-start gap-2.5"><svg gzIcon="info" size="s" style="color: var(--gz-peach-ink); margin-top: 4px" /><span class="gz-sm flex-1">{{ t().about3 }}</span></div>
        </div>
        <button type="button" class="gz-lnk mt-3" (click)="nav.navigateForward('/design-system')">{{ t().designSystem }}</button>
      </div>
    </ion-content>

    <gz-sheet [open]="sheet() === 'tools'" [label]="t().myTools" (closed)="sheet.set(null)"><gz-tools-sheet-body (done)="sheet.set(null)" /></gz-sheet>
    <gz-sheet [open]="sheet() === 'avatar'" [label]="i18n.q('شخصيتي في غرزتك', 'My Crochet Avatar')" (closed)="sheet.set(null)">
      <h2 class="gz-h2 gz-hd text-center">{{ i18n.q('شخصيتي في غرزتك', 'My Crochet Avatar') }}</h2>
      <p class="gz-mute gz-sm text-center" style="margin: 4px 0 8px">{{ i18n.q('اختاري صاحبتك الصغيرة اللي هترافقك في كل مشروع كروشيه.', 'Pick the little friend who will join you in every crochet project.') }}</p>
      <gz-avatar-picker [selected]="draftAvatar()" (picked)="draftAvatar.set($event)" />
      <button type="button" class="gz-btn mt-4" (click)="saveAvatar()">{{ i18n.q('دي شخصيتي!', "That's my buddy!") }}<svg gzIcon="check" /></button>
      <button type="button" class="gz-btn2 mt-2" (click)="sheet.set(null)">{{ t().cancel }}</button>
    </gz-sheet>
    <gz-sheet [open]="sheet() === 'erase'" [label]="t().resetDemo" (closed)="sheet.set(null)">
      <div class="text-center" style="padding: 6px 0 4px">
        <div class="gz-tile t-blush mx-auto mb-2.5" style="width: 60px; height: 60px; border-radius: 20px"><svg gzIcon="trash" size="l" /></div>
        <h2 class="gz-h2 gz-hd">{{ t().resetDemo }}</h2>
        <p class="gz-mute gz-sm" style="margin: 6px 0 16px">{{ t().resetAllBody }}</p>
      </div>
      <button type="button" class="gz-btn danger" (click)="erase()">{{ t().resetConfirm }}</button>
      <button type="button" class="gz-btn2 mt-2" (click)="sheet.set(null)">{{ t().cancel }}</button>
    </gz-sheet>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPage {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(AppStore);
  protected readonly auth = inject(AuthService);
  protected readonly nav = inject(NavController);
  private readonly sync = inject(SyncService);
  private readonly timer = inject(TimerService);
  private readonly ui = inject(UiFeedback);

  protected readonly t = this.i18n.t;
  protected readonly levels = LVL_IDS;
  protected readonly LVL = LVL;
  protected readonly sheet = signal<'tools' | 'erase' | 'avatar' | null>(null);
  /** Previewed avatar inside the picker sheet; the saved profile only changes on "Save". */
  protected readonly draftAvatar = signal<AvatarId | null>(null);
  protected readonly displayName = computed(() => this.store.profile().displayName || this.auth.email().split('@')[0] || this.i18n.q('ضيفتنا', 'Guest'));
  protected readonly syncLabel = computed(() => {
    const t = this.t();
    switch (this.sync.state()) {
      case 'syncing':
        return t.syncing;
      case 'offline':
        return t.offline;
      case 'error':
        return t.errGeneric;
      default:
        return this.sync.pending() ? `${t.pending}: ${this.sync.pending()}` : t.synced;
    }
  });

  protected readonly bio = inject(BiometricService);
  protected readonly bioBusy = signal(false);
  protected readonly bioAvailable = signal<BiometricAvailability>({ available: false });
  protected readonly bioHint = computed(() => {
    const t = this.t();
    const a = this.bioAvailable();
    if (this.auth.biometricEnabled() || a.available) return t.bioSettingsSub;
    return a.reason === 'notEnrolled' ? t.bioNotEnrolled : t.bioUnavailable;
  });

  constructor() {
    void this.bio.check().then((a) => this.bioAvailable.set(a));
  }

  /** On: the OS asks for a real fingerprint before anything is protected. Off: needs a fresh fingerprint too. */
  protected async setBiometrics(on: boolean): Promise<void> {
    if (this.bioBusy() || on === this.auth.biometricEnabled()) return;
    this.bioBusy.set(true);
    try {
      const r = on ? await this.auth.enableBiometrics() : await this.auth.disableBiometrics();
      const t = this.t();
      if (r.ok) await this.ui.toast(on ? t.bioOnToast : t.bioOffToast);
      else if (r.reason !== 'cancelled') await this.ui.toast(t.bioEnableFailed);
    } finally {
      this.bioBusy.set(false);
      void this.bio.check().then((a) => this.bioAvailable.set(a));
    }
  }

  private nameTimer: ReturnType<typeof setTimeout> | null = null;
  protected onName(ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    if (this.nameTimer) clearTimeout(this.nameTimer);
    this.nameTimer = setTimeout(() => void this.store.updateProfile({ displayName: v.trim().slice(0, 80) }), 400);
  }

  protected setLang(l: 'ar' | 'en'): void {
    this.i18n.lang.set(l);
    void this.store.updateProfile({});
  }

  protected setTerms(terms: 'us' | 'uk'): void {
    this.store.readerTerms.set(null);
    void this.store.updateProfile({ terms });
  }

  protected openAvatar(): void {
    this.draftAvatar.set(this.store.profile().avatarId);
    this.sheet.set('avatar');
  }

  protected async saveAvatar(): Promise<void> {
    const id = this.draftAvatar() ?? this.store.avatar();
    this.sheet.set(null);
    await this.store.setAvatar(id);
    await this.ui.say('اتغيّرت شخصيتك', 'Your avatar is updated');
  }

  protected replayIntro(): void {
    void this.nav.navigateForward('/onboarding/welcome', { queryParams: { replay: 1 } });
  }

  protected async erase(): Promise<void> {
    this.sheet.set(null);
    await this.timer.stop();
    await this.store.eraseLocal();
    if (this.auth.signedIn()) this.sync.schedule(0, true);
    await this.ui.say('اتمسحت بيانات الجهاز', 'Device data erased');
  }

  protected async logout(): Promise<void> {
    await this.timer.stop();
    if (this.auth.signedIn()) await this.sync.run();
    await this.auth.signOut();
    await this.nav.navigateRoot('/onboarding/welcome');
  }
}
