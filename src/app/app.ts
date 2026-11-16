import { ChangeDetectionStrategy, Component, OnInit, effect, inject, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
import { StatusBar, Style } from '@capacitor/status-bar';
import { AlertController, IonApp, IonRouterOutlet, NavController, Platform } from '@ionic/angular';
import { AuthService } from './core/auth/auth.service';
import { I18nService } from './core/i18n/i18n.service';
import { TimerService } from './core/services/timer.service';
import { AppStore } from './core/state/app.store';
import { GuestImportService } from './core/sync/guest-import.service';
import { SyncService } from './core/sync/sync.service';
import { UiFeedback } from './shared/ui/feedback/toast.service';

@Component({
  selector: 'app-root',
  imports: [IonApp, IonRouterOutlet],
  template: `<ion-app><ion-router-outlet /></ion-app>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit {
  private readonly platform = inject(Platform);
  private readonly router = inject(Router);
  private readonly nav = inject(NavController);
  private readonly auth = inject(AuthService);
  private readonly store = inject(AppStore);
  private readonly sync = inject(SyncService);
  private readonly timer = inject(TimerService);
  private readonly importer = inject(GuestImportService);
  private readonly alerts = inject(AlertController);
  private readonly i18n = inject(I18nService);
  private readonly ui = inject(UiFeedback);
  private askedImportFor: string | null = null;

  constructor() {
    // Password-recovery email link → reset screen.
    effect(() => {
      if (this.auth.recovery()) untracked(() => void this.router.navigateByUrl('/auth/reset'));
    });
    // A local change lost a sync conflict (or was rejected): it is kept on the device, and the user is told once.
    effect(() => {
      const n = this.sync.conflictNotice();
      if (!n) return;
      untracked(() => {
        const q = (a: string, e: string) => this.i18n.q(a, e);
        const what = n.label ? `«${n.label}»` : q('بياناتك', 'your data');
        const text =
          n.reason === 'rejected'
            ? q(`تعذّر حفظ بعض تعديلات ${what} على السحابة. اتحفظت على جهازك.`, `Some changes to ${what} could not be saved to the cloud. They are kept on this device.`)
            : n.reason === 'deleted'
              ? q(`اتمسح ${what} من جهاز تاني. اتحفظت آخر تعديلاتك على جهازك.`, `${what} was deleted on another device. Your latest changes are kept on this device.`)
              : q(`نسخة أحدث من ${what} جت من جهاز تاني وحلّت محل تعديلاتك. اتحفظت نسختك على جهازك.`, `A newer version of ${what} from another device replaced your changes. Your version is kept on this device.`);
        this.sync.conflictNotice.set(null);
        void this.ui.toast(text);
      });
    });
    // After sign-in, offer (never force) moving guest data into the account.
    effect(() => {
      const user = this.auth.user();
      const loaded = this.store.loaded();
      if (user && loaded && this.askedImportFor !== user.id) {
        this.askedImportFor = user.id;
        untracked(() => void this.offerGuestImport());
      }
    });
  }

  ngOnInit(): void {
    if (Capacitor.isNativePlatform()) {
      StatusBar.setStyle({ style: Style.Light }).catch(() => undefined);
      if (Capacitor.getPlatform() === 'android') StatusBar.setBackgroundColor({ color: '#FFF9F5' }).catch(() => undefined);
      Keyboard.setResizeMode({ mode: KeyboardResize.Native }).catch(() => undefined);
    }

    // Android hardware back: Ionic pops page stacks first (priority 0). At a root screen we
    // exit instead of ever returning to login/onboarding.
    this.platform.backButton.subscribeWithPriority(-1, () => {
      const url = this.router.url;
      if (url.startsWith('/tabs/home') && !url.startsWith('/tabs/home/')) void CapApp.exitApp();
      else if (url.startsWith('/onboarding') || url.startsWith('/auth/login')) void CapApp.exitApp();
      else if (url.startsWith('/tabs/')) void this.nav.navigateRoot('/tabs/home', { animated: false });
    });

    CapApp.addListener('appUrlOpen', ({ url }) => {
      void this.auth.handleDeepLink(url).then((path) => {
        if (path) void this.nav.navigateRoot(path, { replaceUrl: true });
      });
    }).catch(() => undefined);
    CapApp.addListener('pause', () => void this.timer.checkpoint()).catch(() => undefined);
    CapApp.addListener('resume', () => this.sync.schedule(0, true)).catch(() => undefined);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.timer.checkpoint();
      else this.sync.schedule(0, true);
    });
  }

  private async offerGuestImport(): Promise<void> {
    const n = await this.importer.refresh();
    if (!n) return;
    const t = this.i18n.t();
    const a = await this.alerts.create({
      header: t.importTitle,
      message: this.i18n.fmt(t.importBody, { n }),
      cssClass: 'gz-alert',
      buttons: [
        { text: t.importLater, role: 'cancel' },
        { text: t.importYes, role: 'confirm' },
      ],
    });
    await a.present();
    const { role } = await a.onDidDismiss();
    if (role !== 'confirm') return;
    const r = await this.importer.importGuestData();
    await this.ui.toast(this.i18n.fmt(t.importDone, { n: r.imported }));
  }
}
