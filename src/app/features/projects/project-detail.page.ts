import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { IonContent, NavController } from '@ionic/angular';
import { parsePattern } from '../../core/domain/pattern-parser';
import { patternStats } from '../../core/domain/tracker-engine';
import { I18nService } from '../../core/i18n/i18n.service';
import { ProjectStatus } from '../../core/models/models';
import { TimerService } from '../../core/services/timer.service';
import { AppStore } from '../../core/state/app.store';
import { uuid } from '../../core/state/factories';
import { LocalDb } from '../../core/storage/local-db';
import { readImageFile } from '../../core/utils/image';
import { projectCard } from '../../shared/project-view';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PhotoComponent } from '../../shared/ui/images/photo.component';

/** GZ-S12 — project details (/tabs/projects/:id). */
@Component({
  selector: 'gz-project-detail',
  imports: [IonContent, IconComponent, PhotoComponent],
  template: `
    <ion-content class="gz-scroll">
      @if (p(); as p) {
        @let c = card()!;
        <div style="padding-bottom: 28px">
          <div class="relative">
            <gz-photo [tone]="c.tone" [src]="c.img" [storagePath]="c.storagePath" [alt]="c.alt" iconSize="xl" height="calc(230px + var(--gz-safe-top))" extraClass="pd-hero" />
            <button type="button" class="gz-icb" style="position: absolute; top: calc(16px + var(--gz-safe-top)); inset-inline-start: 16px" (click)="nav.back()" [attr.aria-label]="t().back"><svg gzIcon="arrowl" [flip]="true" /></button>
            <label class="gz-icb" style="position: absolute; inset-inline-end: 10px; bottom: 10px; width: auto; border-radius: 999px; padding: 0 14px; gap: 6px; font-weight: 700; font-size: 13px; cursor: pointer">
              <input class="gz-sr" type="file" accept="image/*" (change)="onCover($event)" /><svg gzIcon="camera" size="s" />{{ t().changeCover }}
            </label>
          </div>
          <div class="px-5">
            <div class="mt-4 flex flex-wrap gap-1.5"><span class="gz-badge">{{ c.catName }}</span><span class="gz-badge {{ c.stCls }}">{{ c.stName }}</span></div>
            <h1 class="gz-h1 gz-hd mt-1.5">{{ p.name }}</h1>
            <div class="gz-sm gz-mute flex items-center gap-2.5" style="margin: 6px 0 8px"><span class="flex-1">{{ c.roundLabel }} · {{ c.lastText }}</span><span class="gz-b" style="color: var(--gz-primary); font-size: 16px">{{ c.pct }}%</span></div>
            <div class="gz-bar"><i [style.width.%]="c.pct"></i></div>
            <button type="button" class="gz-btn mt-4" (click)="resume()"><svg gzIcon="play" />{{ t().resumeProject }}</button>

            <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ t().status }}</h2></div>
            <div class="gz-chips">
              @for (s of statuses; track s) {
                <button type="button" class="gz-chip sm" [class.on]="p.status === s" [attr.aria-pressed]="p.status === s" (click)="setStatus(s)">{{ store.statusName(s) }}</button>
              }
            </div>

            <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ t().tracker }}</h2></div>
            <button type="button" class="gz-card soft gz-reset block w-full" (click)="openTracker()">
              <div class="flex items-center gap-3">
                <div class="gz-tile t-lav" style="width: 48px; height: 48px"><svg gzIcon="counter" /></div>
                <div class="min-w-0 flex-1"><div class="gz-b">{{ p.tracker.mode === 'pattern' ? t().patternCounter : t().simpleCounter }}</div><div class="gz-sm gz-mute gz-ltr" style="direction: inherit">{{ trkLine() }}</div></div>
                <svg gzIcon="chevr" size="s" [flip]="true" />
              </div>
            </button>

            <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ t().attachedPattern }}</h2></div>
            @if (pattern(); as pt) {
              <button type="button" class="gz-card soft gz-reset block w-full" (click)="nav.navigateForward(['/tabs/home/patterns', pt.id])">
                <div class="flex items-center gap-3">
                  <div class="gz-tile t-blush" style="width: 48px; height: 48px"><svg gzIcon="file" /></div>
                  <div class="min-w-0 flex-1"><div class="gz-b">{{ store.patternName(pt) }}</div><div class="gz-sm gz-mute">{{ patLine() }}</div></div>
                  <svg gzIcon="chevr" size="s" [flip]="true" />
                </div>
              </button>
            } @else {
              <div class="gz-note lav"><span>{{ t().noPatAttached }}</span></div>
            }
            <div class="gz-hs mt-2">
              @for (x of store.patterns(); track x.id) {
                <button type="button" class="gz-chip sm" [class.on]="p.tracker.patternId === x.id && p.tracker.mode === 'pattern'" [attr.aria-pressed]="p.tracker.patternId === x.id" (click)="linkPattern(x.id)">{{ store.patternName(x) }}</button>
              }
            </div>

            <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ t().materials }}</h2></div>
            <div class="gz-grid-2">
              <div class="gz-card soft" style="padding: 12px 14px"><div class="gz-xs gz-mute">{{ t().hook }}</div><div class="gz-b gz-hd gz-ltr" style="font-size: 18px">{{ p.hook }} mm</div></div>
              <div class="gz-card soft" style="padding: 12px 14px"><div class="gz-xs gz-mute">{{ t().yarn }}</div><div class="gz-b gz-hd" style="font-size: 18px">{{ store.yarnName(p.yarn) }}</div></div>
              <div class="gz-card soft" style="padding: 12px 14px"><div class="gz-xs gz-mute">{{ t().recorded }}</div><div class="gz-b gz-hd" style="font-size: 18px">{{ store.duration(timer.elapsedFor(p.id, p.workedSeconds)) }}</div></div>
              <div class="gz-card soft" style="padding: 12px 14px"><div class="gz-xs gz-mute">{{ t().estimated }}</div><div class="gz-b gz-hd" style="font-size: 18px">{{ p.estimatedHours ? p.estimatedHours + (i18n.isAr() ? ' س' : ' h') : '—' }}</div></div>
            </div>

            <div class="gz-sec">
              <h2 class="gz-h3 gz-hd">{{ t().progressPhotos }}</h2>
              <label class="gz-btn3" style="min-height: 40px; font-size: 13px; cursor: pointer"><input class="gz-sr" type="file" accept="image/*" (change)="onPhoto($event)" /><svg gzIcon="camera" size="s" />{{ t().addPhoto }}</label>
            </div>
            @if (p.photos.length) {
              <div class="grid grid-cols-3 gap-2">
                @for (ph of p.photos; track ph.id) {
                  <gz-photo tone="lav" [src]="ph.localUrl" [storagePath]="ph.storagePath" [alt]="t().progressPhotos" [showLabel]="false" [icon]="null" extraClass="r16 aspect-square" />
                }
              </div>
            } @else {
              <div class="gz-note lav"><svg gzIcon="camera" size="s" /><span>{{ t().noPhotos }}</span></div>
            }

            <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ t().notes }}</h2></div>
            <textarea class="gz-ta" [placeholder]="t().notesPh" [value]="p.notes" (input)="onNotes($event)" [attr.aria-label]="t().notes" maxlength="10000"></textarea>

            <button type="button" class="gz-btn3 rose w mt-6" (click)="remove()"><svg gzIcon="trash" size="s" />{{ t().deleteProject }}</button>
          </div>
        </div>
      } @else {
        <div class="gz-pad pt-16 text-center">
          <p class="gz-mute">{{ t().emptyProjBody }}</p>
          <button type="button" class="gz-btn3 w" (click)="nav.navigateRoot('/tabs/projects')">{{ t().myProjects }}</button>
        </div>
      }
    </ion-content>
  `,
  styles: `:host ::part(scroll) { padding-top: 0; } :host .pd-hero { border-radius: 0 0 30px 30px; }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectDetailPage {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(AppStore);
  protected readonly nav = inject(NavController);
  protected readonly timer = inject(TimerService);
  private readonly ui = inject(UiFeedback);
  private readonly db = inject(LocalDb);
  readonly id = input.required<string>();

  protected readonly t = this.i18n.t;
  protected readonly statuses: ProjectStatus[] = ['active', 'paused', 'done'];
  protected readonly p = computed(() => this.store.project(this.id()));
  protected readonly card = computed(() => {
    const p = this.p();
    return p ? projectCard(this.store, this.i18n, p) : null;
  });
  protected readonly pattern = computed(() => {
    const p = this.p();
    return p && p.tracker.mode === 'pattern' ? this.store.pattern(p.tracker.patternId) : null;
  });
  protected readonly patLine = computed(() => {
    const pt = this.pattern();
    return pt ? `${parsePattern(pt.text).rounds.length} ${this.i18n.q('أدوار', 'rounds')}` : '';
  });
  protected readonly trkLine = computed(() => {
    const p = this.p();
    if (!p) return '';
    const pt = this.pattern();
    if (pt) {
      const parsed = parsePattern(pt.text);
      const st = patternStats(parsed, p.tracker.cursor);
      if (st) return `${this.store.patternName(pt)} · R${st.roundNumber} · ${st.overallProduced}/${st.overallTotal}`;
    }
    const s = p.tracker.simple;
    return `${s.count}/${s.target} ${this.t().stitchesU} · ${this.card()?.roundLabel ?? ''}`;
  });

  private notesTimer: ReturnType<typeof setTimeout> | null = null;

  protected async setStatus(s: ProjectStatus): Promise<void> {
    await this.store.setStatus(this.id(), s);
    if (s === 'done') await this.ui.say('مبروك على المشروع المكتمل!', 'Congratulations on finishing!');
  }

  protected async resume(): Promise<void> {
    const p = this.p();
    if (!p) return;
    if (p.status === 'paused') await this.store.setStatus(p.id, 'active');
    await this.openTracker();
  }

  protected async openTracker(): Promise<void> {
    await this.store.setCurrentProject(this.id());
    await this.nav.navigateRoot('/tabs/tracker');
  }

  protected linkPattern(patternId: string): void {
    const pat = this.store.pattern(patternId);
    void this.store.updateTracker(this.id(), (t) =>
      t.patternId === patternId && t.mode === 'pattern'
        ? { ...t, patternId: null, mode: 'simple' }
        : { ...t, patternId, mode: 'pattern', cursor: { ...t.cursor, roundIndex: 0, ptr: 0, history: [] }, simple: { ...t.simple, totalRounds: pat ? parsePattern(pat.text).rounds.length : t.simple.totalRounds } },
    ).then(() => this.store.updateProject(this.id(), (x) => x));
  }

  protected async onCover(ev: Event): Promise<void> {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const r = await readImageFile(file);
    if ('error' in r) return this.ui.toast(this.t()[r.error]);
    await this.store.updateProject(this.id(), (p) => ({ ...p, coverLocalUrl: r.dataUrl }), ['cover']);
    await this.ui.say('تم تحديث الغلاف', 'Cover updated');
  }

  protected async onPhoto(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const r = await readImageFile(file);
    if ('error' in r) return this.ui.toast(this.t()[r.error]);
    const photoId = uuid();
    await this.store.updateProject(this.id(), (p) => ({ ...p, photos: [...p.photos, { id: photoId, localUrl: r.dataUrl, storagePath: null, createdAt: Date.now() }] }), []);
    const scope = this.store.scope();
    if (scope !== 'guest') {
      await this.db.enqueue({ scope, kind: 'photo', id: photoId, op: 'upsert', payload: { projectId: this.id() } });
      this.store.onQueued?.();
    }
    await this.ui.say('تمت إضافة الصورة', 'Photo added');
  }

  protected onNotes(ev: Event): void {
    const v = (ev.target as HTMLTextAreaElement).value;
    if (this.notesTimer) clearTimeout(this.notesTimer);
    this.notesTimer = setTimeout(() => void this.store.updateProject(this.id(), (p) => ({ ...p, notes: v }), ['note']), 400);
  }

  protected async remove(): Promise<void> {
    const t = this.t();
    if (!(await this.ui.confirm(t.deleteTitle, t.deleteBody, t.delete))) return;
    if (this.timer.running()?.projectId === this.id()) await this.timer.stop();
    await this.store.deleteProject(this.id());
    await this.nav.navigateRoot('/tabs/projects');
  }
}
