import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { IonContent, IonHeader, NavController } from '@ionic/angular';
import { LVL, LVL_IDS, LevelId } from '../../core/data/catalog';
import { HasUnsavedChanges } from '../../core/guards/unsaved-changes.guard';
import { MAX_PARTS, clampQuantity } from '../../core/domain/collections';
import { parsePattern } from '../../core/domain/pattern-parser';
import { convertPartText } from '../../core/domain/smart-parser';
import { TermSystem } from '../../core/domain/terminology';
import { I18nService } from '../../core/i18n/i18n.service';
import { PatternCollection, PatternPart } from '../../core/models/models';
import { AppStore } from '../../core/state/app.store';
import { uuid } from '../../core/state/factories';
import { readImageFile } from '../../core/utils/image';
import { SheetComponent } from '../../shared/ui/dialogs/sheet.component';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PhotoComponent } from '../../shared/ui/images/photo.component';
import { DurationInputComponent } from '../../shared/ui/inputs/duration-input.component';
import { StepperComponent } from '../../shared/ui/inputs/stepper.component';
import { ImportDraftService } from './import-draft.service';

interface Draft {
  name: string;
  description: string;
  level: LevelId;
  terms: TermSystem;
  cover: string | null;
  minutes: number;
  sourceText: string;
  parts: PatternPart[];
}

interface PartForm {
  id: string | null;
  name: string;
  quantity: number;
  text: string;
  assemblyNotes: string;
}

const MAX_NAME = 120;
const MAX_PART_NAME = 80;
const MAX_TEXT = 20000;

