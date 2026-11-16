import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonContent, IonHeader, IonInput, NavController } from '@ionic/angular';
import { LVL, LVL_IDS, LevelId, P2_TEXT } from '../../core/data/catalog';
import { parsePattern } from '../../core/domain/pattern-parser';
import { I18nService } from '../../core/i18n/i18n.service';
import { Pattern, PatternFile } from '../../core/models/models';
import { AppStore } from '../../core/state/app.store';
import { uuid } from '../../core/state/factories';
import { SyncService } from '../../core/sync/sync.service';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';

type Src = 'text' | 'pdf' | 'image';
const MAX_FILE = 10 * 1024 * 1024;

/** GZ-S18 — add a pattern from pasted text, or keep a PDF / image as a reference (no fake OCR). */
@Component({
  selector: 'gz-add-pattern',
  imports: [IonHeader, IonContent, IonInput, ReactiveFormsModule, IconComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top">
        <button type="button" class="gz-icb" (click)="nav.back()" [attr.aria-label]="t().back"><svg gzIcon="arrowl" [flip]="true" /></button>
        <h1 class="gz-ttl gz-hd">{{ t().addPattern }}</h1>
        <span style="width: 46px"></span>
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      <form class="gz-pad" [formGroup]="form" (ngSubmit)="save()" novalidate>
        <label class="gz-lbl" for="ap-name">{{ t().patName }}</label>
        <div class="gz-in" [class.invalid]="nameErr()">
          <svg gzIcon="file" />
          <ion-input id="ap-name" formControlName="name" maxlength="120" [placeholder]="t().patNamePh" [attr.aria-label]="t().patName" />
        </div>
        @if (nameErr()) {
          <div class="gz-err" role="alert">{{ t().projNameErr }}</div>
        }

        <span class="gz-lbl">{{ t().patLevel }}</span>
        <div class="gz-chips">
          @for (l of levels; track l) {
            <button type="button" class="gz-chip sm" [class.on]="v().level === l" [attr.aria-pressed]="v().level === l" (click)="form.controls.level.setValue(l)">{{ LVL[l][i18n.lang()] }}</button>
          }
        </div>
        <span class="gz-lbl">{{ t().patTerms }}</span>
        <div class="gz-seg">
          <button type="button" [class.on]="v().terms === 'us'" (click)="form.controls.terms.setValue('us')">{{ t().us }}</button>
          <button type="button" [class.on]="v().terms === 'uk'" (click)="form.controls.terms.setValue('uk')">{{ t().uk }}</button>
        </div>

        <label class="gz-lbl" for="ap-attr">{{ t().patAttribution }}</label>
        <div class="gz-in"><svg gzIcon="user" /><ion-input id="ap-attr" formControlName="attribution" maxlength="200" [placeholder]="t().patAttributionPh" [attr.aria-label]="t().patAttribution" /></div>

        <span class="gz-lbl">{{ t().patSource }}</span>
        <div class="gz-seg" role="tablist">
          @for (s of sources(); track s.id) {
            <button type="button" role="tab" [class.on]="src() === s.id" (click)="setSrc(s.id)" style="font-size: 13px">{{ s.label }}</button>
          }
        </div>

        @if (src() === 'text') {
          <label class="gz-lbl" for="ap-text">{{ t().pastePattern }}</label>
          <textarea id="ap-text" class="gz-ta gz-ltr" dir="ltr" style="min-height: 150px" formControlName="text" [placeholder]="placeholder"></textarea>
          @if (msg(); as m) {
            <div class="gz-note mt-2" [class.sage]="parsed()?.ok"><span style="white-space: pre-line">{{ m }}</span></div>
          }
          <button type="button" class="gz-btn3 w mt-2" (click)="example()">{{ t().fillExample }}</button>
        } @else {
          <label class="gz-rcard dashed mt-3 flex flex-col items-center gap-1.5 text-center" style="padding: 24px 14px; cursor: pointer">
            <input class="gz-sr" type="file" [accept]="src() === 'pdf' ? 'application/pdf' : 'image/jpeg,image/png,image/webp'" (change)="onFile($event)" />
            <div class="gz-tile t-lav" style="width: 56px; height: 56px; border-radius: 20px"><svg [gzIcon]="src() === 'pdf' ? 'file' : 'image'" size="l" /></div>
            <span class="gz-b" style="color: var(--gz-primary)">{{ src() === 'pdf' ? i18n.q('اختاري ملف PDF', 'Choose a PDF file') : i18n.q('اختاري صورة الباترن', 'Choose a pattern image') }}</span>
            <span class="gz-xs gz-mute">{{ file()?.name ?? i18n.q('لم يتم اختيار ملف', 'No file chosen') }}</span>
          </label>
          <div class="gz-note mt-2.5"><svg gzIcon="info" size="s" /><span>{{ t().notConnected }}</span></div>
        }
        <div style="height: 16px"></div>
        <button type="submit" class="gz-btn" [disabled]="busy()"><svg gzIcon="check" />{{ t().savePattern }}</button>
      </form>
    </ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddPatternPage {
  protected readonly i18n = inject(I18nService);
  protected readonly nav = inject(NavController);
  private readonly store = inject(AppStore);
  private readonly sync = inject(SyncService);
  private readonly ui = inject(UiFeedback);

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
  protected readonly busy = signal(false);
  private readonly submitted = signal(false);
  protected readonly nameErr = computed(() => this.submitted() && !(this.v().name ?? '').trim());
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

  protected setSrc(s: Src): void {
    this.src.set(s);
    this.file.set(null);
  }

  protected example(): void {
    this.form.controls.text.setValue(P2_TEXT.split('\n').slice(0, 4).join('\n'));
  }

  protected onFile(ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const okType = this.src() === 'pdf' ? f.type === 'application/pdf' : ['image/jpeg', 'image/png', 'image/webp'].includes(f.type);
    if (!okType) return void this.ui.toast(this.t().badType);
    if (f.size > MAX_FILE) return void this.ui.toast(this.i18n.q('الملف كبير جدًا (الحد 10 ميجا).', 'That file is too large (10 MB max).'));
    this.file.set(f);
  }

  protected async save(): Promise<void> {
    this.submitted.set(true);
    const v = this.form.getRawValue();
    if (!v.name.trim()) return;
    const src = this.src();
    if (src === 'text' && !v.text.trim()) return this.ui.say('الصقي نص الباترن أو اختاري ملف', 'Paste the pattern text or choose a file');
    const f = this.file();
    if (src !== 'text' && !f) return this.ui.say('اختاري ملف الأول', 'Choose a file first');
    this.busy.set(true);
    try {
      const id = uuid();
      const file: PatternFile | null = f ? { name: f.name.slice(0, 200), size: f.size, mime: f.type, storagePath: null } : null;
      const pat: Pattern = {
        id, isSample: false, name: v.name.trim(), level: v.level, terms: v.terms, source: src, text: src === 'text' ? v.text.trim() : '',
        file, attribution: v.attribution.trim(), sourceUrl: '', position: 0, updatedAt: Date.now(), deletedAt: null,
      };
      await this.store.addPattern(pat);
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
}
