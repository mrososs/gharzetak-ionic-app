import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal } from '@angular/core';
import { IonContent, IonHeader, NavController } from '@ionic/angular';
import { I18nService } from '../../core/i18n/i18n.service';
import { ProjectStatus } from '../../core/models/models';
import { AppStore } from '../../core/state/app.store';
import { projectCard } from '../../shared/project-view';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PhotoComponent } from '../../shared/ui/images/photo.component';

const TABS: ProjectStatus[] = ['active', 'paused', 'done'];

/** GZ-S11 My projects · GZ-T01 done tab (?status=done) · GZ-T02 empty state. */
@Component({
  selector: 'gz-projects',
  imports: [IonHeader, IonContent, IconComponent, PhotoComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top" style="padding-top: calc(20px + var(--gz-safe-top))">
        <h1 class="gz-h1 gz-hd flex-1">{{ t().myProjects }}</h1>
        <button type="button" class="gz-btn3" style="padding: 0 16px" (click)="newProject()"><svg gzIcon="plus" size="s" />{{ t().newShort }}</button>
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      <div class="gz-pad">
        <div class="gz-seg" style="margin: 6px 0 14px" role="tablist">
          @for (s of tabs; track s) {
            <button type="button" role="tab" [class.on]="tab() === s" [attr.aria-selected]="tab() === s" (click)="tab.set(s)">{{ store.statusName(s) }} <span class="gz-xs">({{ counts()[s] }})</span></button>
          }
        </div>
        <div class="flex flex-col gap-3">
          @for (p of items(); track p.id) {
            <button type="button" class="gz-pcard" (click)="nav.navigateForward(['/tabs/projects', p.id])" [attr.aria-label]="p.name">
              <gz-photo class="flex-none" [tone]="p.tone" [src]="p.img" [storagePath]="p.storagePath" [alt]="p.alt" [showLabel]="false" height="92px" width="92px" extraClass="r16" />
              <div class="flex min-w-0 flex-1 flex-col justify-center gap-1">
                <span class="gz-b gz-hd truncate" style="font-size: 16px">{{ p.name }}</span>
                <div class="flex flex-wrap gap-1.5"><span class="gz-badge">{{ p.catName }}</span><span class="gz-badge {{ p.stCls }}">{{ p.stName }}</span></div>
                <div class="gz-bar thin mt-1"><i [style.width.%]="p.pct"></i></div>
                <div class="gz-xs gz-mute flex justify-between"><span>{{ p.roundLabel }}</span><span class="gz-b" style="color: var(--gz-primary)">{{ p.pct }}%</span></div>
                <div class="gz-xs gz-mute">{{ p.lastText }}</div>
              </div>
            </button>
          }
        </div>
        @if (!items().length) {
          <div class="gz-card text-center" style="padding: 28px 20px">
            <div class="gz-tile t-lav mx-auto mb-2.5" style="width: 60px; height: 60px; border-radius: 20px"><svg gzIcon="folder" size="l" /></div>
            <h2 class="gz-h3 gz-hd">{{ emptyTitle() }}</h2>
            <p class="gz-mute gz-sm" style="margin: 4px 0 14px">{{ t().emptyProjBody }}</p>
            <button type="button" class="gz-btn3 w" (click)="newProject()">{{ t().newProject }}</button>
          </div>
        }
        <button type="button" class="gz-rcard dashed mt-3.5 text-center" style="min-height: 56px" (click)="newProject()">
          <span class="flex items-center justify-center gap-2.5 font-bold" style="color: var(--gz-primary)"><svg gzIcon="plus" />{{ t().newProject }}</span>
        </button>
      </div>
    </ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectsPage {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(AppStore);
  protected readonly nav = inject(NavController);
  readonly status = input<string>();

  protected readonly t = this.i18n.t;
  protected readonly tabs = TABS;
  protected readonly tab = linkedSignal<ProjectStatus>(() => (TABS.includes(this.status() as ProjectStatus) ? (this.status() as ProjectStatus) : 'active'));
  protected readonly counts = computed(() => {
    const c: Record<ProjectStatus, number> = { active: 0, paused: 0, done: 0 };
    for (const p of this.store.projects()) c[p.status]++;
    return c;
  });
  protected readonly items = computed(() =>
    this.store
      .sortedProjects()
      .filter((p) => p.status === this.tab())
      .map((p) => projectCard(this.store, this.i18n, p)),
  );
  protected readonly emptyTitle = computed(() =>
    ({ active: this.i18n.q('مفيش مشاريع نشطة', 'No active projects'), paused: this.i18n.q('مفيش مشاريع متوقفة', 'No paused projects'), done: this.i18n.q('مفيش مشاريع مكتملة لسه', 'No completed projects yet') })[this.tab()],
  );

  protected newProject(): void {
    void this.nav.navigateForward('/tabs/projects/new');
  }
}
