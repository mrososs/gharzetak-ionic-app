import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { IonContent, IonHeader, NavController } from '@ionic/angular';
import { parsePattern } from '../../core/domain/pattern-parser';
import { formatMinutes } from '../../core/domain/time';
import { I18nService } from '../../core/i18n/i18n.service';
import { AppStore } from '../../core/state/app.store';
import { SheetComponent } from '../../shared/ui/dialogs/sheet.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PhotoComponent } from '../../shared/ui/images/photo.component';

/** Preview of a whole multi-part collection: parts, quantities, instructions, assembly notes — and "start a project from it". */
@Component({
  selector: 'gz-collection-detail',
  imports: [IonHeader, IonContent, IconComponent, PhotoComponent, SheetComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top">
        <button type="button" class="gz-icb" (click)="back()" [attr.aria-label]="t().back"><svg gzIcon="arrowl" [flip]="true" /></button>
        <h1 class="gz-ttl gz-hd truncate">{{ c()?.name ?? '' }}</h1>
        @if (c()) {
          <button type="button" class="gz-icb pur" (click)="edit()" [attr.aria-label]="i18n.q('تعديل', 'Edit')"><svg gzIcon="notes" /></button>
        } @else {
          <span style="width: 46px"></span>
        }
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      @if (c(); as c) {
        <div class="gz-pad">
          <gz-photo tone="lav" [src]="c.coverLocalUrl" [alt]="c.name" iconSize="xl" height="180px" extraClass="r28" />
          <div class="mt-3 flex flex-wrap gap-1.5">
            <span class="gz-badge">{{ store.levelName(c.level) }}</span>
            <span class="gz-badge sage gz-ltr">{{ c.terms.toUpperCase() }}</span>
            <span class="gz-badge peach">{{ c.parts.length }} {{ i18n.q('أجزاء', 'parts') }} · {{ pieces() }} {{ i18n.q('قطعة', 'pieces') }}</span>
            @if (c.suggestedMinutes > 0) {
              <span class="gz-badge">{{ i18n.q('وقت مقترح: ', 'Suggested: ') }}{{ time(c.suggestedMinutes) }}</span>
            }
          </div>
          @if (c.description) {
            <p class="gz-mute mt-2" dir="auto" style="overflow-wrap: anywhere">{{ c.description }}</p>
          }

          <button type="button" class="gz-btn mt-4" (click)="startProject()"><svg gzIcon="play" />{{ i18n.q('ابدئي مشروع من الباترون ده', 'Start a project from this pattern') }}</button>
          <button type="button" class="gz-btn2 mt-2" (click)="edit()"><svg gzIcon="notes" size="s" />{{ i18n.q('تعديل الباترون', 'Edit pattern') }}</button>

          <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ i18n.q('الأجزاء', 'Parts') }}</h2></div>
          <div class="flex flex-col gap-2.5">
            @for (p of c.parts; track p.id) {
              @let ps = parsed(p.text);
              <section class="gz-rcard" [attr.aria-label]="p.name">
                <div class="flex items-center gap-2">
                  <div class="min-w-0 flex-1">
                    <div class="gz-b gz-hd" style="font-size: 17px">{{ p.name }} <span class="gz-mute gz-sm">· {{ i18n.q('عدد ' + p.quantity, '×' + p.quantity) }}</span></div>
                    <div class="gz-xs gz-mute">{{ ps.rounds.length }} {{ i18n.q('أدوار', 'rounds') }}@if (ps.ok) { · <span class="gz-ltr">{{ ps.total }}</span> {{ i18n.q('غرزة', 'sts') }} } @else if (ps.rounds.length) { · {{ ps.bad }} {{ i18n.q('غير مدعوم', 'unsupported') }} }</div>
                  </div>
                  <button type="button" class="gz-lnk" (click)="toggle(p.id)" [attr.aria-expanded]="open().has(p.id)">{{ open().has(p.id) ? i18n.q('إخفاء', 'Hide') : i18n.q('عرض', 'View') }}</button>
                </div>
                @if (open().has(p.id)) {
                  @if (p.text) {
                    <pre class="gz-code gz-ltr mt-2" dir="ltr" style="white-space: pre-wrap; overflow-wrap: anywhere">{{ p.text }}</pre>
                  }
                  @if (p.assemblyNotes) {
                    <div class="gz-note lav mt-2"><svg gzIcon="info" size="s" /><span dir="auto" style="white-space: pre-line; overflow-wrap: anywhere">{{ p.assemblyNotes }}</span></div>
                  }
                }
              </section>
            }
          </div>

          @if (projects().length) {
            <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ i18n.q('مشاريع مبنية عليه', 'Projects from this pattern') }}</h2></div>
            <div class="flex flex-col gap-2">
              @for (p of projects(); track p.id) {
                <button type="button" class="gz-rcard text-start" style="min-height: 56px" (click)="openProject(p.id)">
                  <div class="flex items-center gap-2"><span class="gz-b flex-1 truncate">{{ p.name }}</span><span class="gz-b" style="color: var(--gz-primary)">{{ store.progress(p).pct }}%</span></div>
                </button>
              }
            </div>
          }

          @if (c.sourceText) {
            <button type="button" class="gz-btn-text mt-3" (click)="sheet.set('source')"><svg gzIcon="file" size="s" />{{ i18n.q('عرض النص الأصلي الملصوق', 'View the original pasted text') }}</button>
          }
        </div>
      } @else {
        <div class="gz-pad pt-16 text-center">
          <p class="gz-mute">{{ i18n.q('الباترون ده مش موجود.', 'This pattern no longer exists.') }}</p>
          <button type="button" class="gz-btn3 w" (click)="nav.navigateRoot('/tabs/home/patterns')">{{ t().patternReader }}</button>
        </div>
      }
    </ion-content>

    <gz-sheet [open]="sheet() === 'source'" [title]="i18n.q('النص الأصلي', 'Original text')" [description]="i18n.q('زي ما اتلصق بالظبط قبل التحويل.', 'Exactly as pasted, before conversion.')" (closed)="sheet.set(null)">
      <pre class="gz-code" dir="auto" style="white-space: pre-wrap; overflow-wrap: anywhere; max-height: 50vh; overflow: auto">{{ c()?.sourceText }}</pre>
    </gz-sheet>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectionDetailPage {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(AppStore);
  protected readonly nav = inject(NavController);
  readonly id = input.required<string>();
  protected readonly t = this.i18n.t;

  protected readonly c = computed(() => this.store.collection(this.id()));
  protected readonly pieces = computed(() => (this.c()?.parts ?? []).reduce((a, p) => a + p.quantity, 0));
  protected readonly projects = computed(() => this.store.sortedProjects().filter((p) => p.collectionId === this.id()));
  protected readonly open = signal<ReadonlySet<string>>(new Set());
  protected readonly sheet = signal<'source' | null>(null);

  protected parsed(text: string) {
    return parsePattern(text);
  }
  protected time(min: number): string {
    return formatMinutes(min, this.i18n.lang());
  }
  protected toggle(id: string): void {
    this.open.update((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  }
  protected back(): void {
    void this.nav.back();
  }
  protected edit(): void {
    void this.nav.navigateForward(['/tabs/home/collections', this.id(), 'edit']);
  }
  protected startProject(): void {
    void this.nav.navigateForward(['/tabs/projects/new'], { queryParams: { collection: this.id() } });
  }
  protected openProject(id: string): void {
    void this.nav.navigateForward(['/tabs/projects', id]);
  }
}
