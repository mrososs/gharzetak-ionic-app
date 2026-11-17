import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonContent, IonHeader, IonInput, NavController } from '@ionic/angular';
import { LVL, LVL_IDS, LevelId, P2_TEXT } from '../../core/data/catalog';
import { HasUnsavedChanges } from '../../core/guards/unsaved-changes.guard';
import { parsePattern } from '../../core/domain/pattern-parser';
import { diffPatterns, mapCursor } from '../../core/domain/revisions';
import { I18nService } from '../../core/i18n/i18n.service';
import { Pattern, PatternFile } from '../../core/models/models';
import { AppStore } from '../../core/state/app.store';
import { uuid } from '../../core/state/factories';
import { SyncService } from '../../core/sync/sync.service';
import { SheetComponent } from '../../shared/ui/dialogs/sheet.component';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ImportDraftService } from './import-draft.service';

type Src = 'text' | 'pdf' | 'image';
const MAX_FILE = 10 * 1024 * 1024;

/**
 * GZ-S18 — add a pattern (pasted text, or a PDF / image kept as a reference — no fake OCR) AND edit an existing one
 * (/tabs/home/patterns/:id/edit). Editing never moves a running project: the previous text is kept as a revision and
 * every project that follows the pattern is pinned to it until the user updates it explicitly.
 */
