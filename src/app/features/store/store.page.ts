import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonContent, IonInput, NavController } from '@ionic/angular';
import { AuthService } from '../../core/auth/auth.service';
import { STORE_CATS } from '../../core/data/catalog';
import { photo } from '../../core/data/photos';
import { I18nService } from '../../core/i18n/i18n.service';
import { AppStore } from '../../core/state/app.store';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PhotoComponent } from '../../shared/ui/images/photo.component';

/** GZ-S24 — store teaser (coming soon). No products, prices or checkout exist. */
@Component({
  selector: 'gz-store',
  imports: [IonContent, IonInput, ReactiveFormsModule, IconComponent, PhotoComponent],
  template: `
    <ion-content class="gz-scroll">
      <div style="padding-bottom: 28px">
        <div class="relative">
          <gz-photo tone="blush" icon="bag" iconSize="xl" [src]="hero" [alt]="i18n.q('صورة: خيوط ومنتجات كروشيه', 'Photo: yarn and crochet products')" height="calc(250px + var(--gz-safe-top))" extraClass="store-hero" />
          <button type="button" class="gz-icb" style="position: absolute; top: calc(16px + var(--gz-safe-top)); inset-inline-start: 16px" (click)="nav.back()" [attr.aria-label]="t().back"><svg gzIcon="arrowl" [flip]="true" /></button>
        </div>
        <div class="px-5">
          <span class="gz-badge rose mt-4" style="font-size: 13px; padding: 5px 14px">{{ t().comingSoon }}</span>
          <h1 class="gz-h1 gz-hd mt-2">{{ t().storeTitle }}</h1>
          <p class="gz-mute" style="margin: 6px 0 0">{{ t().storeBody }}</p>

          <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ t().previewCats }}</h2></div>
          <div class="grid grid-cols-2 gap-3">
            @for (c of cats(); track c.id) {
              <div class="gz-hcard" style="width: auto; box-shadow: none; border: 1px solid var(--gz-border)">
                <gz-photo [tone]="c.tone" [icon]="c.icon" [src]="c.img" [alt]="c.name" [showLabel]="false" height="96px" />
                <div style="padding: 10px 12px"><div class="gz-b">{{ c.name }}</div><div class="gz-xs gz-mute">{{ c.desc }}</div></div>
              </div>
            }
          </div>

          <div class="gz-card mt-5">
            <h2 class="gz-h3 gz-hd">{{ t().notifyTitle }}</h2>
            @if (store.storeNotified()) {
              <div class="gz-note sage gz-pulse mt-2.5"><svg gzIcon="check" /><span class="gz-b">{{ t().notifyDone }}</span></div>
              <button type="button" class="gz-lnk" (click)="undo()">{{ t().notifyUndo }}</button>
            } @else {
              <p class="gz-mute gz-sm" style="margin: 2px 0 10px">{{ t().notifyBody }}</p>
              <div class="gz-in" [class.invalid]="err()">
                <svg gzIcon="mail" />
                <ion-input [formControl]="email" type="email" inputmode="email" autocomplete="email" dir="ltr" placeholder="name@example.com" [attr.aria-label]="t().email" />
              </div>
              @if (err()) {
                <div class="gz-err" role="alert">{{ t().errEmail }}</div>
              }
              <button type="button" class="gz-btn mt-2.5" (click)="notify()"><svg gzIcon="bell" />{{ t().notifyMe }}</button>
              <p class="gz-xs gz-mute mt-2">{{ auth.signedIn() ? t().notifyDemo : t().createAccount }}</p>
            }
          </div>
        </div>
      </div>
    </ion-content>
  `,
  styles: `:host .store-hero { border-radius: 0 0 32px 32px; }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StorePage {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(AppStore);
  protected readonly auth = inject(AuthService);
  protected readonly nav = inject(NavController);
  protected readonly t = this.i18n.t;
  protected readonly hero = photo('store_hero');
  protected readonly email = new FormControl(this.store.storeEmail() || this.auth.email(), { nonNullable: true, validators: [Validators.required, Validators.email] });
  protected readonly err = signal(false);
  protected readonly cats = computed(() =>
    STORE_CATS.map((c) => ({ id: c.id, name: c[this.i18n.lang()], desc: this.i18n.isAr() ? c.dAr : c.dEn, tone: c.tone, icon: c.icon, img: photo('store_' + c.id) })),
  );

  protected notify(): void {
    if (this.email.invalid) return void this.err.set(true);
    this.err.set(false);
    void this.store.setStoreInterest(this.email.value.trim(), true);
  }

  protected undo(): void {
    void this.store.setStoreInterest('', false);
    this.email.setValue('');
  }
}
