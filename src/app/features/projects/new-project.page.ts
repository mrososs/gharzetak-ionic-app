import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { IonContent, IonHeader, IonInput, NavController, ViewWillEnter } from '@ionic/angular';
import { CAT, CAT_IDS, CategoryId, HOOKS, YARN, YARN_IDS, YarnId } from '../../core/data/catalog';
import { parsePattern } from '../../core/domain/pattern-parser';
import { I18nService } from '../../core/i18n/i18n.service';
import { Pattern } from '../../core/models/models';
import { AppStore } from '../../core/state/app.store';
import { createProject, uuid } from '../../core/state/factories';
import { readImageFile } from '../../core/utils/image';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PhotoComponent } from '../../shared/ui/images/photo.component';
import { StepperComponent } from '../../shared/ui/inputs/stepper.component';

/** GZ-S13 — create a project (typed reactive form, live deterministic pattern parsing). */
@Component({
  selector: 'gz-new-project',
  imports: [IonHeader, IonContent, IonInput, ReactiveFormsModule, IconComponent, PhotoComponent, StepperComponent],
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
        <label class="gz-lbl" for="np-name">{{ t().projName }}</label>
        <div class="gz-in" [class.invalid]="nameErr()">
          <svg gzIcon="yarn" />
          <ion-input id="np-name" formControlName="name" maxlength="120" [placeholder]="t().projNamePh" [attr.aria-label]="t().projName" />
        </div>
        @if (nameErr()) {
          <div class="gz-err" role="alert">{{ t().projNameErr }}</div>
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
        <textarea id="np-pat" class="gz-ta gz-ltr" style="min-height: 110px" dir="ltr" formControlName="pattern" [placeholder]="placeholder"></textarea>
        @if (patMsg(); as m) {
          <div class="gz-note mt-2" [class.sage]="parsed()?.ok"><span>{{ m }}</span></div>
        }

        <div style="height: 16px"></div>
        <button type="submit" class="gz-btn" [disabled]="busy()"><svg gzIcon="check" />{{ t().saveProject }}</button>
      </form>
    </ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewProjectPage implements ViewWillEnter {
  protected readonly i18n = inject(I18nService);
  protected readonly nav = inject(NavController);
  private readonly store = inject(AppStore);
  private readonly ui = inject(UiFeedback);

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
  private readonly submitted = signal(false);

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

  /**
   * Ionic keeps routed pages cached inside the tab stack and re-activates the same instance when the URL is opened again, so a
   * discarded draft (name, pattern and especially the chosen cover photo) used to reappear in the NEXT new project. Every entry
   * starts from a blank form.
   */
  ionViewWillEnter(): void {
    this.resetForm();
  }

  private resetForm(): void {
    this.form.reset({ name: '', category: 'amigurumi', hook: '3.0', yarn: 'cotton', target: 0, pattern: '' });
    this.cover.set(null);
    this.submitted.set(false);
    this.busy.set(false);
  }

  protected setTarget(n: number): void {
    this.form.controls.target.setValue(Math.max(0, Math.min(500, n)));
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
    if (!v.name.trim()) return;
    this.busy.set(true);
    try {
      const parsed = this.parsed();
      let patternId: string | null = null;
      if (parsed) {
        const pat: Pattern = {
          id: uuid(), isSample: false, name: `${v.name.trim()} — ${this.i18n.q('باترن', 'pattern')}`.slice(0, 120), level: this.store.profile().level,
          terms: this.store.profile().terms, source: 'text', text: v.pattern.trim(), file: null, attribution: '', sourceUrl: '', position: 0, updatedAt: Date.now(), deletedAt: null,
        };
        await this.store.addPattern(pat);
        if (parsed.ok) patternId = pat.id;
      }
      const project = createProject({ name: v.name, category: v.category, hook: v.hook, yarn: v.yarn, target: v.target, coverLocalUrl: this.cover(), patternId, totalRounds: parsed?.ok ? parsed.rounds.length : 0 });
      await this.store.addProject(project);
      this.resetForm(); // a cached page instance must not keep the saved project's cover/name
      await this.nav.navigateRoot('/tabs/projects');
      await this.ui.say('تم حفظ المشروع وظهر في «مشاريعي»', 'Project saved and added to My projects');
    } finally {
      this.busy.set(false);
    }
  }
}