/** Create / edit a multi-part pattern collection (name, cover, difficulty, parts with quantities, instructions, assembly notes). */
@Component({
  selector: 'gz-collection-editor',
  imports: [IonHeader, IonContent, IconComponent, PhotoComponent, StepperComponent, SheetComponent, DurationInputComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top">
        <button type="button" class="gz-icb" (click)="cancel()" [attr.aria-label]="t().back"><svg gzIcon="arrowl" [flip]="true" /></button>
        <h1 class="gz-ttl gz-hd">{{ editing() ? i18n.q('تعديل الباترون', 'Edit pattern') : i18n.q('باترون كامل بأجزاء', 'Multi-part pattern') }}</h1>
        <span style="width: 46px"></span>
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      <div class="gz-pad">
        @if (editing() && !original()) {
          <div class="gz-note rose" role="alert"><span>{{ i18n.q('الباترون ده مش موجود.', 'This pattern no longer exists.') }}</span></div>
        } @else {
          <label class="gz-lbl" for="ce-name">{{ i18n.q('اسم الباترون', 'Pattern name') }}</label>
          <div class="gz-in" [class.invalid]="nameErr()"><svg gzIcon="folder" /><input id="ce-name" type="text" [maxLength]="MAX_NAME" [value]="d().name" (input)="set('name', $event)" [placeholder]="i18n.q('مثال: الأرنوبة بالفستان', 'e.g. Pink Teddy Bear')" [attr.aria-invalid]="nameErr()" aria-describedby="ce-name-err" /></div>
          @if (nameErr()) {
            <div id="ce-name-err" class="gz-field-err" role="alert">{{ i18n.q('اكتبي اسمًا للباترون.', 'Give the pattern a name.') }}</div>
          }

          <label class="gz-lbl" for="ce-desc">{{ i18n.q('وصف (اختياري)', 'Description (optional)') }}</label>
          <textarea id="ce-desc" class="gz-ta" style="min-height: 76px" dir="auto" maxlength="2000" [value]="d().description" (input)="set('description', $event)"></textarea>

          <span class="gz-lbl">{{ i18n.q('صورة الغلاف', 'Cover image') }}</span>
          <div class="flex items-center gap-3">
            <gz-photo class="flex-none" tone="lav" [src]="d().cover" [alt]="i18n.q('غلاف الباترون', 'Pattern cover')" [showLabel]="false" height="88px" width="88px" extraClass="r16" />
            <div class="flex flex-1 flex-col gap-2">
              <label class="gz-btn3 w" style="cursor: pointer"><input class="gz-sr" type="file" accept="image/*" (change)="onCover($event)" /><svg gzIcon="camera" size="s" />{{ t().chooseImage }}</label>
              @if (d().cover) {
                <button type="button" class="gz-btn-text" (click)="clearCover()">{{ i18n.q('إزالة الصورة', 'Remove image') }}</button>
              }
            </div>
          </div>
          @if (coverErr()) {
            <div class="gz-field-err" role="alert">{{ coverErr() }}</div>
          }

          <span class="gz-lbl">{{ t().patLevel }}</span>
          <div class="gz-chips">
            @for (l of levels; track l) {
              <button type="button" class="gz-chip sm" [class.on]="d().level === l" [attr.aria-pressed]="d().level === l" (click)="setLevel(l)">{{ LVL[l][i18n.lang()] }}</button>
            }
          </div>
          <span class="gz-lbl">{{ t().patTerms }}</span>
          <div class="gz-seg" role="radiogroup">
            <button type="button" role="radio" [attr.aria-checked]="d().terms === 'us'" [class.on]="d().terms === 'us'" (click)="setTerms('us')">{{ t().us }}</button>
            <button type="button" role="radio" [attr.aria-checked]="d().terms === 'uk'" [class.on]="d().terms === 'uk'" (click)="setTerms('uk')">{{ t().uk }}</button>
          </div>

          <span class="gz-lbl" id="ce-time-l">{{ i18n.q('الوقت المقترح للمشروع (اختياري)', 'Suggested project time (optional)') }}</span>
          <gz-duration-input labelId="ce-time-l" [value]="d().minutes" (valueChange)="setMinutes($event)" />
          <div class="gz-field-hint">{{ i18n.q('بيتقترح بس عند بدء مشروع — مش إجباري ومتتفرضش.', 'Only offered as a pre-fill when starting a project — never required or imposed.') }}</div>

          <div class="gz-sec">
            <h2 class="gz-h3 gz-hd">{{ i18n.q('الأجزاء', 'Parts') }} <span class="gz-ltr">({{ d().parts.length }}/{{ MAX_PARTS }})</span></h2>
          </div>
          @if (partsErr()) {
            <div class="gz-field-err" role="alert">{{ partsErr() }}</div>
          }
          <div class="flex flex-col gap-2.5">
            @for (p of d().parts; track p.id; let i = $index) {
              @let s = stat(p);
              <div class="gz-rcard" style="padding: 12px 14px">
                <div class="flex items-center gap-2">
                  <button type="button" class="gz-reset flex min-w-0 flex-1 flex-col text-start" style="min-height: 44px" (click)="editPart(p.id)" [attr.aria-label]="i18n.q('تعديل الجزء ', 'Edit part ') + p.name">
                    <span class="gz-b gz-hd truncate" style="font-size: 16px">{{ p.name || '—' }} <span class="gz-ltr gz-mute">× {{ p.quantity }}</span></span>
                    <span class="gz-xs gz-mute">{{ s }}</span>
                  </button>
                  <button type="button" class="gz-icb flat" style="width: 44px; height: 44px" [disabled]="i === 0" (click)="move(i, -1)" [attr.aria-label]="i18n.q('تحريك لأعلى', 'Move up')"><svg gzIcon="chevd" size="s" style="transform: rotate(180deg)" /></button>
                  <button type="button" class="gz-icb flat" style="width: 44px; height: 44px" [disabled]="i === d().parts.length - 1" (click)="move(i, 1)" [attr.aria-label]="i18n.q('تحريك لأسفل', 'Move down')"><svg gzIcon="chevd" size="s" /></button>
                </div>
              </div>
            } @empty {
              <div class="gz-note lav"><svg gzIcon="info" size="s" /><span>{{ i18n.q('لسه مفيش أجزاء. أضيفي جزء أو الصقي الباترون كله.', 'No parts yet. Add a part or paste the whole pattern.') }}</span></div>
            }
          </div>

          <div class="mt-3 flex flex-col gap-2">
            <button type="button" class="gz-btn2" [disabled]="d().parts.length >= MAX_PARTS" (click)="newPart()"><svg gzIcon="plus" size="s" />{{ i18n.q('إضافة جزء', 'Add a part') }}</button>
            <button type="button" class="gz-btn3 w" (click)="smartPaste()"><svg gzIcon="convert" size="s" />{{ i18n.q('لصق باترن كامل (تحويل ذكي)', 'Paste a whole pattern (smart convert)') }}</button>
            @if (importable().length) {
              <button type="button" class="gz-btn3 w" (click)="sheet.set('import')"><svg gzIcon="file" size="s" />{{ i18n.q('نسخ باترون موجود كجزء', 'Copy an existing pattern as a part') }}</button>
            }
          </div>

          @if (editing()) {
            <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ i18n.q('النسخ السابقة', 'Version history') }}</h2></div>
            <div class="gz-note lav"><svg gzIcon="info" size="s" /><span>{{ i18n.q('النسخة الحالية ' + original()!.rev + '. المشاريع الشغّالة بتفضل على نسختها لحد ما تحدّثيها بنفسك.', 'Current version ' + original()!.rev + '. Running projects stay on their own copy until you update them yourself.') }}</span></div>
            @if (usedBy() > 0) {
              <div class="gz-note peach mt-2"><svg gzIcon="info" size="s" /><span>{{ i18n.q(usedBy() + ' مشروع مبني على الباترون ده. تعديلك مش هيغيّر تقدّمهم.', usedBy() + ' project(s) use this pattern. Your edit will not change their progress.') }}</span></div>
            }
            @if (history().length) {
              <button type="button" class="gz-btn3 w mt-2" (click)="sheet.set('history')"><svg gzIcon="clock" size="s" />{{ i18n.q('عرض النسخ السابقة (' + history().length + ')', 'View earlier versions (' + history().length + ')') }}</button>
            }
          }

          <div style="height: 18px"></div>
          <button type="button" class="gz-btn" [class.is-busy]="busy()" [disabled]="busy()" (click)="save()"><svg gzIcon="check" />{{ editing() ? i18n.q('حفظ التغييرات', 'Save changes') : i18n.q('حفظ الباترون', 'Save pattern') }}</button>
          <button type="button" class="gz-btn-text mt-1" [disabled]="busy()" (click)="cancel()">{{ t().cancel }}</button>
          @if (editing()) {
            <button type="button" class="gz-btn-text danger" [disabled]="busy()" (click)="remove()"><svg gzIcon="trash" size="s" />{{ i18n.q('حذف الباترون', 'Delete pattern') }}</button>
          }
        }
      </div>
    </ion-content>

    <!-- part editor -->
    <gz-sheet [open]="sheet() === 'part'" [title]="partForm().id ? i18n.q('تعديل الجزء', 'Edit part') : i18n.q('إضافة جزء', 'Add a part')" [description]="i18n.q('التعليمات اللي العدّاد هيمشي عليها. كل قطعة من الجزء ليها عدّاد مستقل.', 'The instructions the counter follows. Every piece of this part has its own counter.')" (closed)="closePart()">
      <label class="gz-lbl" for="pe-name">{{ i18n.q('اسم الجزء', 'Part name') }}</label>
      <div class="gz-in" [class.invalid]="partNameErr()"><input id="pe-name" type="text" [maxLength]="MAX_PART_NAME" [value]="partForm().name" (input)="setPart('name', $event)" [placeholder]="i18n.q('مثال: الايد', 'e.g. Arms')" [attr.aria-invalid]="partNameErr()" /></div>
      @if (partNameErr()) {
        <div class="gz-field-err" role="alert">{{ i18n.q('اكتبي اسم الجزء.', 'Give the part a name.') }}</div>
      }
      <div class="mt-3 flex items-center justify-between gap-2">
        <span class="gz-b">{{ i18n.q('العدد المطلوب', 'Quantity') }}</span>
        <gz-stepper [display]="partForm().quantity" [label]="i18n.q('العدد', 'Quantity')" (dec)="setQuantity(partForm().quantity - 1)" (inc)="setQuantity(partForm().quantity + 1)" />
      </div>
      <label class="gz-lbl" for="pe-text">{{ i18n.q('التعليمات', 'Instructions') }}</label>
      <textarea id="pe-text" class="gz-ta gz-ltr" dir="ltr" style="min-height: 150px" [maxLength]="MAX_TEXT" [value]="partForm().text" (input)="setPart('text', $event)" placeholder="R1: 6sc in MR [6]&#10;R2: inc x 6 [12]"></textarea>
      @if (partMsg(); as m) {
        <div class="gz-note mt-2" [class.sage]="m.ok"><span style="white-space: pre-line">{{ m.text }}</span></div>
      }
      <button type="button" class="gz-btn3 w mt-2" [disabled]="!partForm().text.trim()" (click)="smartConvertPart()"><svg gzIcon="convert" size="s" />{{ i18n.q('تحويل ذكي للنص', 'Smart-convert this text') }}</button>
      <label class="gz-lbl" for="pe-notes">{{ i18n.q('ملاحظات التجميع والتشطيب', 'Assembly & finishing notes') }}</label>
      <textarea id="pe-notes" class="gz-ta" style="min-height: 76px" dir="auto" maxlength="4000" [value]="partForm().assemblyNotes" (input)="setPart('assemblyNotes', $event)"></textarea>
      <ng-container gzActions>
        <button type="button" class="gz-btn" (click)="savePart()"><svg gzIcon="check" />{{ i18n.q('حفظ الجزء', 'Save part') }}</button>
        <button type="button" class="gz-btn-text" (click)="sheet.set(null)">{{ t().cancel }}</button>
        @if (partForm().id) {
          <button type="button" class="gz-btn-text danger" (click)="removePart()"><svg gzIcon="trash" size="s" />{{ i18n.q('حذف الجزء', 'Delete part') }}</button>
        }
      </ng-container>
    </gz-sheet>

    <!-- copy an existing pattern in as a part (the source is never changed or removed) -->
    <gz-sheet [open]="sheet() === 'import'" [title]="i18n.q('نسخ باترون كجزء', 'Copy a pattern as a part')" [description]="i18n.q('بنعمل نسخة — الباترون الأصلي مبيتغيرش ومبيتمسحش.', 'A copy is made — the original pattern is never changed or deleted.')" (closed)="sheet.set(null)">
      <div class="flex flex-col gap-2">
        @for (p of importable(); track p.id) {
          <button type="button" class="gz-rcard text-start" style="min-height: 56px" (click)="copyPattern(p.id)">
            <span class="gz-b">{{ store.patternName(p) }}</span>
          </button>
        }
      </div>
    </gz-sheet>

    <!-- earlier versions -->
    <gz-sheet [open]="sheet() === 'history'" [title]="i18n.q('النسخ السابقة', 'Earlier versions')" [description]="i18n.q('الاسترجاع بيحط النسخة القديمة في المحرّر كتعديل غير محفوظ — مفيش حاجة بتتغير قبل ما تضغطي حفظ.', 'Restoring puts the old version in the editor as an unsaved change — nothing changes until you save.')" (closed)="sheet.set(null)">
      <div class="flex flex-col gap-2">
        @for (r of history(); track r.id) {
          <div class="gz-rcard">
            <div class="flex items-center gap-2">
              <div class="min-w-0 flex-1"><div class="gz-b">{{ i18n.q('النسخة ', 'Version ') }}<span class="gz-ltr">{{ r.rev }}</span></div><div class="gz-xs gz-mute">{{ r.parts?.length ?? 0 }} {{ i18n.q('أجزاء', 'parts') }}</div></div>
              <button type="button" class="gz-btn3" (click)="restore(r.id)">{{ i18n.q('استرجاع', 'Restore') }}</button>
            </div>
          </div>
        }
      </div>
    </gz-sheet>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollectionEditorPage implements HasUnsavedChanges {
  protected readonly i18n = inject(I18nService);
  protected readonly nav = inject(NavController);
  protected readonly store = inject(AppStore);
  private readonly ui = inject(UiFeedback);
  private readonly drafts = inject(ImportDraftService);

  readonly id = input<string>();
  protected readonly t = this.i18n.t;
  protected readonly levels = LVL_IDS;
  protected readonly LVL = LVL;
  protected readonly MAX_NAME = MAX_NAME;
  protected readonly MAX_PART_NAME = MAX_PART_NAME;
  protected readonly MAX_TEXT = MAX_TEXT;
  protected readonly MAX_PARTS = MAX_PARTS;

  protected readonly editing = computed(() => !!this.id());
  protected readonly original = computed<PatternCollection | null>(() => this.store.collection(this.id()));
  protected readonly d = signal<Draft>(this.blank());
  private baseline = JSON.stringify(this.blank());
  private loadedFor: string | null = null;

  protected readonly sheet = signal<'part' | 'import' | 'history' | null>(null);
  protected readonly partForm = signal<PartForm>({ id: null, name: '', quantity: 1, text: '', assemblyNotes: '' });
  protected readonly busy = signal(false);
  protected readonly coverErr = signal('');
  private readonly submitted = signal(false);
  private readonly partSubmitted = signal(false);
  private saved = false;

  protected readonly nameErr = computed(() => this.submitted() && !this.d().name.trim());
  protected readonly partsErr = computed(() => (this.submitted() && this.d().parts.length === 0 ? this.i18n.q('أضيفي جزء واحد على الأقل.', 'Add at least one part.') : ''));
  protected readonly partNameErr = computed(() => this.partSubmitted() && !this.partForm().name.trim());
  protected readonly usedBy = computed(() => this.store.projects().filter((p) => p.collectionId === this.id()).length);
  protected readonly history = computed(() => (this.id() ? this.store.revisionsOf('collection', this.id()!) : []));
  protected readonly importable = computed(() => this.store.patterns().filter((p) => p.text.trim() && !p.deletedAt));
  protected readonly partMsg = computed(() => {
    const txt = this.partForm().text.trim();
    if (!txt) return null;
    const p = parsePattern(txt);
    if (p.ok) return { ok: true, text: this.i18n.q(`✓ تم فهم ${p.rounds.length} أدوار — ${p.total} غرزة ناتجة`, `✓ ${p.rounds.length} rounds understood — ${p.total} output stitches`) };
    const bad = p.rounds.filter((r) => !r.ok).slice(0, 2).map((r) => r.raw).join('\n');
    return { ok: false, text: this.i18n.q(`${p.bad} سطر مش مدعوم — العدّ بالباترن مش هيشتغل لهذا الجزء (هيتعدّ كعدّاد بسيط):\n${bad}`, `${p.bad} unsupported line(s) — pattern counting will not work for this part (a simple counter is used):\n${bad}`) };
  });

  /** Ionic lifecycle: runs on first show and every time the user comes back (e.g. from Smart paste). */
  ionViewWillEnter(): void {
    this.hydrate();
    const draft = this.drafts.take('collection');
    if (!draft) return;
    this.d.update((d) => ({
      ...d,
      name: d.name.trim() ? d.name : (draft.collectionName ?? d.name),
      sourceText: d.sourceText ? `${d.sourceText}\n\n${draft.sourceText}` : draft.sourceText,
      parts: [...d.parts, ...draft.parts.map((p) => ({ id: uuid(), name: p.name, quantity: clampQuantity(p.quantity), text: p.text, assemblyNotes: p.assemblyNotes }))].slice(0, MAX_PARTS),
    }));
    void this.ui.say(`تمت إضافة ${draft.parts.length} جزء — راجعيهم واحفظي`, `${draft.parts.length} part(s) added — review them and save`);
  }

  private blank(): Draft {
    return { name: '', description: '', level: 'beginner', terms: 'us', cover: null, minutes: 0, sourceText: '', parts: [] };
  }

  private hydrate(): void {
    const key = this.id() ?? '';
    if (this.loadedFor === key) return;
    this.loadedFor = key;
    const c = this.original();
    const d: Draft = c
      ? { name: c.name, description: c.description, level: c.level, terms: c.terms, cover: c.coverLocalUrl, minutes: c.suggestedMinutes, sourceText: c.sourceText, parts: c.parts.map((p) => ({ ...p })) }
      : { ...this.blank(), level: this.store.profile().level, terms: 'us' };
    this.d.set(d);
    this.baseline = JSON.stringify(d);
  }

  hasUnsavedChanges(): boolean {
    return !this.saved && JSON.stringify(this.d()) !== this.baseline;
  }

  protected set(field: 'name' | 'description', ev: Event): void {
    const v = (ev.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.d.update((d) => ({ ...d, [field]: v }));
  }
  protected setLevel(level: LevelId): void {
    this.d.update((d) => ({ ...d, level }));
  }
  protected setTerms(terms: TermSystem): void {
    this.d.update((d) => ({ ...d, terms }));
  }
  protected setMinutes(minutes: number): void {
    this.d.update((d) => ({ ...d, minutes }));
  }

  protected async onCover(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.coverErr.set('');
    const r = await readImageFile(file, 480, 0.7); // small on purpose: the cover travels inside the synced row
    if ('error' in r) return void this.coverErr.set(this.t()[r.error]);
    if (r.dataUrl.length > 200_000) return void this.coverErr.set(this.i18n.q('الصورة كبيرة — جرّبي صورة أصغر.', 'That image is too large — try a smaller one.'));
    this.d.update((d) => ({ ...d, cover: r.dataUrl }));
  }
  protected clearCover(): void {
    this.d.update((d) => ({ ...d, cover: null }));
  }

  /* ---------------- parts ---------------- */
  protected stat(p: PatternPart): string {
    if (!p.text.trim()) return this.i18n.q('بدون تعليمات بعد', 'No instructions yet');
    const parsed = parsePattern(p.text);
    const base = `${parsed.rounds.length} ${this.i18n.q('أدوار', 'rounds')}`;
    return parsed.ok ? `${base} · ${parsed.total} ${this.i18n.q('غرزة', 'sts')}` : `${base} · ${parsed.bad} ${this.i18n.q('غير مدعوم', 'unsupported')}`;
  }

  protected move(i: number, dir: -1 | 1): void {
    this.d.update((d) => {
      const parts = [...d.parts];
      const j = i + dir;
      if (j < 0 || j >= parts.length) return d;
      [parts[i], parts[j]] = [parts[j], parts[i]];
      return { ...d, parts };
    });
  }

  protected newPart(): void {
    this.partSubmitted.set(false);
    this.partForm.set({ id: null, name: '', quantity: 1, text: '', assemblyNotes: '' });
    this.sheet.set('part');
  }
  protected editPart(id: string): void {
    const p = this.d().parts.find((x) => x.id === id);
    if (!p) return;
    this.partSubmitted.set(false);
    this.partForm.set({ id: p.id, name: p.name, quantity: p.quantity, text: p.text, assemblyNotes: p.assemblyNotes });
    this.sheet.set('part');
  }
  protected closePart(): void {
    if (this.sheet() === 'part') this.sheet.set(null);
  }
  protected setPart(field: 'name' | 'text' | 'assemblyNotes', ev: Event): void {
    const v = (ev.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.partForm.update((f) => ({ ...f, [field]: v }));
  }
  protected setQuantity(q: number): void {
    this.partForm.update((f) => ({ ...f, quantity: clampQuantity(q) }));
  }
  protected smartConvertPart(): void {
    const f = this.partForm();
    const conv = convertPartText(f.text, f.name);
    if (!conv.rounds.length) return void this.ui.say('مفيش أدوار اتعرفت', 'No rounds were recognised');
    this.partForm.update((x) => ({ ...x, text: conv.text, assemblyNotes: x.assemblyNotes || conv.notes.join('\n') }));
    const flagged = conv.rounds.filter((r) => r.status !== 'validated').length;
    void this.ui.say(flagged ? `اتحوّل — ${flagged} سطر محتاج مراجعة` : 'اتحوّل وتم التحقق من كل الأسطر', flagged ? `Converted — ${flagged} line(s) need review` : 'Converted and every line validated');
  }
  protected savePart(): void {
    this.partSubmitted.set(true);
    const f = this.partForm();
    if (!f.name.trim()) return;
    const part: PatternPart = { id: f.id ?? uuid(), name: f.name.trim().slice(0, MAX_PART_NAME), quantity: clampQuantity(f.quantity), text: f.text.trim(), assemblyNotes: f.assemblyNotes.trim() };
    this.d.update((d) => ({ ...d, parts: f.id ? d.parts.map((p) => (p.id === f.id ? part : p)) : [...d.parts, part] }));
    this.sheet.set(null);
  }
  protected async removePart(): Promise<void> {
    const f = this.partForm();
    if (!f.id) return;
    const ok = !f.text.trim() || (await this.ui.confirm(this.i18n.q('حذف الجزء؟', 'Delete this part?'), this.i18n.q('الجزء وتعليماته هيتشالوا من الباترون (لحد ما تحفظي).', 'The part and its instructions are removed from the pattern (until you save).'), this.i18n.q('حذف الجزء', 'Delete part')));
    if (!ok) return;
    this.d.update((d) => ({ ...d, parts: d.parts.filter((p) => p.id !== f.id) }));
    this.sheet.set(null);
  }

  protected smartPaste(): void {
    void this.nav.navigateForward('/tabs/home/patterns/import?target=collection');
  }

  protected copyPattern(patternId: string): void {
    const pat = this.store.pattern(patternId);
    if (!pat) return;
    if (this.d().parts.length >= MAX_PARTS) return void this.ui.say('وصلتي للحد الأقصى للأجزاء', 'Maximum number of parts reached');
    this.d.update((d) => ({ ...d, parts: [...d.parts, { id: uuid(), name: this.store.patternName(pat).slice(0, MAX_PART_NAME), quantity: 1, text: pat.text, assemblyNotes: '' }] }));
    this.sheet.set(null);
    void this.ui.say('اتنسخ كجزء — الأصل زي ما هو', 'Copied as a part — the original is untouched');
  }

  protected restore(revId: string): void {
    const r = this.history().find((x) => x.id === revId);
    if (!r?.parts) return;
    this.d.update((d) => ({ ...d, terms: r.terms, parts: r.parts!.map((p) => ({ ...p })) }));
    this.sheet.set(null);
    void this.ui.say('اتحطّت النسخة القديمة — اضغطي حفظ للتأكيد', 'Old version loaded — tap Save to confirm');
  }

  /* ---------------- save / cancel / delete ---------------- */
  protected async save(): Promise<void> {
    this.submitted.set(true);
    const d = this.d();
    if (!d.name.trim() || d.parts.length === 0 || this.busy()) return;
    this.busy.set(true);
    try {
      const base = { name: d.name.trim().slice(0, MAX_NAME), description: d.description.trim(), level: d.level, terms: d.terms, coverLocalUrl: d.cover, parts: d.parts, suggestedMinutes: d.minutes, sourceText: d.sourceText };
      let id = this.id();
      if (id && this.original()) {
        const res = await this.store.saveCollectionEdit(id, base);
        this.saved = true;
        if (res.contentChanged && this.usedBy() > 0) await this.ui.say('اتحفظ — المشاريع الشغّالة فضلت على نسختها', 'Saved — running projects stay on their own version');
        else await this.ui.say('تم حفظ التغييرات', 'Changes saved');
      } else {
        id = uuid();
        const now = Date.now();
        await this.store.addCollection({ id, ...base, rev: 1, createdAt: now, updatedAt: now, deletedAt: null });
        this.saved = true;
        await this.ui.say('تم حفظ الباترون', 'Pattern saved');
      }
      await this.nav.navigateForward(['/tabs/home/collections', id], { replaceUrl: true });
    } finally {
      this.busy.set(false);
    }
  }

  protected cancel(): void {
    void this.nav.back(); // the unsaved-changes guard decides whether to ask
  }

  protected async remove(): Promise<void> {
    const id = this.id();
    if (!id) return;
    const n = this.usedBy();
    const ok = await this.ui.confirm(
      this.i18n.q('حذف الباترون؟', 'Delete this pattern?'),
      n ? this.i18n.q(`${n} مشروع مبني عليه هيكملوا شغل بنسختهم الخاصة.`, `${n} project(s) built from it keep working on their own copy.`) : this.i18n.q('مش هينفع تتراجعي عن الحذف.', 'This cannot be undone.'),
      this.i18n.q('حذف الباترون', 'Delete pattern'),
    );
    if (!ok) return;
    this.saved = true;
    await this.store.deleteCollection(id);
    await this.nav.navigateRoot('/tabs/home/patterns');
  }
}
