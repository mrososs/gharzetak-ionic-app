import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { IonContent, IonHeader, NavController } from '@ionic/angular';
import { LVL_IDS, LevelId } from '../../core/data/catalog';
import { IconName } from '../../core/data/icons';
import { parsePattern } from '../../core/domain/pattern-parser';
import { I18nService } from '../../core/i18n/i18n.service';
import { AppStore } from '../../core/state/app.store';
import { SheetComponent } from '../../shared/ui/dialogs/sheet.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PhotoComponent } from '../../shared/ui/images/photo.component';

type Kind = 'all' | 'collections' | 'patterns';

interface Row {
  readonly id: string;
  readonly kind: 'collection' | 'pattern';
  readonly name: string;
  readonly tone: string;
  readonly icon: IconName;
  readonly cover: string | null;
  readonly badges: readonly { text: string; cls: string }[];
  readonly meta: string;
  readonly attribution: string;
  readonly linked: string;
  readonly level: LevelId;
  readonly haystack: string;
}

/** GZ-S16 — pattern library: complete multi-part patterns (collections) and standalone patterns, with search and filters. */
@Component({
  selector: 'gz-pattern-library',
  imports: [IonHeader, IonContent, IconComponent, PhotoComponent, SheetComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top">
        <button type="button" class="gz-icb" (click)="nav.back()" [attr.aria-label]="t().back"><svg gzIcon="arrowl" [flip]="true" /></button>
        <h1 class="gz-ttl gz-hd">{{ t().patternReader }}</h1>
        <button type="button" class="gz-icb pur" (click)="sheet.set('add')" [attr.aria-label]="t().addPattern"><svg gzIcon="plus" /></button>
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      <div class="gz-pad">
        <div class="gz-note lav" style="margin: 4px 0 12px"><svg gzIcon="info" size="s" /><span>{{ t().readerSupports }}</span></div>

        <div class="gz-in"><svg gzIcon="search" /><input type="search" [value]="query()" (input)="onQuery($event)" maxlength="80" [placeholder]="i18n.q('ابحثي بالاسم أو اسم الجزء', 'Search by name or part')" [attr.aria-label]="i18n.q('بحث في الباترونات', 'Search patterns')" /></div>

        <div class="gz-hs mt-2.5" role="tablist" [attr.aria-label]="i18n.q('النوع', 'Type')" style="padding-block: 0">
          @for (k of kinds(); track k.id) {
            <button type="button" role="tab" class="gz-chip sm" [class.on]="kind() === k.id" [attr.aria-selected]="kind() === k.id" (click)="kind.set(k.id)">{{ k.label }}</button>
          }
        </div>
        <div class="gz-hs mt-1.5" [attr.aria-label]="i18n.q('الصعوبة', 'Difficulty')" style="padding-block: 0">
          <button type="button" class="gz-chip sm" [class.on]="level() === 'all'" [attr.aria-pressed]="level() === 'all'" (click)="level.set('all')">{{ i18n.q('كل المستويات', 'All levels') }}</button>
          @for (l of levelIds; track l) {
            <button type="button" class="gz-chip sm" [class.on]="level() === l" [attr.aria-pressed]="level() === l" (click)="level.set(l)">{{ store.levelName(l) }}</button>
          }
        </div>

        <div class="mt-3 flex flex-col gap-3">
          @for (p of items(); track p.kind + p.id) {
            <button type="button" class="gz-rcard" (click)="open(p)" [attr.aria-label]="p.name">
              <div class="flex items-start gap-3">
                @if (p.cover) {
                  <gz-photo class="flex-none" tone="lav" [src]="p.cover" [alt]="p.name" [showLabel]="false" [icon]="null" height="52px" width="52px" extraClass="r16" />
                } @else {
                  <div class="gz-tile t-{{ p.tone }}" style="width: 52px; height: 52px"><svg [gzIcon]="p.icon" /></div>
                }
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <div class="gz-b gz-hd" style="font-size: 16px; overflow-wrap: anywhere">{{ p.name }}</div>
                  <div class="flex flex-wrap gap-1.5">
                    @for (b of p.badges; track b.text) {
                      <span class="gz-badge {{ b.cls }}">{{ b.text }}</span>
                    }
                  </div>
                  <div class="gz-xs gz-mute">{{ p.meta }}</div>
                  @if (p.attribution) {
                    <div class="gz-xs gz-mute">© {{ p.attribution }}</div>
                  }
                  @if (p.linked) {
                    <div class="gz-xs gz-b" style="color: var(--gz-primary)">{{ p.linked }}</div>
                  }
                </div>
              </div>
            </button>
          } @empty {
            <div class="gz-card text-center" style="padding: 26px 18px">
              <div class="gz-tile t-lav mx-auto mb-2.5" style="width: 56px; height: 56px; border-radius: 20px"><svg gzIcon="search" /></div>
              <h2 class="gz-h3 gz-hd">{{ hasFilter() ? i18n.q('مفيش نتائج', 'No matches') : i18n.q('لسه مفيش باترونات', 'No patterns yet') }}</h2>
              <p class="gz-mute gz-sm" style="margin: 4px 0 12px">{{ hasFilter() ? i18n.q('غيّري البحث أو الفلتر.', 'Change the search or the filters.') : i18n.q('أضيفي أول باترون ليكي.', 'Add your first pattern.') }}</p>
              @if (hasFilter()) {
                <button type="button" class="gz-btn3 w" (click)="clearFilters()">{{ i18n.q('مسح البحث والفلاتر', 'Clear search and filters') }}</button>
              }
            </div>
          }
        </div>
        <button type="button" class="gz-btn mt-4" (click)="sheet.set('add')"><svg gzIcon="plus" />{{ t().addPattern }}</button>
      </div>
    </ion-content>

    <gz-sheet [open]="sheet() === 'add'" [title]="t().addPattern" [description]="i18n.q('اختاري نوع الباترون.', 'Choose what kind of pattern to add.')" (closed)="sheet.set(null)">
      <div class="flex flex-col gap-2.5">
        <button type="button" class="gz-rcard text-start" style="min-height: 72px" (click)="add('collection')">
          <div class="flex items-center gap-3"><div class="gz-tile t-lav" style="width: 48px; height: 48px"><svg gzIcon="folder" /></div><div class="min-w-0 flex-1"><div class="gz-b">{{ i18n.q('باترون كامل بأجزاء', 'Multi-part pattern') }}</div><div class="gz-xs gz-mute">{{ i18n.q('زي دبدوب: راس + جسم + ايد × 2 + رجل × 2', 'e.g. a toy: head + body + arms × 2 + legs × 2') }}</div></div></div>
        </button>
        <button type="button" class="gz-rcard text-start" style="min-height: 72px" (click)="add('pattern')">
          <div class="flex items-center gap-3"><div class="gz-tile t-blush" style="width: 48px; height: 48px"><svg gzIcon="file" /></div><div class="min-w-0 flex-1"><div class="gz-b">{{ i18n.q('باترون منفرد', 'Standalone pattern') }}</div><div class="gz-xs gz-mute">{{ i18n.q('قطعة واحدة: نص أو PDF أو صورة', 'A single piece: text, PDF or image') }}</div></div></div>
        </button>
      </div>
    </gz-sheet>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PatternLibraryPage {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(AppStore);
  protected readonly nav = inject(NavController);
  protected readonly t = this.i18n.t;
  protected readonly levelIds = LVL_IDS;

  protected readonly query = signal('');
  protected readonly kind = signal<Kind>('all');
  protected readonly level = signal<LevelId | 'all'>('all');
  protected readonly sheet = signal<'add' | null>(null);

  protected readonly kinds = computed<{ id: Kind; label: string }[]>(() => [
    { id: 'all', label: this.i18n.q('الكل', 'All') },
    { id: 'collections', label: this.i18n.q('باترونات بأجزاء', 'Multi-part') },
    { id: 'patterns', label: this.i18n.q('باترونات منفردة', 'Standalone') },
  ]);

  private readonly rows = computed<Row[]>(() => {
    const q = (a: string, e: string) => this.i18n.q(a, e);
    const srcN: Record<string, string> = { sample: q('نموذج', 'Sample'), text: q('نص', 'Text'), pdf: 'PDF', image: q('صورة', 'Image'), youtube: 'YouTube' };
    const srcC: Record<string, string> = { sample: 'sage', text: '', pdf: 'rose', image: 'peach', youtube: 'rose' };
    const srcI: Record<string, IconName> = { sample: 'file', text: 'notes', pdf: 'file', image: 'image', youtube: 'film' };
    const projects = this.store.projects();
    const cols: Row[] = this.store.collections().map((c) => {
      const pieces = c.parts.reduce((a, p) => a + p.quantity, 0);
      const linked = projects.filter((x) => x.collectionId === c.id).map((x) => x.name);
      return {
        id: c.id,
        kind: 'collection',
        name: c.name,
        tone: 'lav',
        icon: 'folder',
        cover: c.coverLocalUrl,
        badges: [
          { text: q('باترون بأجزاء', 'Multi-part'), cls: 'peach' },
          { text: this.store.levelName(c.level), cls: '' },
          { text: `${c.parts.length} ${q('أجزاء', 'parts')}`, cls: 'sage' },
        ],
        meta: `${pieces} ${q('قطعة', 'pieces')}`,
        attribution: '',
        linked: linked.length ? q('مبني عليه: ', 'Used by: ') + linked.join(this.i18n.isAr() ? '، ' : ', ') : '',
        level: c.level,
        haystack: [c.name, c.description, ...c.parts.map((p) => p.name)].join(' ').toLowerCase(),
      };
    });
    const pats: Row[] = this.store.patterns().map((pat) => {
      const pp = parsePattern(pat.text);
      const linked = projects.filter((x) => x.tracker.patternId === pat.id).map((x) => x.name);
      const name = this.store.patternName(pat);
      return {
        id: pat.id,
        kind: 'pattern',
        name,
        tone: pat.isSample ? 'blush' : 'lav',
        icon: srcI[pat.source] ?? 'file',
        cover: null,
        badges: [
          { text: srcN[pat.source] ?? srcN['text'], cls: srcC[pat.source] ?? '' },
          { text: this.store.levelName(pat.level), cls: '' },
          { text: pat.terms.toUpperCase(), cls: 'sage gz-ltr' },
        ],
        meta: pat.text
          ? `${pp.rounds.length} ${q('أدوار', 'rounds')}` + (pp.ok ? ` · ${pp.total} ${q('غرزة ناتجة', 'output stitches')}` : ` · ${pp.bad} ${q('غير مدعوم', 'unsupported')}`)
          : (pat.file?.name ?? ''),
        attribution: pat.isSample ? '' : pat.attribution,
        linked: linked.length ? q('مرتبط بـ: ', 'Linked to: ') + linked.join(this.i18n.isAr() ? '، ' : ', ') : '',
        level: pat.level,
        haystack: [name, pat.attribution].join(' ').toLowerCase(),
      };
    });
    return [...cols, ...pats];
  });

  protected readonly items = computed(() => {
    const q = this.query().trim().toLowerCase();
    const kind = this.kind();
    const level = this.level();
    return this.rows().filter((r) => (kind === 'all' || (kind === 'collections') === (r.kind === 'collection')) && (level === 'all' || r.level === level) && (!q || r.haystack.includes(q)));
  });
  protected readonly hasFilter = computed(() => !!this.query().trim() || this.kind() !== 'all' || this.level() !== 'all');

  protected onQuery(ev: Event): void {
    this.query.set((ev.target as HTMLInputElement).value);
  }
  protected clearFilters(): void {
    this.query.set('');
    this.kind.set('all');
    this.level.set('all');
  }
  protected open(r: Row): void {
    void this.nav.navigateForward([r.kind === 'collection' ? '/tabs/home/collections' : '/tabs/home/patterns', r.id]);
  }
  protected add(kind: 'collection' | 'pattern'): void {
    this.sheet.set(null);
    void this.nav.navigateForward(kind === 'collection' ? '/tabs/home/collections/new' : '/tabs/home/patterns/new');
  }
}
