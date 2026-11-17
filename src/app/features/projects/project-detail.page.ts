import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { IonContent, NavController } from '@ionic/angular';
import { instanceLabel, instanceProgress, planCollectionUpdate, projectCompletion, siblingsOf } from '../../core/domain/collections';
import { parsePattern } from '../../core/domain/pattern-parser';
import { diffPatterns, mapCursor } from '../../core/domain/revisions';
import { compareTime, estimatedHoursToMinutes, formatMinutes, minutesToEstimatedHours } from '../../core/domain/time';
import { patternStats } from '../../core/domain/tracker-engine';
import { I18nService } from '../../core/i18n/i18n.service';
import { ProjectStatus } from '../../core/models/models';
import { TimerService } from '../../core/services/timer.service';
import { ProjectFinishService } from '../../core/joy/project-finish.service';
import { AppStore } from '../../core/state/app.store';
import { uuid } from '../../core/state/factories';
import { LocalDb } from '../../core/storage/local-db';
import { readImageFile } from '../../core/utils/image';
import { projectCard } from '../../shared/project-view';
import { SheetComponent } from '../../shared/ui/dialogs/sheet.component';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PhotoComponent } from '../../shared/ui/images/photo.component';
import { DurationInputComponent } from '../../shared/ui/inputs/duration-input.component';

