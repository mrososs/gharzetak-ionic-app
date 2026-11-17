import { Injectable, inject } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular';
import { I18nService } from '../../../core/i18n/i18n.service';

/** Design-styled toasts and confirmation alerts. */
@Injectable({ providedIn: 'root' })
export class UiFeedback {
  private readonly toasts = inject(ToastController);
  private readonly alerts = inject(AlertController);
  private readonly i18n = inject(I18nService);

  async toast(message: string): Promise<void> {
    // Float above the tab bar when it is visible (design: toast sits 96px from the bottom).
    // Wait two frames so a tab bar re-shown by the navigation that triggered this toast is rendered.
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const bar = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('ion-tab-bar:not([hidden])') : null;
    const t = await this.toasts.create({ message, duration: 2600, position: 'bottom', cssClass: 'gz-toast', positionAnchor: bar ?? undefined });
    await t.present();
  }

  say(ar: string, en: string): Promise<void> {
    return this.toast(this.i18n.q(ar, en));
  }

  /**
   * Confirmation dialog in the unified style: the confirming action is the filled primary (filled danger when destructive),
   * Cancel is a quiet text button below it. Android hardware Back / backdrop count as Cancel.
   */
  async confirm(header: string, message: string, confirmText: string, destructive = true, cancelText?: string): Promise<boolean> {
    const t = this.i18n.t();
    const a = await this.alerts.create({
      header,
      message,
      cssClass: 'gz-alert',
      buttons: [
        { text: cancelText ?? t.cancel, role: 'cancel' },
        { text: confirmText, role: destructive ? 'destructive' : 'confirm' },
      ],
    });
    await a.present();
    const { role } = await a.onDidDismiss();
    return role === 'destructive' || role === 'confirm';
  }
}
