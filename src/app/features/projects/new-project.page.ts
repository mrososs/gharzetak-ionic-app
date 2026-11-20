import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonContent, IonHeader, IonInput, NavController, ViewWillEnter } from '@ionic/angular';
import { CAT, CAT_IDS, CategoryId, HOOKS, YARN, YARN_IDS, YarnId } from '../../core/data/catalog';
import { HasUnsavedChanges } from '../../core/guards/unsaved-changes.guard';
import { parsePattern } from '../../core/domain/pattern-parser';
import { I18nService } from '../../core/i18n/i18n.service';
import { Pattern } from '../../core/models/models';
import { AppStore } from '../../core/state/app.store';
import { createCollectionProject, createProject, uuid } from '../../core/state/factories';
import { readImageFile } from '../../core/utils/image';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PhotoComponent } from '../../shared/ui/images/photo.component';
import { DurationInputComponent } from '../../shared/ui/inputs/duration-input.component';
import { StepperComponent } from '../../shared/ui/inputs/stepper.component';
import type { TourId } from '../../core/tour/tour-ids';
import { TourOfferComponent } from '../../shared/ui/tour/tour-offer.component';
import { TourTargetDirective } from '../../shared/ui/tour/tour-target.directive';

type Source = { kind: 'none' } | { kind: 'collection'; id: string } | { kind: 'pattern'; id: string };

