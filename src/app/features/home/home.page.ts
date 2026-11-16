import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { IonContent, IonRefresher, IonRefresherContent, NavController } from '@ionic/angular';
import { AuthService } from '../../core/auth/auth.service';
import { ACC, Tone } from '../../core/data/catalog';
import { IconName } from '../../core/data/icons';
import { photo } from '../../core/data/photos';
import { I18nService } from '../../core/i18n/i18n.service';
import { AppStore } from '../../core/state/app.store';
import { SyncService } from '../../core/sync/sync.service';
import { projectCard } from '../../shared/project-view';
import { NotificationsSheetBody, ToolsSheetBody } from '../../shared/ui/dialogs/common-sheets';
import { SheetComponent } from '../../shared/ui/dialogs/sheet.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { CrochetAvatarComponent } from '../../shared/ui/avatar/crochet-avatar.component';
import { PhotoComponent } from '../../shared/ui/images/photo.component';

interface QuickTile {
  label: string;
  icon: IconName;
  tone: Tone;
  go: () => void;
}

/** GZ-S10 — Home dashboard. */
@Component({
  selector: 'gz-home',
  imports: [IonContent, IonRefresher, IonRefresherContent, IconComponent, CrochetAvatarComponent, PhotoComponent, SheetComponent, ToolsSheetBody, NotificationsSheetBody],
  template: `
    <ion-content class="gz-scroll">
      @if (sync.active()) {
        <ion-refresher slot="fixed" (ionRefresh)="refresh($event)"><ion-refresher-content /></ion-refresher>
      }
      <div class="gz-pad" style="padding-top: calc(16px + var(--gz-safe-top))">
        <div class="flex items-center gap-3">
          <button type="button" class="gz-avatar-btn" (click)="nav.navigateForward('/tabs/home/settings')" [attr.aria-label]="t().settings"><gz-crochet-avatar [id]="store.avatar()" [size]="50" [decorative]="true" /></button>
          <div class="min-w-0 flex-1">
            <div class="gz-hd" style="font-size: 16px">{{ t().greet }}</div>
            <div class="gz-sm gz-mute truncate">{{ name() }} · {{ store.levelName(store.profile().level) }}</div>
          </div>
          <button type="button" class="gz-icb" (click)="sheet.set('notif')" [attr.aria-label]="t().notifs"><svg gzIcon="bell" /><span class="gz-dot"></span></button>
          <button type="button" class="gz-icb" (click)="openFavs()" [attr.aria-label]="t().favs"><svg gzIcon="heart" /></button>
        </div>

        @if (syncNote(); as note) {
          <div class="gz-note lav mt-3" role="status"><svg gzIcon="cloud" size="s" /><span>{{ note }}</span></div>
        }

        @if (cur(); as c) {
          <div class="gz-hero mt-[18px]">
            <button type="button" class="gz-reset block w-full" (click)="resume(c.id)" [attr.aria-label]="t().resume + ' — ' + c.name">
              <gz-photo [tone]="c.tone" [src]="c.img" [storagePath]="c.storagePath" [alt]="c.alt" iconSize="xl" height="178px" />
              <div style="padding: 14px 16px 16px">
                <span class="gz-badge">{{ t().curProj }}</span>
                <h2 class="gz-h2 gz-hd" style="margin: 6px 0 4px">{{ c.name }}</h2>
                <div class="gz-sm gz-mute mb-2 flex items-center gap-2.5"><span class="flex-1">{{ c.roundLabel }}</span><span class="gz-b" style="color: var(--gz-primary); font-size: 15px">{{ c.pct }}%</span></div>
                <div class="gz-bar"><i [style.width.%]="c.pct"></i></div>
                <div class="gz-btn mt-3.5">{{ t().resume }}<svg gzIcon="arrow" [flip]="true" /></div>
              </div>
            </button>
            <button type="button" class="gz-icb" style="position: absolute; top: 12px; inset-inline-end: 12px; width: 44px; height: 44px" (click)="nav.navigateForward(['/tabs/projects', c.id])" [attr.aria-label]="t().projDetails">
              <svg gzIcon="list" />
            </button>
          </div>
        } @else {
          <div class="gz-card mt-[18px] text-center" style="padding: 26px 20px">
            <div class="gz-tile t-lav mx-auto mb-3" style="width: 64px; height: 64px; border-radius: 20px"><svg gzIcon="yarn" size="l" /></div>
            <h2 class="gz-h2 gz-hd">{{ t().noProjTitle }}</h2>
            <p class="gz-mute gz-sm" style="margin: 4px 0 14px">{{ t().noProjBody }}</p>
            <button type="button" class="gz-btn" (click)="nav.navigateForward('/tabs/projects/new')"><svg gzIcon="plus" />{{ t().newProject }}</button>
          </div>
        }

        <button type="button" class="gz-card gz-reset mt-3.5 block w-full" style="padding: 14px 16px" (click)="sheet.set('tools')" [attr.aria-label]="t().myTools">
          <div class="mb-2.5 flex items-center gap-3">
            <div class="gz-tile t-lav" style="width: 44px; height: 44px"><svg gzIcon="hook" /></div>
            <div class="flex-1"><div class="gz-b gz-hd" style="font-size: 16px">{{ t().myTools }}</div><div class="gz-xs gz-mute">{{ t().myToolsSub }}</div></div>
            <svg gzIcon="chevr" size="s" [flip]="true" />
          </div>
          <div class="gz-chips">
            @for (c of toolChips(); track c.label) {
              <span class="gz-badge {{ c.cls }}"><span class="gz-ltr">{{ c.label }}</span></span>
            }
          </div>
        </button>

        <div class="gz-sec"><h2 class="gz-h2 gz-hd">{{ t().quick }}</h2></div>
        <div class="gz-grid-3">
          @for (q of quick(); track q.label) {
            <button type="button" class="gz-qt" (click)="q.go()">
              <span class="qi t-{{ q.tone }}"><svg [gzIcon]="q.icon" /></span>{{ q.label }}
            </button>
          }
        </div>

        <div class="gz-sec"><h2 class="gz-h2 gz-hd">{{ t().prevProj }}</h2><button type="button" class="gz-lnk" (click)="nav.navigateRoot('/tabs/projects')">{{ t().seeAll }}</button></div>
        @if (prev().length) {
          <div class="gz-hs">
            @for (p of prev(); track p.id) {
              <button type="button" class="gz-hcard" (click)="nav.navigateForward(['/tabs/projects', p.id])" [attr.aria-label]="p.name">
                <gz-photo [tone]="p.tone" [src]="p.img" [storagePath]="p.storagePath" [alt]="p.alt" height="104px" />
                <div style="padding: 10px 12px 12px">
                  <div class="gz-b" style="font-size: 14px; line-height: 1.45; min-height: 36px">{{ p.name }}</div>
                  <div class="gz-xs gz-mute" style="margin: 2px 0 8px">{{ p.lastText }}</div>
                  <div class="gz-bar thin"><i [style.width.%]="p.pct"></i></div>
                  <div class="gz-xs gz-b mt-1" style="color: var(--gz-primary)">{{ p.pct }}%</div>
                </div>
              </button>
            }
          </div>
        } @else {
          <div class="gz-note lav"><span>{{ t().noPrev }}</span></div>
        }

        <div class="gz-sec"><h2 class="gz-h2 gz-hd">{{ t().storeOffers }}</h2><span class="gz-badge rose">{{ t().soon }}</span></div>
        <div class="gz-grid-3">
          @for (c of storeCards(); track c.name) {
            <button type="button" class="gz-hcard" style="width: auto" (click)="nav.navigateForward('/tabs/home/store')" [attr.aria-label]="c.name">
              <gz-photo [tone]="c.tone" [icon]="c.icon" [src]="c.img" [alt]="c.name" [showLabel]="false" height="84px" />
              <div style="padding: 8px 8px 10px"><div class="gz-b gz-xs" style="line-height: 1.45; min-height: 32px">{{ c.name }}</div><span class="gz-badge rose mt-1">{{ t().soon }}</span></div>
            </button>
          }
        </div>
        <p class="gz-xs gz-mute mt-2.5 text-center">{{ t().storeNote }}</p>
      </div>
    </ion-content>

    <gz-sheet [open]="sheet() === 'tools'" [label]="t().myTools" (closed)="sheet.set(null)"><gz-tools-sheet-body (done)="sheet.set(null)" /></gz-sheet>
    <gz-sheet [open]="sheet() === 'notif'" [label]="t().notifs" (closed)="sheet.set(null)"><gz-notif-sheet-body (done)="sheet.set(null)" /></gz-sheet>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(AppStore);
  protected readonly nav = inject(NavController);
  protected readonly sync = inject(SyncService);
  private readonly auth = inject(AuthService);
  protected readonly t = this.i18n.t;
  protected readonly sheet = signal<'tools' | 'notif' | null>(null);

  protected readonly name = computed(() => this.store.profile().displayName || (this.auth.email() ? this.auth.email().split('@')[0] : this.i18n.q('ضيفتنا', 'Guest')));
  protected readonly cur = computed(() => {
    const p = this.store.currentProject();
    return p ? projectCard(this.store, this.i18n, p) : null;
  });
  protected readonly prev = computed(() => {
    const cur = this.store.currentProject();
    return this.store
      .sortedProjects()
      .filter((p) => p.id !== cur?.id)
      .slice(0, 8)
      .map((p) => projectCard(this.store, this.i18n, p));
  });
  protected readonly toolChips = computed(() => {
    const pf = this.store.profile();
    const lang = this.i18n.lang();
    const chips = [
      ...[...pf.hooks].sort().map((h) => ({ label: h + ' mm', cls: '' })),
      ...pf.yarns.map((y) => ({ label: this.store.yarnName(y), cls: 'rose' })),
      ...pf.accessories.map((a) => ({ label: ACC[a][lang], cls: 'sage' })),
    ];
    const shown = chips.slice(0, 8);
    if (chips.length > 8) shown.push({ label: '+' + (chips.length - 8), cls: 'peach' });
    return shown;
  });
  protected readonly quick = computed<QuickTile[]>(() => {
    const q = (a: string, e: string) => this.i18n.q(a, e);
    return [
      { label: q('عدّاد الغرز', 'Stitch tracker'), icon: 'counter', tone: 'lav', go: () => this.nav.navigateRoot('/tabs/tracker') },
      { label: q('المساعد الذكي', 'AI assistant'), icon: 'sparkles', tone: 'blush', go: () => this.nav.navigateRoot('/tabs/assistant') },
      { label: q('قارئ الباترن', 'Pattern reader'), icon: 'file', tone: 'sage', go: () => this.nav.navigateForward('/tabs/home/patterns') },
      { label: q('محوّل المصطلحات', 'Terminology'), icon: 'convert', tone: 'peach', go: () => this.nav.navigateForward('/tabs/home/terms') },
      { label: q('فيديوهات تعليمية', 'Video tutorials'), icon: 'film', tone: 'lav', go: () => this.nav.navigateRoot('/tabs/learn') },
      { label: q('مشروع جديد', 'New project'), icon: 'plus', tone: 'blush', go: () => this.nav.navigateForward('/tabs/projects/new') },
    ];
  });
  protected readonly storeCards = computed(() => [
    { name: this.i18n.q('خيوط أساسية', 'Yarn essentials'), tone: 'lav' as Tone, icon: 'yarn' as IconName, img: photo('store_yarn') },
    { name: this.i18n.q('إبر كروشيه', 'Crochet hooks'), tone: 'blush' as Tone, icon: 'hook' as IconName, img: photo('store_hooks') },
    { name: this.i18n.q('باقات باترنات', 'Pattern bundles'), tone: 'sage' as Tone, icon: 'file' as IconName, img: photo('store_patterns') },
  ]);
  protected readonly syncNote = computed(() => {
    if (!this.auth.signedIn()) return null;
    const s = this.sync.state();
    if (s === 'offline') return this.t().offline;
    return null;
  });

  protected async resume(id: string): Promise<void> {
    await this.store.setCurrentProject(id);
    await this.nav.navigateRoot('/tabs/tracker');
  }

  protected openFavs(): void {
    void this.nav.navigateRoot('/tabs/learn', { queryParams: { saved: 1 } });
  }

  protected async refresh(ev: CustomEvent): Promise<void> {
    this.sync.schedule(0, true);
    await this.sync.run();
    (ev.target as HTMLIonRefresherElement).complete();
  }
}
