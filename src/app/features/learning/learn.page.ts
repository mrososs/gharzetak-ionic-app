import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { IonContent, IonHeader, NavController } from '@ionic/angular';
import { VCAT_N, VCATS, VIDEOS, VLVL, VideoLevel } from '../../core/data/catalog';
import { photo } from '../../core/data/photos';
import { I18nService } from '../../core/i18n/i18n.service';
import { AppStore } from '../../core/state/app.store';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PhotoComponent } from '../../shared/ui/images/photo.component';

/** GZ-S19 — learning library (searchable tutorial topics; links out to YouTube). */
@Component({
  selector: 'gz-learn',
  imports: [IonHeader, IonContent, IconComponent, PhotoComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top" style="padding-top: calc(20px + var(--gz-safe-top))">
        <h1 class="gz-h1 gz-hd flex-1">{{ t().learn }}</h1>
        <button type="button" class="gz-icb" [class.flat]="!saved()" (click)="saved.set(!saved())" [attr.aria-pressed]="saved()" [attr.aria-label]="t().favs">
          <svg gzIcon="heart" [fill]="saved()" />
        </button>
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      <div class="gz-pad">
        <div class="gz-in mt-1">
          <svg gzIcon="search" />
          <input type="search" [value]="q()" (input)="q.set($any($event.target).value)" [placeholder]="t().searchVideos" [attr.aria-label]="t().searchVideos" />
        </div>
        <div class="gz-hs mt-3" style="padding-bottom: 4px">
          @for (c of cats; track c) {
            <button type="button" class="gz-chip sm" [class.on]="cat() === c" [attr.aria-pressed]="cat() === c" (click)="cat.set(c)">{{ VCAT_N[c][i18n.lang()] }}</button>
          }
        </div>
        <div class="gz-chips" style="margin: 2px 0 12px">
          @for (l of lvls(); track l.id) {
            <button type="button" class="gz-chip sm" [class.on]="lvl() === l.id" [attr.aria-pressed]="lvl() === l.id" (click)="lvl.set(l.id)">{{ l.label }}</button>
          }
        </div>
        <div class="gz-note lav mb-3"><svg gzIcon="info" size="s" /><span>{{ t().videoNote }}</span></div>
        <div class="flex flex-col gap-3">
          @for (v of items(); track v.id) {
            <div class="gz-pcard relative">
              <button type="button" class="gz-reset flex min-w-0 flex-1 gap-3" (click)="nav.navigateForward(['/tabs/learn', v.id])" [attr.aria-label]="v.title">
                <gz-photo class="flex-none" [tone]="v.tone" [icon]="null" [src]="v.img" [alt]="v.title" [showLabel]="false" height="88px" width="104px" extraClass="r16">
                  <span class="relative z-[1] flex h-[38px] w-[38px] items-center justify-center rounded-full bg-primary text-white"><svg gzIcon="play" size="s" [fill]="true" /></span>
                </gz-photo>
                <div class="flex min-w-0 flex-1 flex-col justify-center gap-1" style="padding-inline-end: 36px">
                  <span class="gz-b gz-hd" style="font-size: 15px; line-height: 1.35">{{ v.title }}</span>
                  <div class="flex flex-wrap gap-1.5"><span class="gz-badge {{ v.lvlCls }}">{{ v.lvlName }}</span><span class="gz-badge">{{ v.catName }}</span></div>
                  <span class="gz-xs gz-mute">{{ v.sub }}</span>
                </div>
              </button>
              <button type="button" class="gz-reset absolute flex h-11 w-11 items-center justify-center" style="top: 2px; inset-inline-end: 2px" [style.color]="v.fav ? 'var(--gz-pink-ink)' : 'var(--gz-text-2)'" (click)="store.toggleFavorite(v.id)" [attr.aria-pressed]="v.fav" [attr.aria-label]="t().favs">
                <svg gzIcon="heart" [fill]="v.fav" />
              </button>
            </div>
          }
        </div>
        @if (!items().length) {
          <div class="gz-card text-center" style="padding: 26px 18px">
            <div class="gz-tile t-lav mx-auto mb-2.5" style="width: 56px; height: 56px; border-radius: 20px"><svg gzIcon="search" size="l" /></div>
            <h2 class="gz-h3 gz-hd">{{ saved() ? i18n.q('مفيش شروحات محفوظة', 'No saved tutorials') : i18n.q('مفيش نتائج', 'No results') }}</h2>
            <p class="gz-mute gz-sm" style="margin: 4px 0 12px">{{ saved() ? i18n.q('اضغطي على القلب في أي شرح علشان تحفظيه.', 'Tap the heart on any tutorial to save it.') : i18n.q('جرّبي كلمة تانية أو امسحي الفلاتر.', 'Try another word or clear the filters.') }}</p>
            <button type="button" class="gz-btn3 w" (click)="clear()">{{ t().clearFilters }}</button>
          </div>
        }
      </div>
    </ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LearnPage {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(AppStore);
  protected readonly nav = inject(NavController);
  /** `?saved=1` (Home → favourites) opens the saved filter. */
  readonly savedParam = input<string | undefined>(undefined, { alias: 'saved' });

  protected readonly t = this.i18n.t;
  protected readonly cats = VCATS;
  protected readonly VCAT_N = VCAT_N;
  protected readonly q = signal('');
  protected readonly cat = signal<(typeof VCATS)[number]>('all');
  protected readonly lvl = signal<'all' | VideoLevel>('all');
  protected readonly saved = linkedSignal(() => this.savedParam() === '1');
  protected readonly lvls = computed(() => [
    { id: 'all' as const, label: this.i18n.q('كل المستويات', 'All levels') },
    ...(['beg', 'int', 'adv'] as VideoLevel[]).map((id) => ({ id, label: VLVL[id][this.i18n.lang()] })),
  ]);
  protected readonly items = computed(() => {
    const ql = this.q().trim().toLowerCase();
    const favs = this.store.favorites();
    const lang = this.i18n.lang();
    return VIDEOS.filter(
      (v) =>
        (this.cat() === 'all' || v.cat === this.cat()) &&
        (this.lvl() === 'all' || v.lvl === this.lvl()) &&
        (!this.saved() || favs.includes(v.id)) &&
        (!ql || `${v.ar} ${v.en} ${VCAT_N[v.cat].ar} ${VCAT_N[v.cat].en}`.toLowerCase().includes(ql)),
    ).map((v) => ({
      id: v.id,
      title: lang === 'ar' ? v.ar : v.en,
      sub: lang === 'ar' ? v.dAr : v.dEn,
      tone: v.tone,
      img: photo('vid_' + v.id),
      lvlName: VLVL[v.lvl][lang],
      lvlCls: VLVL[v.lvl].cls,
      catName: VCAT_N[v.cat][lang],
      fav: favs.includes(v.id),
    }));
  });

  protected clear(): void {
    this.q.set('');
    this.cat.set('all');
    this.lvl.set('all');
    this.saved.set(false);
  }
}