/** GZ-S13 — create a project: free-form, from a saved pattern, or from a multi-part collection. Optional estimated time. */
@Component({
  selector: 'gz-new-project',
  imports: [IonHeader, IonContent, IonInput, ReactiveFormsModule, IconComponent, PhotoComponent, StepperComponent, DurationInputComponent, TourOfferComponent, TourTargetDirective],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top">
        <button type="button" class="gz-icb" (click)="nav.back()" [attr.aria-label]="t().back"><svg gzIcon="arrowl" [flip]="true" /></button>
        <h1 class="gz-ttl gz-hd">{{ t().newProject }}</h1>
        <span style="width: 46px"></span>
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      <form class="gz-pad" [formGroup]="form" (ngSubmit)="save()" novalidate>
        <gz-tour-offer [tours]="tourOffers()" />
        <label class="gz-lbl" for="np-name">{{ t().projName }}</label>
        <div class="gz-in" [gzTour]="'project-new.name'" [class.invalid]="nameErr()">
          <svg gzIcon="yarn" />
          <ion-input id="np-name" formControlName="name" maxlength="120" [placeholder]="t().projNamePh" [attr.aria-label]="t().projName" />
        </div>
        @if (nameErr()) {
          <div class="gz-field-err" role="alert">{{ t().projNameErr }}</div>
        }

        @if (collections().length || patterns().length) {
          <div [gzTour]="'project-new.source'">
          <span class="gz-lbl">{{ i18n.q('ابدئي من باترون محفوظ (اختياري)', 'Start from a saved pattern (optional)') }}</span>
          <div class="gz-hs" style="padding-block: 0">
            <button type="button" class="gz-chip sm" [class.on]="source().kind === 'none'" [attr.aria-pressed]="source().kind === 'none'" (click)="choose({ kind: 'none' })">{{ i18n.q('بدون', 'None') }}</button>
            @for (c of collections(); track c.id) {
              <button type="button" class="gz-chip sm" [class.on]="isSel('collection', c.id)" [attr.aria-pressed]="isSel('collection', c.id)" (click)="choose({ kind: 'collection', id: c.id })"><svg gzIcon="folder" size="s" />{{ c.name }}</button>
            }
            @for (p of patterns(); track p.id) {
              <button type="button" class="gz-chip sm" [class.on]="isSel('pattern', p.id)" [attr.aria-pressed]="isSel('pattern', p.id)" (click)="choose({ kind: 'pattern', id: p.id })">{{ store.patternName(p) }}</button>
            }
          </div>
          </div>
          @if (selCollection(); as c) {
            <div class="gz-note lav mt-2"><svg gzIcon="info" size="s" /><span>{{ i18n.q('هيتعمل عدّاد مستقل لكل قطعة: ' + pieces() + ' قطعة من ' + c.parts.length + ' أجزاء. تقدّم قطعة مش بيأثر على التانية.', 'Every piece gets its own counter: ' + pieces() + ' pieces from ' + c.parts.length + ' parts. Progress on one piece never affects another.') }}</span></div>
          }
        }

        <span class="gz-lbl">{{ t().category }}</span>
        <div class="gz-chips">
          @for (c of cats; track c) {
            <button type="button" class="gz-chip sm" [class.on]="v().category === c" [attr.aria-pressed]="v().category === c" (click)="form.controls.category.setValue(c)">{{ CAT[c][i18n.lang()] }}</button>
          }
        </div>
        <span class="gz-lbl">{{ t().hook }}</span>
        <div class="gz-chips">
          @for (h of hooks; track h) {
            <button type="button" class="gz-chip sm" [class.on]="v().hook === h" [attr.aria-pressed]="v().hook === h" (click)="form.controls.hook.setValue(h)"><span class="gz-ltr">{{ h }} mm</span></button>
          }
        </div>
        <span class="gz-lbl">{{ t().yarn }}</span>
        <div class="gz-chips">
          @for (y of yarns; track y) {
            <button type="button" class="gz-chip sm" [class.on]="v().yarn === y" [attr.aria-pressed]="v().yarn === y" (click)="form.controls.yarn.setValue(y)">{{ YARN[y][i18n.lang()] }}</button>
          }
        </div>

        <span class="gz-lbl" id="np-time-l">{{ i18n.q('الوقت المتوقع لإنهاء المشروع (اختياري)', 'Expected time to finish the project (optional)') }}</span>
        <gz-duration-input labelId="np-time-l" [value]="minutes()" (valueChange)="setMinutes($event)" />
        <div class="gz-field-hint">{{ i18n.q('تقدري تسيبيه فاضي وتضيفيه بعدين من تفاصيل المشروع. مش بيأثر على وقت الشغل المسجّل.', 'Leave it empty and add it later from the project details. It never changes the recorded work time.') }}</div>
        @if (suggested() > 0 && minutes() === 0) {
          <button type="button" class="gz-btn-text" (click)="setMinutes(suggested())">{{ i18n.q('استخدمي الوقت المقترح', 'Use the suggested time') }}</button>
        }

        <span class="gz-lbl">{{ t().coverImage }}</span>
        <div class="flex items-center gap-3">
          <gz-photo class="flex-none" tone="lav" [src]="cover()" [alt]="t().coverImage" [showLabel]="false" height="96px" width="96px" extraClass="r16" />
          <div class="flex flex-1 flex-col gap-2">
            <label class="gz-btn3 w" style="cursor: pointer">
              <input class="gz-sr" type="file" accept="image/*" (change)="onCover($event)" />
              <svg gzIcon="camera" size="s" />{{ t().chooseImage }}
            </label>
            <span class="gz-xs gz-mute">{{ t().coverHint }}</span>
          </div>
        </div>

        @if (source().kind === 'none') {
          <span class="gz-lbl">{{ t().optTarget }}</span>
          <div class="flex items-center justify-between gap-2.5">
            <span class="gz-sm gz-mute flex-1">{{ t().optTargetHint }}</span>
            <gz-stepper [display]="v().target > 0 ? v().target : '—'" [label]="t().optTarget" (inc)="setTarget(v().target + 1)" (dec)="setTarget(v().target - 1)" />
          </div>
          <div class="gz-hs mt-2" style="padding-block: 0">
            @for (n of presets; track n) {
              <button type="button" class="gz-chip sm" [class.on]="v().target === n" (click)="setTarget(n)"><span class="gz-ltr">{{ n }}</span></button>
            }
          </div>

          <label class="gz-lbl" for="np-pat">{{ t().optPattern }}</label>
          <textarea id="np-pat" class="gz-ta gz-ltr" style="min-height: 110px" dir="ltr" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" formControlName="pattern" [placeholder]="placeholder"></textarea>
          @if (patMsg(); as m) {
            <div class="gz-note mt-2" [class.sage]="parsed()?.ok"><span>{{ m }}</span></div>
          }
        }

        <div style="height: 16px"></div>
        <button type="submit" class="gz-btn" [class.is-busy]="busy()" [disabled]="busy()"><svg gzIcon="check" />{{ t().saveProject }}</button>
      </form>
    </ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewProjectPage implements HasUnsavedChanges, ViewWillEnter {
  protected readonly i18n = inject(I18nService);
  protected readonly nav = inject(NavController);
  protected readonly store = inject(AppStore);
  private readonly ui = inject(UiFeedback);

  /** `?collection=<id>` (from a collection's "Start a project") preselects that collection. */
  readonly collection = input<string>();
  /** Not offered when the page was opened from a multi-part pattern: that person has already chosen where to start. */
  protected readonly tourOffers = computed<readonly TourId[]>(() => (this.collection() ? [] : ['project-create']));

  protected readonly t = this.i18n.t;
  protected readonly cats = CAT_IDS;
  protected readonly hooks = HOOKS;
  protected readonly yarns = YARN_IDS;
  protected readonly CAT = CAT;
  protected readonly YARN = YARN;
  protected readonly presets = [12, 18, 24, 30, 36, 48];
  protected readonly placeholder = 'R1: 6sc in MR [6]\nR2: inc × 6 [12]\nR3: (sc, inc) × 6 [18]';

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    category: new FormControl<CategoryId>('amigurumi', { nonNullable: true }),
    hook: new FormControl<string>('3.0', { nonNullable: true }),
    yarn: new FormControl<YarnId>('cotton', { nonNullable: true }),
    target: new FormControl(0, { nonNullable: true, validators: [Validators.min(0), Validators.max(500)] }),
    pattern: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(20000)] }),
  });
  protected readonly v = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() }) as () => ReturnType<typeof this.form.getRawValue>;
  protected readonly cover = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly source = signal<Source>({ kind: 'none' });
  /** Whole minutes; 0 = no estimate (the field is optional). */
  protected readonly minutes = signal(0);
  private minutesTouched = false;
  private saved = false;
  private readonly submitted = signal(false);

  protected readonly collections = computed(() => this.store.collections().filter((c) => c.parts.length > 0));
  protected readonly patterns = computed(() => this.store.patterns().filter((p) => p.text.trim() && parsePattern(p.text).ok));
  protected readonly selCollection = computed(() => {
    const s = this.source();
    return s.kind === 'collection' ? this.store.collection(s.id) : null;
  });
  protected readonly selPattern = computed<Pattern | null>(() => {
    const s = this.source();
    return s.kind === 'pattern' ? this.store.pattern(s.id) : null;
  });
  protected readonly pieces = computed(() => (this.selCollection()?.parts ?? []).reduce((a, p) => a + p.quantity, 0));
  /** A suggested duration from the chosen pattern / collection: only ever a pre-fill, never imposed. */
  protected readonly suggested = computed(() => this.selCollection()?.suggestedMinutes ?? this.selPattern()?.suggestedMinutes ?? 0);

  protected readonly nameErr = computed(() => this.submitted() && !(this.v().name ?? '').trim());
  protected readonly parsed = computed(() => {
    const txt = (this.v().pattern ?? '').trim();
    return txt ? parsePattern(txt) : null;
  });
  protected readonly patMsg = computed(() => {
    const p = this.parsed();
    if (!p) return '';
    return p.ok
      ? this.i18n.q(`✓ تم فهم ${p.rounds.length} أدوار (${p.total} غرزة ناتجة) — هيتربط بالمشروع.`, `✓ ${p.rounds.length} rounds understood (${p.total} output stitches) — it will be linked to the project.`)
      : this.i18n.q(`${p.bad} سطر مش مدعوم — هيتحفظ كنص، لكن العدّ بالباترن مش هيشتغل.`, `${p.bad} line(s) unsupported — saved as text, but pattern counting will not work.`);
  });

  constructor() {
    effect(() => {
      const id = this.collection();
      if (id && this.store.collection(id)) untracked(() => this.choose({ kind: 'collection', id }));
    });
  }

  hasUnsavedChanges(): boolean {
    return !this.saved && (this.form.dirty || this.minutes() > 0 || !!this.cover());
  }

  protected isSel(kind: 'collection' | 'pattern', id: string): boolean {
    const s = this.source();
    return s.kind === kind && s.id === id;
  }

  protected choose(s: Source): void {
    this.source.set(s);
    // Name the project after the design if the user has not typed a name yet.
    const label = s.kind === 'collection' ? this.store.collection(s.id)?.name : s.kind === 'pattern' ? (this.store.pattern(s.id) ? this.store.patternName(this.store.pattern(s.id)!) : '') : '';
    if (label && !this.form.controls.name.value.trim()) this.form.controls.name.setValue(label.slice(0, 120));
    // Pre-fill the estimate from the pattern's suggestion, but never override something the user typed.
    if (!this.minutesTouched) this.minutes.set(this.suggested());
  }

  protected setMinutes(m: number): void {
    this.minutesTouched = true;
    this.minutes.set(Math.max(0, m));
  }

  /**
   * Ionic keeps routed pages cached inside the tab stack and re-activates the same instance when the URL is opened again, so a
   * discarded draft (name, pattern and especially the chosen cover photo) used to reappear in the NEXT new project. Every entry
   * starts from a blank form (and re-applies a `?collection=` preselection, which the reset would otherwise erase).
   */
  ionViewWillEnter(): void {
    this.resetForm();
    this.saved = false;
    const id = this.collection();
    if (id && this.store.collection(id)) this.choose({ kind: 'collection', id });
  }

  private resetForm(): void {
    this.form.reset({ name: '', category: 'amigurumi', hook: '3.0', yarn: 'cotton', target: 0, pattern: '' });
    this.cover.set(null);
    this.submitted.set(false);
    this.busy.set(false);
    this.source.set({ kind: 'none' });
    this.minutes.set(0);
    this.minutesTouched = false;
  }

  protected setTarget(n: number): void {
    this.form.controls.target.setValue(Math.max(0, Math.min(500, n)));
    this.form.markAsDirty();
  }

  protected async onCover(ev: Event): Promise<void> {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const r = await readImageFile(file);
    if ('error' in r) return this.ui.toast(this.t()[r.error]);
    this.cover.set(r.dataUrl);
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    const v = this.form.getRawValue();
    if (!v.name.trim() || this.busy()) return;
    this.busy.set(true);
    try {
      const base = { name: v.name, category: v.category, hook: v.hook, yarn: v.yarn, target: v.target, coverLocalUrl: this.cover(), estimatedMinutes: this.minutes() };
      const src = this.source();
      let project;
      if (src.kind === 'collection' && this.selCollection()) {
        project = createCollectionProject(base, this.selCollection()!);
      } else if (src.kind === 'pattern' && this.selPattern()) {
        const pat = this.selPattern()!;
        project = createProject({ ...base, patternId: pat.id, totalRounds: parsePattern(pat.text).rounds.length });
      } else {
        const parsed = this.parsed();
        let patternId: string | null = null;
        if (parsed) {
          const pat: Pattern = {
            id: uuid(), isSample: false, name: `${v.name.trim()} — ${this.i18n.q('باترن', 'pattern')}`.slice(0, 120), level: this.store.profile().level,
            terms: this.store.profile().terms, source: 'text', text: v.pattern.trim(), file: null, attribution: '', sourceUrl: '', position: 0, rev: 1, updatedAt: Date.now(), deletedAt: null,
          };
          await this.store.addPattern(pat);
          if (parsed.ok) patternId = pat.id;
        }
        project = createProject({ ...base, patternId, totalRounds: parsed?.ok ? parsed.rounds.length : 0 });
      }
      await this.store.addProject(project, true);
      this.saved = true;
      this.resetForm(); // a cached page instance must not keep the saved project's cover/name (saved stays true until re-entry)
      await this.nav.navigateRoot('/tabs/projects');
      await this.ui.say('تم حفظ المشروع وظهر في «مشاريعي»', 'Project saved and added to My projects');
    } finally {
      this.busy.set(false);
    }
  }
}