@Component({
  selector: 'gz-add-pattern',
  imports: [IonHeader, IonContent, IonInput, ReactiveFormsModule, IconComponent, SheetComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top">
        <button type="button" class="gz-icb" (click)="cancel()" [attr.aria-label]="t().back"><svg gzIcon="arrowl" [flip]="true" /></button>
        <h1 class="gz-ttl gz-hd">{{ editing() ? i18n.q('تعديل الباترون', 'Edit pattern') : t().addPattern }}</h1>
        <span style="width: 46px"></span>
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      @if (editing() && store.loaded() && !original()) {
        <div class="gz-pad"><div class="gz-note rose" role="alert"><span>{{ i18n.q('الباترون ده مش موجود.', 'This pattern no longer exists.') }}</span></div></div>
      } @else if (original()?.isSample) {
        <div class="gz-pad"><div class="gz-note lav"><svg gzIcon="info" size="s" /><span>{{ i18n.q('الباترونات النموذجية مش قابلة للتعديل — انسخي النص في باترون جديد.', 'Sample patterns cannot be edited — copy the text into a new pattern.') }}</span></div></div>
      } @else {
        <form class="gz-pad" [formGroup]="form" (ngSubmit)="save()" novalidate>
          <label class="gz-lbl" for="ap-name">{{ t().patName }}</label>
          <div class="gz-in" [class.invalid]="nameErr()">
            <svg gzIcon="file" />
            <ion-input id="ap-name" formControlName="name" maxlength="120" [placeholder]="t().patNamePh" [attr.aria-label]="t().patName" />
          </div>
          @if (nameErr()) {
            <div class="gz-field-err" role="alert">{{ t().projNameErr }}</div>
          }

          <span class="gz-lbl">{{ t().patLevel }}</span>
          <div class="gz-chips">
            @for (l of levels; track l) {
              <button type="button" class="gz-chip sm" [class.on]="v().level === l" [attr.aria-pressed]="v().level === l" (click)="form.controls.level.setValue(l); form.markAsDirty()">{{ LVL[l][i18n.lang()] }}</button>
            }
          </div>
          <span class="gz-lbl">{{ t().patTerms }}</span>
          <div class="gz-seg" role="radiogroup">
            <button type="button" role="radio" [attr.aria-checked]="v().terms === 'us'" [class.on]="v().terms === 'us'" (click)="form.controls.terms.setValue('us'); form.markAsDirty()">{{ t().us }}</button>
            <button type="button" role="radio" [attr.aria-checked]="v().terms === 'uk'" [class.on]="v().terms === 'uk'" (click)="form.controls.terms.setValue('uk'); form.markAsDirty()">{{ t().uk }}</button>
          </div>

          <label class="gz-lbl" for="ap-attr">{{ t().patAttribution }}</label>
          <div class="gz-in"><svg gzIcon="user" /><ion-input id="ap-attr" formControlName="attribution" maxlength="200" [placeholder]="t().patAttributionPh" [attr.aria-label]="t().patAttribution" /></div>

          @if (!editing()) {
            <span class="gz-lbl">{{ t().patSource }}</span>
            <div class="gz-seg" role="tablist">
              @for (s of sources(); track s.id) {
                <button type="button" role="tab" [attr.aria-selected]="src() === s.id" [class.on]="src() === s.id" (click)="setSrc(s.id)" style="font-size: 13px">{{ s.label }}</button>
              }
            </div>
          }

          @if (src() === 'text' || editing()) {
            <label class="gz-lbl" for="ap-text">{{ t().pastePattern }}</label>
            <textarea id="ap-text" class="gz-ta gz-ltr" [class.invalid]="textErr()" dir="ltr" style="min-height: 170px" formControlName="text" [placeholder]="placeholder" maxlength="20000" [attr.aria-invalid]="textErr()"></textarea>
            @if (textErr()) {
              <div class="gz-field-err" role="alert">{{ i18n.q('الباترن أطول من 20000 حرف.', 'The pattern is longer than 20,000 characters.') }}</div>
            }
            @if (msg(); as m) {
              <div class="gz-note mt-2" [class.sage]="parsed()?.ok"><span style="white-space: pre-line">{{ m }}</span></div>
            }
            <div class="mt-2 flex flex-col gap-2">
              <button type="button" class="gz-btn3 w" (click)="smartPaste()"><svg gzIcon="convert" size="s" />{{ i18n.q('لصق ذكي: حوّلي نص عربي أو إنجليزي', 'Smart paste: convert Arabic or English text') }}</button>
              @if (!editing()) {
                <button type="button" class="gz-btn-text" (click)="example()">{{ t().fillExample }}</button>
              }
            </div>
          } @else {
            <label class="gz-rcard dashed mt-3 flex flex-col items-center gap-1.5 text-center" style="padding: 24px 14px; cursor: pointer">
              <input class="gz-sr" type="file" [accept]="src() === 'pdf' ? 'application/pdf' : 'image/jpeg,image/png,image/webp'" (change)="onFile($event)" />
              <div class="gz-tile t-lav" style="width: 56px; height: 56px; border-radius: 20px"><svg [gzIcon]="src() === 'pdf' ? 'file' : 'image'" size="l" /></div>
              <span class="gz-b" style="color: var(--gz-primary)">{{ src() === 'pdf' ? i18n.q('اختاري ملف PDF', 'Choose a PDF file') : i18n.q('اختاري صورة الباترن', 'Choose a pattern image') }}</span>
              <span class="gz-xs gz-mute">{{ file()?.name ?? i18n.q('لم يتم اختيار ملف', 'No file chosen') }}</span>
            </label>
            @if (fileErr()) {
              <div class="gz-field-err" role="alert">{{ fileErr() }}</div>
            }
            <div class="gz-note mt-2.5"><svg gzIcon="info" size="s" /><span>{{ t().notConnected }}</span></div>
          }

          @if (editing() && original(); as o) {
            <!-- what changes, and what it means for running projects -->
            @if (diff(); as df) {
              @if (!df.identical) {
                <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ i18n.q('ما الذي تغيّر', 'What changed') }}</h2></div>
                <div class="gz-chips" role="status">
                  <span class="gz-badge peach">{{ i18n.q('أدوار معدّلة: ', 'Edited rounds: ') }}<span class="gz-ltr">{{ df.changedCount }}</span></span>
                  @if (df.addedCount) {
                    <span class="gz-badge sage">{{ i18n.q('مضافة: ', 'Added: ') }}<span class="gz-ltr">{{ df.addedCount }}</span></span>
                  }
                  @if (df.removedCount) {
                    <span class="gz-badge rose">{{ i18n.q('محذوفة: ', 'Removed: ') }}<span class="gz-ltr">{{ df.removedCount }}</span></span>
                  }
                </div>
                <div class="mt-2 flex flex-col gap-1.5">
                  @for (c of changed(); track c.index) {
                    <div class="gz-card soft" style="padding: 8px 10px">
                      <div class="gz-xs gz-mute">{{ i18n.q('قبل', 'Before') }}</div>
                      <div class="gz-code gz-ltr" dir="ltr" style="font-size: 14px; overflow-wrap: anywhere; text-decoration: line-through; opacity: 0.7">{{ c.oldRaw ?? '—' }}</div>
                      <div class="gz-xs gz-mute mt-1">{{ i18n.q('بعد', 'After') }}</div>
                      <div class="gz-code gz-ltr" dir="ltr" style="font-size: 14px; overflow-wrap: anywhere">{{ c.newRaw ?? '—' }}</div>
                    </div>
                  }
                  @if (df.changedCount + df.addedCount + df.removedCount > changed().length) {
                    <div class="gz-xs gz-mute">{{ i18n.q('… وتغييرات أخرى', '… and more changes') }}</div>
                  }
                </div>
              }
            }
            @if (affected().length && textChanged()) {
              <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ i18n.q('مشاريع شغّالة على الباترون ده', 'Projects using this pattern') }}</h2></div>
              <div class="gz-note peach"><svg gzIcon="info" size="s" /><span>{{ i18n.q('هتفضل على النسخة الحالية — تقدّمها مش هيتغيّر. تحدّثيها بنفسك من صفحة المشروع.', 'They stay on the current version — their progress does not change. You update them yourself from the project page.') }}</span></div>
              <div class="mt-2 flex flex-col gap-1.5">
                @for (a of affected(); track a.id) {
                  <div class="gz-card soft" style="padding: 8px 12px">
                    <div class="gz-b">{{ a.name }}</div>
                    <div class="gz-xs" [style.color]="a.level === 'safe' ? 'var(--gz-mint-ink)' : a.level === 'warn' ? 'var(--gz-warning)' : 'var(--gz-error)'">{{ a.text }}</div>
                  </div>
                }
              </div>
            }
            <div class="gz-note lav mt-3"><svg gzIcon="info" size="s" /><span>{{ i18n.q('النسخة الحالية ' + (o.rev ?? 1) + '. النسخ السابقة بتتحفظ تلقائيًا.', 'Current version ' + (o.rev ?? 1) + '. Earlier versions are kept automatically.') }}</span></div>
            @if (history().length) {
              <button type="button" class="gz-btn3 w mt-2" (click)="sheet.set('history')"><svg gzIcon="clock" size="s" />{{ i18n.q('عرض النسخ السابقة (' + history().length + ')', 'View earlier versions (' + history().length + ')') }}</button>
            }
          }

          <div style="height: 16px"></div>
          <button type="submit" class="gz-btn" [class.is-busy]="busy()" [disabled]="busy()"><svg gzIcon="check" />{{ editing() ? i18n.q('حفظ التغييرات', 'Save changes') : t().savePattern }}</button>
          <button type="button" class="gz-btn-text mt-1" [disabled]="busy()" (click)="cancel()">{{ t().cancel }}</button>
          @if (editing()) {
            <button type="button" class="gz-btn-text danger" [disabled]="busy()" (click)="remove()"><svg gzIcon="trash" size="s" />{{ i18n.q('حذف الباترون', 'Delete pattern') }}</button>
          }
        </form>
      }
    </ion-content>

    <gz-sheet [open]="sheet() === 'history'" [title]="i18n.q('النسخ السابقة', 'Earlier versions')" [description]="i18n.q('الاسترجاع بيحط النص القديم في المحرّر كتعديل غير محفوظ — مفيش حاجة بتتغير قبل ما تضغطي حفظ.', 'Restoring puts the old text in the editor as an unsaved change — nothing changes until you save.')" (closed)="sheet.set(null)">
      <div class="flex flex-col gap-2">
        @for (r of history(); track r.id) {
          <div class="gz-rcard">
            <div class="flex items-center gap-2">
              <div class="min-w-0 flex-1"><div class="gz-b">{{ i18n.q('النسخة ', 'Version ') }}<span class="gz-ltr">{{ r.rev }}</span></div><div class="gz-xs gz-mute">{{ rounds(r.text) }} {{ i18n.q('أدوار', 'rounds') }}</div></div>
              <button type="button" class="gz-btn3" (click)="restore(r.id)">{{ i18n.q('استرجاع', 'Restore') }}</button>
            </div>
          </div>
        }
      </div>
    </gz-sheet>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddPatternPage implements HasUnsavedChanges {
  protected readonly i18n = inject(I18nService);
  protected readonly nav = inject(NavController);
  protected readonly store = inject(AppStore);
  private readonly sync = inject(SyncService);
  private readonly ui = inject(UiFeedback);
  private readonly drafts = inject(ImportDraftService);

  readonly id = input<string>();
  protected readonly t = this.i18n.t;
  protected readonly levels = LVL_IDS;
  protected readonly LVL = LVL;
  protected readonly placeholder = 'R1: 6sc in MR [6]\nR2: inc × 6 [12]\nR3: (sc, inc) × 6 [18]';
  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    level: new FormControl<LevelId>(this.store.profile().level, { nonNullable: true }),
    terms: new FormControl<'us' | 'uk'>(this.store.profile().terms, { nonNullable: true }),
    attribution: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
    text: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(20000)] }),
  });
  protected readonly v = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() }) as () => ReturnType<typeof this.form.getRawValue>;
  protected readonly src = signal<Src>('text');
  protected readonly file = signal<File | null>(null);
  protected readonly fileErr = signal('');
  protected readonly busy = signal(false);
  protected readonly sheet = signal<'history' | null>(null);
  private readonly submitted = signal(false);
  private sourceText = '';
  private saved = false;
  private loadedFor: string | null = null;

  protected readonly editing = computed(() => !!this.id());
  protected readonly original = computed<Pattern | null>(() => this.store.pattern(this.id()));
  protected readonly nameErr = computed(() => this.submitted() && !(this.v().name ?? '').trim());
  protected readonly textErr = computed(() => (this.v().text ?? '').length > 20000);
  protected readonly sources = computed(() => [
    { id: 'text' as Src, label: this.i18n.q('نص', 'Paste text') },
    { id: 'pdf' as Src, label: 'PDF' },
    { id: 'image' as Src, label: this.i18n.q('صورة', 'Image') },
  ]);
  protected readonly parsed = computed(() => {
    const txt = (this.v().text ?? '').trim();
    return txt ? parsePattern(txt) : null;
  });
  protected readonly msg = computed(() => {
    const p = this.parsed();
    if (!p) return '';
    if (p.ok) return this.i18n.q(`✓ تم فهم ${p.rounds.length} أدوار — ${p.total} غرزة ناتجة`, `✓ ${p.rounds.length} rounds understood — ${p.total} output stitches`);
    const bad = p.rounds.filter((r) => !r.ok).slice(0, 2).map((r) => r.raw).join('\n');
    return this.i18n.q(`${p.bad} سطر مش مدعوم:\n${bad}`, `${p.bad} unsupported line(s):\n${bad}`);
  });

  protected readonly textChanged = computed(() => {
    const o = this.original();
    return !!o && (o.text !== (this.v().text ?? '').trim() || o.terms !== this.v().terms);
  });
  protected readonly diff = computed(() => {
    const o = this.original();
    return o && this.textChanged() ? diffPatterns(o.text, (this.v().text ?? '').trim()) : null;
  });
  protected readonly changed = computed(() => (this.diff()?.changes ?? []).filter((c) => c.kind !== 'same').slice(0, 8));
  /** Running projects that follow this pattern, and what the edit would mean for their position. */
  protected readonly affected = computed(() => {
    const o = this.original();
    if (!o) return [];
    const next = (this.v().text ?? '').trim();
    return this.store
      .projects()
      .filter((p) => p.tracker.patternId === o.id)
      .map((p) => {
        const q = (a: string, e: string) => this.i18n.q(a, e);
        if (p.patternPin) return { id: p.id, name: p.name, level: 'safe' as const, text: q('مثبّت على نسخة سابقة بالفعل.', 'Already pinned to an earlier version.') };
        if (p.tracker.mode !== 'pattern') return { id: p.id, name: p.name, level: 'safe' as const, text: q('عدّاد بسيط — مش متأثر.', 'Simple counter — not affected.') };
        const m = mapCursor(o.text, next, p.tracker.cursor);
        const text =
          m.level === 'safe'
            ? q('موضع التتبّع آمن مع التعديل.', 'Tracker position is safe with this edit.')
            : m.level === 'warn'
              ? q('الموضع محفوظ، لكن أدوار منفّذة أو الحالية اتعدّلت.', 'Position kept, but completed or current rounds were edited.')
              : q('الموضع مش هيتطابق مع النص الجديد — هتتأكدي قبل التحديث.', 'The position cannot be mapped to the new text — you will confirm before updating.');
        return { id: p.id, name: p.name, level: m.level, text };
      });
  });
  protected readonly history = computed(() => (this.id() ? this.store.revisionsOf('pattern', this.id()!) : []));

  protected rounds(text: string | undefined): number {
    return parsePattern(text ?? '').rounds.length;
  }

  /** Ionic lifecycle: first show, and again when the user returns from Smart paste. */
  ionViewWillEnter(): void {
    this.hydrate();
    const draft = this.drafts.take('pattern');
    if (!draft || !draft.parts.length) return;
    const first = draft.parts[0];
    this.form.controls.text.setValue(first.text);
    if (!this.form.controls.name.value.trim() && (draft.collectionName || first.name)) this.form.controls.name.setValue((draft.collectionName || first.name).slice(0, 120));
    this.form.controls.terms.setValue('us'); // the normalized text is always written in US terms
    this.sourceText = draft.sourceText;
    this.form.markAsDirty();
    void this.ui.say('تم التحويل — راجعي النص واحفظي', 'Converted — review the text and save');
  }

  constructor() {
    // A deep link / app restart opens this page before the store has loaded: hydrate as soon as the pattern is available.
    effect(() => {
      this.original();
      this.store.loaded();
      untracked(() => this.hydrate());
    });
  }

  private hydrate(): void {
    const key = this.id() ?? '';
    if (this.loadedFor === key) return;
    if (key && !this.original()) return; // not loaded yet — the effect calls again when it is
    this.loadedFor = key;
    const o = this.original();
    if (!o || o.isSample) return;
    this.form.reset({ name: o.name, level: o.level, terms: o.terms, attribution: o.attribution, text: o.text }, { emitEvent: true });
    this.sourceText = o.sourceText ?? '';
    this.src.set(o.source === 'pdf' || o.source === 'image' ? o.source : 'text');
    this.form.markAsPristine();
  }

  hasUnsavedChanges(): boolean {
    return !this.saved && (this.form.dirty || !!this.file());
  }

  protected setSrc(s: Src): void {
    this.src.set(s);
    this.file.set(null);
    this.fileErr.set('');
  }

  protected example(): void {
    this.form.controls.text.setValue(P2_TEXT.split('\n').slice(0, 4).join('\n'));
    this.form.markAsDirty();
  }

  protected smartPaste(): void {
    void this.nav.navigateForward('/tabs/home/patterns/import?target=pattern');
  }

  protected restore(revId: string): void {
    const r = this.history().find((x) => x.id === revId);
    if (!r || r.text === undefined) return;
    this.form.controls.text.setValue(r.text);
    this.form.controls.terms.setValue(r.terms);
    this.form.markAsDirty();
    this.sheet.set(null);
    void this.ui.say('اتحطّت النسخة القديمة — اضغطي حفظ للتأكيد', 'Old version loaded — tap Save to confirm');
  }

  protected onFile(ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    this.fileErr.set('');
    const okType = this.src() === 'pdf' ? f.type === 'application/pdf' : ['image/jpeg', 'image/png', 'image/webp'].includes(f.type);
    if (!okType) return void this.fileErr.set(this.t().badType);
    if (f.size > MAX_FILE) return void this.fileErr.set(this.i18n.q('الملف كبير جدًا (الحد 10 ميجا).', 'That file is too large (10 MB max).'));
    this.file.set(f);
  }

  protected cancel(): void {
    void this.nav.back(); // the unsaved-changes guard decides whether to ask
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    const v = this.form.getRawValue();
    if (!v.name.trim() || v.text.length > 20000 || this.busy()) return;
    if (this.editing()) return this.saveEdit();
    const src = this.src();
    if (src === 'text' && !v.text.trim()) return this.ui.say('الصقي نص الباترن أو اختاري ملف', 'Paste the pattern text or choose a file');
    const f = this.file();
    if (src !== 'text' && !f) return this.fileErr.set(this.i18n.q('اختاري ملف الأول.', 'Choose a file first.'));
    this.busy.set(true);
    try {
      const id = uuid();
      const file: PatternFile | null = f ? { name: f.name.slice(0, 200), size: f.size, mime: f.type, storagePath: null } : null;
      const pat: Pattern = {
        id, isSample: false, name: v.name.trim(), level: v.level, terms: v.terms, source: src, text: src === 'text' ? v.text.trim() : '',
        file, attribution: v.attribution.trim(), sourceUrl: '', position: 0, rev: 1, sourceText: this.sourceText, updatedAt: Date.now(), deletedAt: null,
      };
      await this.store.addPattern(pat);
      this.saved = true;
      if (f) {
        // The pattern row must exist on the server before its private file can be attached to it.
        const storagePath = await this.sync.uploadPatternFile(id, f);
        if (storagePath) await this.store.updatePattern(id, (p) => ({ ...p, file: p.file ? { ...p.file, storagePath } : p.file }), false);
      }
      await this.nav.navigateForward(['/tabs/home/patterns', id], { replaceUrl: true });
      await this.ui.say('تم حفظ الباترن', 'Pattern saved');
    } finally {
      this.busy.set(false);
    }
  }

  private async saveEdit(): Promise<void> {
    const o = this.original();
    const id = this.id();
    if (!o || !id) return;
    const v = this.form.getRawValue();
    if (o.source === 'text' && !v.text.trim()) return this.ui.say('نص الباترن مينفعش يبقى فاضي', 'The pattern text cannot be empty');
    const text = v.text.trim();
    // A structural edit under running projects is the one case worth an explicit confirmation.
    if (this.textChanged() && this.diff()?.structural && this.affected().length) {
      const n = this.affected().length;
      const ok = await this.ui.confirm(
        this.i18n.q('حفظ تعديل على الباترون؟', 'Save this edit?'),
        this.i18n.q(`${n} مشروع شغّال عليه هيفضلوا على النسخة الحالية، وتقدرِي تحدّثيهم بنفسك بعدين.`, `${n} running project(s) stay on the current version; you can update them yourself later.`),
        this.i18n.q('حفظ التعديل', 'Save edit'),
        false,
      );
      if (!ok) return;
    }
    this.busy.set(true);
    try {
      const res = await this.store.savePatternEdit(id, { name: v.name.trim(), level: v.level, terms: v.terms, text, attribution: v.attribution.trim(), suggestedMinutes: o.suggestedMinutes });
      this.saved = true;
      await this.nav.back();
      await this.ui.say(res.pinned ? 'اتحفظ — المشاريع الشغّالة فضلت على نسختها' : 'تم حفظ التغييرات', res.pinned ? 'Saved — running projects stay on their version' : 'Changes saved');
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const id = this.id();
    if (!id) return;
    const n = this.store.projects().filter((p) => p.tracker.patternId === id).length;
    const ok = await this.ui.confirm(
      this.i18n.q('حذف الباترون؟', 'Delete this pattern?'),
      n ? this.i18n.q(`${n} مشروع مربوط بيه هيتحوّل لعدّاد بسيط.`, `${n} linked project(s) switch to the simple counter.`) : this.i18n.q('مش هينفع تتراجعي عن الحذف.', 'This cannot be undone.'),
      this.i18n.q('حذف الباترون', 'Delete pattern'),
    );
    if (!ok) return;
    this.saved = true;
    await this.store.deletePattern(id);
    await this.nav.navigateRoot('/tabs/home/patterns');
  }
}