/** GZ-S12 — project details (/tabs/projects/:id). */
@Component({
  selector: 'gz-project-detail',
  imports: [IonContent, IconComponent, PhotoComponent, SheetComponent, DurationInputComponent],
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

            <!-- a newer pattern / collection version exists: the project stays on its own version until the user updates -->
            @if (outdated()) {
              <div class="gz-note peach mt-3" role="status">
                <svg gzIcon="info" size="s" />
                <span class="flex-1">{{ i18n.q('الباترون اتعدّل بعد ما بدأتي المشروع. مشروعك لسه على النسخة اللي بدأتي بيها.', 'The pattern was edited after you started this project. Your project still follows the version you started with.') }}</span>
              </div>
              <button type="button" class="gz-btn2 mt-2" (click)="openUpdate()">{{ i18n.q('مراجعة التحديث', 'Review the update') }}</button>
            }

            <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ t().status }}</h2></div>
            <div class="gz-chips">
              @for (s of statuses; track s) {
                <button type="button" class="gz-chip sm" [class.on]="p.status === s" [attr.aria-pressed]="p.status === s" (click)="setStatus(s)">{{ store.statusName(s) }}</button>
              }
            </div>

            <!-- time: estimate vs recorded -->
            <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ i18n.q('الوقت', 'Time') }}</h2></div>
            @let tm = time()!;
            <div class="gz-card soft" style="padding: 14px 16px">
              <div class="grid grid-cols-2 gap-3">
                <div><div class="gz-xs gz-mute">{{ i18n.q('الوقت المتوقع', 'Estimated time') }}</div><div class="gz-b gz-hd" style="font-size: 16px">{{ tm.state === 'none' ? '—' : fmt(tm.estimatedMinutes) }}</div></div>
                <div><div class="gz-xs gz-mute">{{ i18n.q('الوقت المسجل', 'Recorded time') }}</div><div class="gz-b gz-hd" style="font-size: 16px">{{ fmt(tm.recordedMinutes) }}</div></div>
              </div>
              @if (tm.state === 'none') {
                <div class="gz-sm gz-mute mt-3">{{ i18n.q('لم يتم تحديد وقت متوقع', 'No estimated time set') }}</div>
                <button type="button" class="gz-btn3 w mt-2" (click)="openEstimate()"><svg gzIcon="clock" size="s" />{{ i18n.q('إضافة وقت متوقع', 'Add an estimate') }}</button>
              } @else {
                <div class="gz-bar thin mt-3" role="progressbar" [attr.aria-valuenow]="tm.percent" aria-valuemin="0" aria-valuemax="100" [attr.aria-label]="i18n.q('الوقت المسجل مقارنة بالمتوقع', 'Recorded time compared with the estimate')"><i [style.width.%]="tm.percent" [style.background]="tm.state === 'over' ? 'var(--gz-pink-ink)' : ''"></i></div>
                <div class="mt-2 flex items-center justify-between gap-2">
                  @if (tm.state === 'over') {
                    <span class="gz-sm gz-b" style="color: var(--gz-pink-ink)">{{ i18n.q('تجاوز الوقت المتوقع', 'Over the estimate') }}: {{ fmt(tm.overMinutes) }}</span>
                  } @else {
                    <span class="gz-sm gz-b" style="color: var(--gz-mint-ink)">{{ i18n.q('الوقت المتبقي تقديريًا', 'Estimated time left') }}: {{ tm.state === 'exact' ? i18n.q('لا يوجد', 'none') : fmt(tm.remainingMinutes) }}</span>
                  }
                  <button type="button" class="gz-lnk gz-sm" (click)="openEstimate()">{{ i18n.q('تعديل', 'Edit') }}</button>
                </div>
                <div class="gz-xs gz-mute mt-1">{{ i18n.q('مقارنة بتقديرك فقط — مش توقّع مضمون لوقت الانتهاء.', 'A comparison with your own estimate only — not a guaranteed prediction.') }}</div>
              }
            </div>

            @if (p.parts?.length) {
              <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ i18n.q('القطع', 'Pieces') }} <span class="gz-ltr gz-mute">({{ completion()?.doneCount }}/{{ completion()?.total }})</span></h2></div>
              <div class="flex flex-col gap-2">
                @for (r of partRows(); track r.id) {
                  <button type="button" class="gz-rcard text-start" (click)="openPart(r.id)" [attr.aria-label]="r.label">
                    <div class="flex items-center gap-2">
                      <div class="min-w-0 flex-1">
                        <div class="gz-b flex items-center gap-1.5">@if (r.done) { <svg gzIcon="check" size="s" /> }<span class="truncate">{{ r.label }}</span></div>
                        <div class="gz-xs gz-mute">{{ r.time }}</div>
                        <div class="gz-bar thin mt-1.5"><i [style.width.%]="r.pct"></i></div>
                      </div>
                      <span class="gz-b" style="color: var(--gz-primary)">{{ r.pct }}%</span>
                    </div>
                  </button>
                }
              </div>
            }

            <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ t().tracker }}</h2></div>
            <button type="button" class="gz-card soft gz-reset block w-full" (click)="openTracker()">
              <div class="flex items-center gap-3">
                <div class="gz-tile t-lav" style="width: 48px; height: 48px"><svg gzIcon="counter" /></div>
                <div class="min-w-0 flex-1"><div class="gz-b">{{ p.parts?.length ? i18n.q('عدّاد لكل قطعة', 'A counter per piece') : p.tracker.mode === 'pattern' ? t().patternCounter : t().simpleCounter }}</div><div class="gz-sm gz-mute gz-ltr" style="direction: inherit">{{ trkLine() }}</div></div>
                <svg gzIcon="chevr" size="s" [flip]="true" />
              </div>
            </button>

            @if (p.collectionId) {
              <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ t().attachedPattern }}</h2></div>
              @if (store.collection(p.collectionId); as col) {
                <button type="button" class="gz-card soft gz-reset block w-full" (click)="nav.navigateForward(['/tabs/home/collections', col.id])">
                  <div class="flex items-center gap-3">
                    <div class="gz-tile t-lav" style="width: 48px; height: 48px"><svg gzIcon="folder" /></div>
                    <div class="min-w-0 flex-1"><div class="gz-b">{{ col.name }}</div><div class="gz-sm gz-mute">{{ col.parts.length }} {{ i18n.q('أجزاء', 'parts') }} · {{ i18n.q('نسختك ', 'your version ') }}<span class="gz-ltr">{{ p.collectionRev ?? 1 }}</span></div></div>
                    <svg gzIcon="chevr" size="s" [flip]="true" />
                  </div>
                </button>
              } @else {
                <div class="gz-note lav"><span>{{ i18n.q('الباترون الأصلي اتمسح — مشروعك محتفظ بنسخته الخاصة.', 'The original pattern was deleted — your project keeps its own copy.') }}</span></div>
              }
            } @else {
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
            }

            <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ t().materials }}</h2></div>
            <div class="gz-grid-2">
              <div class="gz-card soft" style="padding: 12px 14px"><div class="gz-xs gz-mute">{{ t().hook }}</div><div class="gz-b gz-hd gz-ltr" style="font-size: 18px">{{ p.hook }} mm</div></div>
              <div class="gz-card soft" style="padding: 12px 14px"><div class="gz-xs gz-mute">{{ t().yarn }}</div><div class="gz-b gz-hd" style="font-size: 18px">{{ store.yarnName(p.yarn) }}</div></div>
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

    <!-- edit the optional estimate (never touches recorded time) -->
    <gz-sheet [open]="sheet() === 'estimate'" [title]="i18n.q('الوقت المتوقع لإنهاء المشروع', 'Estimated time to finish')" [description]="i18n.q('اختياري. تعديله مبيغيّرش وقت الشغل المسجّل.', 'Optional. Changing it never changes the recorded work time.')" (closed)="sheet.set(null)">
      <gz-duration-input [value]="draftMinutes()" (valueChange)="draftMinutes.set($event)" />
      <ng-container gzActions>
        <button type="button" class="gz-btn" (click)="saveEstimate()"><svg gzIcon="check" />{{ i18n.q('حفظ', 'Save') }}</button>
        @if (estimateMinutes() > 0) {
          <button type="button" class="gz-btn-text danger" (click)="clearEstimate()">{{ i18n.q('إزالة الوقت المتوقع', 'Remove the estimate') }}</button>
        }
        <button type="button" class="gz-btn-text" (click)="sheet.set(null)">{{ t().cancel }}</button>
      </ng-container>
    </gz-sheet>

    <!-- explicit update to the latest pattern version -->
    <gz-sheet [open]="sheet() === 'update'" [title]="i18n.q('تحديث المشروع للنسخة الجديدة', 'Update the project to the new version')" [description]="i18n.q('مفيش حاجة بتتغير إلا لما تأكدي. تقدّمك مش هيتصفّر.', 'Nothing changes until you confirm. Your progress is never reset.')" (closed)="sheet.set(null)">
      @for (line of updateLines(); track $index) {
        <div class="gz-note mt-2" [class.sage]="line.level === 'safe'" [class.peach]="line.level === 'warn'" [class.rose]="line.level === 'unsafe'"><span style="white-space: pre-line">{{ line.text }}</span></div>
      }
      @if (updateLevel() === 'unsafe') {
        <div class="gz-note rose mt-2" role="alert"><svg gzIcon="info" size="s" /><span>{{ i18n.q('تقدّمك الحالي مش هيتطابق تمامًا مع النص الجديد. لو حدّثتي، موضعك هيفضل زي ما هو وتراجعي الأدوار اللي اتغيّرت.', 'Your current position cannot be matched exactly to the new text. If you update, your position stays where it is and you check the rounds that changed.') }}</span></div>
      }
      <ng-container gzActions>
        <button type="button" class="gz-btn" [class.is-busy]="busy()" [disabled]="busy()" (click)="applyUpdate()">{{ updateLevel() === 'unsafe' ? i18n.q('حدّثي على أي حال', 'Update anyway') : i18n.q('حدّثي للنسخة الجديدة', 'Update to the new version') }}</button>
        <button type="button" class="gz-btn2" [disabled]="busy()" (click)="sheet.set(null)">{{ i18n.q('خليني على نسختي', 'Keep my version') }}</button>
      </ng-container>
    </gz-sheet>
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
  private readonly finishSvc = inject(ProjectFinishService);
  private readonly db = inject(LocalDb);
  readonly id = input.required<string>();

  protected readonly t = this.i18n.t;
  protected readonly statuses: ProjectStatus[] = ['active', 'paused', 'done'];
  protected readonly sheet = signal<'estimate' | 'update' | null>(null);
  protected readonly draftMinutes = signal(0);
  protected readonly busy = signal(false);

  protected readonly p = computed(() => this.store.project(this.id()));
  protected readonly card = computed(() => {
    const p = this.p();
    return p ? projectCard(this.store, this.i18n, p) : null;
  });
  protected readonly view = computed(() => this.store.trackerView(this.p()));
  protected readonly outdated = computed(() => !!this.view()?.outdated && this.p()?.status !== 'done');
  protected readonly pattern = computed(() => {
    const p = this.p();
    return p && p.tracker.mode === 'pattern' ? this.store.pattern(p.tracker.patternId) : null;
  });
  protected readonly patLine = computed(() => {
    const p = this.p();
    const src = this.view()?.source;
    return src ? `${parsePattern(src.text).rounds.length} ${this.i18n.q('أدوار', 'rounds')}` + (p?.patternPin ? ` · ${this.i18n.q('نسخة ', 'version ')}${p.patternPin.rev}` : '') : '';
  });
  protected readonly trkLine = computed(() => {
    const p = this.p();
    if (!p) return '';
    const v = this.view();
    if (p.parts?.length) {
      const c = this.completion();
      return `${v?.source?.name ?? ''} · ${c?.doneCount ?? 0}/${c?.total ?? 0}`;
    }
    if (v?.source && p.tracker.mode === 'pattern') {
      const parsed = parsePattern(v.source.text);
      const st = patternStats(parsed, p.tracker.cursor);
      if (st) return `${v.source.name} · R${st.roundNumber} · ${st.overallProduced}/${st.overallTotal}`;
    }
    const s = p.tracker.simple;
    return `${s.count}/${s.target} ${this.t().stitchesU} · ${this.card()?.roundLabel ?? ''}`;
  });

  /* ---- time ---- */
  protected readonly time = computed(() => {
    const p = this.p();
    return p ? compareTime(p.estimatedHours, this.timer.elapsedFor(p.id, p.workedSeconds)) : null;
  });
  protected readonly estimateMinutes = computed(() => estimatedHoursToMinutes(this.p()?.estimatedHours ?? 0));
  protected fmt(min: number): string {
    return formatMinutes(min, this.i18n.lang());
  }

  /* ---- parts ---- */
  protected readonly completion = computed(() => {
    const p = this.p();
    return p?.parts?.length ? projectCompletion(p.parts, p.partSnapshots ?? []) : null;
  });
  protected readonly partRows = computed(() => {
    const p = this.p();
    if (!p?.parts?.length) return [];
    return p.parts.map((i) => {
      const snap = (p.partSnapshots ?? []).find((s) => s.partId === i.partId);
      const pr = instanceProgress(i, snap);
      return {
        id: i.id,
        label: instanceLabel(i, snap, siblingsOf(p.parts ?? [], i)),
        pct: Math.round(pr.fraction * 100),
        done: pr.done,
        time: this.i18n.q('وقت القطعة: ', 'Piece time: ') + this.fmt(Math.floor(this.timer.elapsedForInstance(p.id, i.id, i.workedSeconds) / 60)),
      };
    });
  });

  /* ---- update to a newer pattern / collection version ---- */
  private readonly updatePlan = computed(() => {
    const p = this.p();
    const v = this.view();
    if (!p || !v?.outdated) return null;
    if (p.parts?.length) {
      const col = this.store.collection(p.collectionId);
      return col ? { kind: 'collection' as const, plan: planCollectionUpdate({ snapshots: p.partSnapshots ?? [], instances: p.parts }, col.parts, uuid, Date.now(), col.terms), rev: col.rev } : null;
    }
    const live = this.store.pattern(p.tracker.patternId);
    if (!p.patternPin || !live) return null;
    const map = mapCursor(p.patternPin.text, live.text, p.tracker.cursor);
    return { kind: 'pattern' as const, map, diff: diffPatterns(p.patternPin.text, live.text), live };
  });
  protected readonly updateLevel = computed(() => {
    const u = this.updatePlan();
    return u ? (u.kind === 'collection' ? u.plan.level : u.map.level) : 'safe';
  });
  protected readonly updateLines = computed(() => {
    const u = this.updatePlan();
    const q = (a: string, e: string) => this.i18n.q(a, e);
    if (!u) return [];
    if (u.kind === 'pattern') {
      const rounds = u.map.affectedRounds.map((r) => `R${(r + 1)}`).join(', ');
      const lines = [{ level: u.map.level, text: u.map.level === 'safe' ? q('موضعك آمن مع النسخة الجديدة.', 'Your position is safe with the new version.') : q(`أدوار اتغيّرت بتأثر عليكي: ${rounds || '—'}. موضعك محفوظ.`, `Rounds that changed and matter to you: ${rounds || '—'}. Your position is kept.`) }];
      lines.push({ level: 'safe', text: q(`${u.diff.changedCount} دور اتعدّل، ${u.diff.addedCount} اتضاف، ${u.diff.removedCount} اتشال. خطوات التراجع الصالحة اتحفظت: ${u.map.historyKept}.`, `${u.diff.changedCount} round(s) edited, ${u.diff.addedCount} added, ${u.diff.removedCount} removed. Valid undo steps kept: ${u.map.historyKept}.`) });
      return lines;
    }
    return u.plan.reports
      .filter((r) => r.kind !== 'unchanged')
      .map((r) => ({
        level: r.level,
        text:
          r.kind === 'added' ? q(`${r.name}: جزء جديد — هيتضاف بدون تقدّم.`, `${r.name}: new part — added with no progress.`)
          : r.kind === 'removed' ? q(`${r.name}: اتشال من الباترون — القطع اللي فيها تقدّم هتفضل عندك.`, `${r.name}: removed from the pattern — pieces with progress stay with you.`)
          : r.kind === 'quantity' ? q(`${r.name}: العدد اتغيّر.`, `${r.name}: quantity changed.`)
          : q(`${r.name}: اتعدّل — ${r.level === 'safe' ? 'تقدّمك آمن.' : 'تقدّمك محفوظ، راجعي الأدوار ' + r.affectedRounds.map((x) => 'R' + (x + 1)).join(', ')}`, `${r.name}: edited — ${r.level === 'safe' ? 'your progress is safe.' : 'progress kept, check rounds ' + r.affectedRounds.map((x) => 'R' + (x + 1)).join(', ')}`),
      }));
  });

  private notesTimer: ReturnType<typeof setTimeout> | null = null;

  protected async setStatus(s: ProjectStatus): Promise<void> {
    // "Done" is the explicit finish: the timer stops first, then JoyPresenter celebrates (or confirms quietly if it was already celebrated).
    if (s === 'done') await this.finishSvc.finish(this.id());
    else await this.store.setStatus(this.id(), s);
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

  protected async openPart(instanceId: string): Promise<void> {
    await this.store.setActiveInstance(this.id(), instanceId);
    await this.timer.switchInstance(this.id(), instanceId);
    await this.openTracker();
  }

  protected linkPattern(patternId: string): void {
    const pat = this.store.pattern(patternId);
    void this.store
      .updateTracker(this.id(), (t) =>
        t.patternId === patternId && t.mode === 'pattern'
          ? { ...t, patternId: null, mode: 'simple' }
          : { ...t, patternId, mode: 'pattern', cursor: { ...t.cursor, roundIndex: 0, ptr: 0, history: [] }, simple: { ...t.simple, totalRounds: pat ? parsePattern(pat.text).rounds.length : t.simple.totalRounds } },
      )
      .then(() => this.store.updateProject(this.id(), (x) => ({ ...x, patternPin: null })));
  }

  /* ---- estimate ---- */
  protected openEstimate(): void {
    this.draftMinutes.set(this.estimateMinutes());
    this.sheet.set('estimate');
  }
  protected async saveEstimate(): Promise<void> {
    const m = this.draftMinutes();
    // Only the estimate changes: recorded time (workedSeconds) is untouched.
    await this.store.updateProject(this.id(), (x) => ({ ...x, estimatedHours: m > 0 ? minutesToEstimatedHours(m) : 0 }), ['project']);
    this.sheet.set(null);
    await this.ui.say(m > 0 ? 'تم حفظ الوقت المتوقع' : 'اتشال الوقت المتوقع', m > 0 ? 'Estimate saved' : 'Estimate removed');
  }
  protected async clearEstimate(): Promise<void> {
    this.draftMinutes.set(0);
    await this.saveEstimate();
  }

  /* ---- update to newer version ---- */
  protected openUpdate(): void {
    if (this.updatePlan()) this.sheet.set('update');
  }
  protected async applyUpdate(): Promise<void> {
    const u = this.updatePlan();
    const p = this.p();
    if (!u || !p || this.busy()) return;
    this.busy.set(true);
    try {
      if (u.kind === 'collection') await this.store.applyCollectionUpdate(p.id, u.plan, u.rev);
      else {
        await this.store.unpinProject(p.id, u.map.cursor);
        await this.store.updateTracker(p.id, (t) => ({ ...t, simple: { ...t.simple, totalRounds: parsePattern(u.live.text).rounds.length } }));
      }
      this.sheet.set(null);
      await this.ui.say('اتحدّث المشروع — تقدّمك زي ما هو', 'Project updated — your progress is unchanged');
    } finally {
      this.busy.set(false);
    }
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
    if (this.timer.running()?.projectId === this.id() || this.timer.paused()?.projectId === this.id()) await this.timer.stop();
    await this.store.deleteProject(this.id());
    await this.nav.navigateRoot('/tabs/projects');
  }
}
