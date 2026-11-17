import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IonContent, IonHeader, NavController } from '@ionic/angular';
import { ConvMessage, ConvPart, ConvStatus, ConversionResult, convertPartText, convertPatternText, normalizedDocument } from '../../core/domain/smart-parser';
import { I18nService } from '../../core/i18n/i18n.service';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { StepperComponent } from '../../shared/ui/inputs/stepper.component';
import { DraftPart, ImportDraftService } from './import-draft.service';

interface EditablePart {
  readonly name: string;
  readonly quantity: number;
  readonly assemblyNotes: string;
  readonly conv: ConvPart;
  /** The user changed the quantity (or it was explicit), so the "please confirm" tag is gone. */
  readonly confirmed: boolean;
  /** The normalized text as currently edited (re-checked on blur). */
  readonly text: string;
}

type View = 'preview' | 'original' | 'normalized';
type TermsChoice = 'auto' | 'us' | 'uk';

const PLACEHOLDER = `الايد:
R1: 6 sc in magic ring (6)
R2: inc x 6 (12)
R3: (sc + inc) * 6 (18)
R4 >> R7 (18)

الجسم:
R1: 6sc in MR [6]
R7: 5sc in body + 5sc in legs + 14sc in body + 5sc in legs + 7sc in body (36)`;

/**
 * Smart Import — paste free-form Arabic / English crochet text, review the deterministic conversion, correct it, confirm.
 * No AI, no network. The user always sees: detected collection + parts, original vs normalized text, expected vs calculated
 * stitch counts, warnings and unsupported lines, and nothing is saved until they confirm.
 */
@Component({
  selector: 'gz-smart-import',
  imports: [IonHeader, IonContent, IconComponent, StepperComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top">
        <button type="button" class="gz-icb" (click)="back()" [attr.aria-label]="t().back"><svg gzIcon="arrowl" [flip]="true" /></button>
        <h1 class="gz-ttl gz-hd">{{ i18n.q('لصق باترن ذكي', 'Smart paste') }}</h1>
        <span style="width: 46px"></span>
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      <div class="gz-pad">
        <div class="gz-note lav" style="margin: 4px 0 12px"><svg gzIcon="info" size="s" /><span>{{ i18n.q('الصقي الباترن بالعربي أو الإنجليزي وهنحوّله لصيغة العدّاد. التحويل بقواعد ثابتة بدون ذكاء اصطناعي، ولازم تراجعيه وتأكديه قبل الحفظ.', 'Paste a pattern in Arabic or English and it is converted to the counter notation. Rule-based (no AI): you review and confirm it before anything is saved.') }}</span></div>

        <label class="gz-lbl" for="si-text">{{ i18n.q('نص الباترن', 'Pattern text') }}</label>
        <textarea id="si-text" class="gz-ta" style="min-height: 170px" dir="auto" [value]="text()" (input)="onText($event)" [placeholder]="placeholder" maxlength="40000" [attr.aria-describedby]="'si-hint'"></textarea>
        <div id="si-hint" class="gz-field-hint">{{ text().length }} / 40000</div>

        <span class="gz-lbl">{{ i18n.q('نظام المصطلحات في النص', 'Terminology of the text') }}</span>
        <div class="gz-seg" role="radiogroup">
          @for (o of termsOptions(); track o.id) {
            <button type="button" role="radio" [attr.aria-checked]="terms() === o.id" [class.on]="terms() === o.id" (click)="setTerms(o.id)" style="font-size: 13px">{{ o.label }}</button>
          }
        </div>

        <button type="button" class="gz-btn mt-3" [disabled]="!text().trim()" (click)="convert()"><svg gzIcon="convert" />{{ i18n.q('حوّلي', 'Convert') }}</button>

        @if (result(); as r) {
          <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ i18n.q('نتيجة التحويل', 'Conversion preview') }}</h2></div>

          <div class="gz-chips" role="status" aria-live="polite">
            <span class="gz-badge sage">{{ i18n.q('تم التحقق', 'Validated') }}: <span class="gz-ltr">{{ counts().validated }}</span></span>
            <span class="gz-badge peach">{{ i18n.q('يحتاج مراجعة', 'Needs review') }}: <span class="gz-ltr">{{ counts().review }}</span></span>
            <span class="gz-badge rose">{{ i18n.q('غير مدعوم', 'Unsupported') }}: <span class="gz-ltr">{{ counts().unsupported }}</span></span>
          </div>
          @for (m of r.messages; track m.code) {
            <div class="gz-note mt-2" [class.rose]="m.level === 'error'"><span>{{ msg(m) }}</span></div>
          }

          @if (r.collectionName) {
            <div class="gz-note lav mt-2"><svg gzIcon="folder" size="s" /><span>{{ i18n.q('اسم التصميم المكتشف: ', 'Detected design name: ') }}<b>{{ r.collectionName }}</b></span></div>
          }
          @if (target() === 'pattern' && parts().length > 1) {
            <div class="gz-note peach mt-2"><svg gzIcon="info" size="s" /><span>{{ i18n.q('لقينا ' + parts().length + ' أجزاء — الأفضل تحفظيه كباترون كامل بأجزاء.', 'Found ' + parts().length + ' parts — better saved as a multi-part pattern.') }}</span></div>
            <button type="button" class="gz-btn3 w mt-2" (click)="target.set('collection')">{{ i18n.q('احفظيه كباترون كامل بأجزاء', 'Save as a multi-part pattern') }}</button>
          }

          <div class="gz-seg mt-3" role="tablist">
            @for (v of views(); track v.id) {
              <button type="button" role="tab" [attr.aria-selected]="view() === v.id" [class.on]="view() === v.id" (click)="view.set(v.id)" style="font-size: 13px">{{ v.label }}</button>
            }
          </div>

          @switch (view()) {
            @case ('original') {
              <pre class="gz-code gz-ltr mt-2" dir="auto" style="white-space: pre-wrap; overflow-wrap: anywhere">{{ r.original }}</pre>
            }
            @case ('normalized') {
              <pre class="gz-code gz-ltr mt-2" dir="ltr" style="white-space: pre-wrap; overflow-wrap: anywhere">{{ normalizedAll() }}</pre>
            }
            @default {
              @for (p of parts(); track $index; let i = $index) {
                <section class="gz-rcard mt-3" [attr.aria-label]="p.name">
                  <div class="flex items-center gap-2">
                    <span class="gz-badge {{ cls(p.conv.status) }}">{{ label(p.conv.status) }}</span>
                    <span class="gz-xs gz-mute gz-ltr ms-auto">{{ p.conv.calculatedTotal }} {{ i18n.q('غرزة', 'sts') }}</span>
                  </div>
                  <label class="gz-lbl" [for]="'si-name-' + i">{{ i18n.q('اسم الجزء', 'Part name') }}</label>
                  <div class="gz-in"><input [id]="'si-name-' + i" type="text" maxlength="80" [value]="p.name" (input)="onName(i, $event)" /></div>
                  <div class="mt-3 flex items-center justify-between gap-2">
                    <div class="flex min-w-0 flex-col">
                      <span class="gz-b">{{ i18n.q('العدد المطلوب', 'Quantity') }}</span>
                      @if (!p.confirmed && p.conv.quantityToConfirm) {
                        <span class="gz-xs" style="color: var(--gz-warning)">{{ i18n.q('اقتراح — أكّدي العدد', 'Suggested — please confirm') }}</span>
                      }
                    </div>
                    <gz-stepper [display]="p.quantity" [label]="i18n.q('العدد', 'Quantity')" (dec)="setQty(i, p.quantity - 1)" (inc)="setQty(i, p.quantity + 1)" />
                  </div>

                  <label class="gz-lbl" [for]="'si-text-' + i">{{ i18n.q('التعليمات بعد التحويل (قابلة للتعديل)', 'Converted instructions (editable)') }}</label>
                  <textarea [id]="'si-text-' + i" class="gz-ta gz-ltr" dir="ltr" style="min-height: 110px" [value]="p.text" (change)="onPartText(i, $event)"></textarea>
                  <div class="gz-field-hint">{{ i18n.q('عدّلي أي سطر ثم اضغطي خارج الحقل لإعادة الفحص.', 'Edit any line, then tap outside the field to re-check it.') }}</div>

                  <div class="mt-2 flex flex-col gap-1.5">
                    @for (rd of p.conv.rounds; track $index) {
                      <div class="gz-card soft" style="padding: 8px 10px">
                        <div class="flex items-center gap-2">
                          <span class="gz-badge {{ cls(rd.status) }}">{{ label(rd.status) }}</span>
                          <span class="gz-b gz-ltr">R{{ rd.n }}</span>
                          <span class="gz-xs gz-mute gz-ltr ms-auto">{{ i18n.q('المحسوب', 'calc') }} {{ rd.calculated ?? '—' }} · {{ i18n.q('المكتوب', 'written') }} {{ rd.expected ?? '—' }}</span>
                        </div>
                        <div class="gz-code gz-ltr" dir="ltr" style="font-size: 14px; overflow-wrap: anywhere">{{ rd.normalized }}</div>
                        @if (rd.original.trim() !== rd.normalized.trim()) {
                          <div class="gz-xs gz-mute" dir="auto" style="overflow-wrap: anywhere">{{ i18n.q('الأصل: ', 'Original: ') }}{{ rd.original }}</div>
                        }
                        @for (m of rd.messages; track m.code) {
                          @if (m.level !== 'info') {
                            <div class="gz-xs" [style.color]="m.level === 'error' ? 'var(--gz-error)' : 'var(--gz-warning)'">{{ msg(m) }}</div>
                          }
                        }
                      </div>
                    }
                  </div>

                  <label class="gz-lbl" [for]="'si-notes-' + i">{{ i18n.q('ملاحظات التجميع والتشطيب', 'Assembly & finishing notes') }}</label>
                  <textarea [id]="'si-notes-' + i" class="gz-ta" style="min-height: 70px" dir="auto" [value]="p.assemblyNotes" (input)="onNotes(i, $event)" maxlength="4000"></textarea>
                </section>
              }
            }
          }

          @if (result()!.counts.rounds === 0) {
            <div class="gz-note rose mt-3" role="alert"><span>{{ i18n.q('مفيش أدوار اتعرفت — جرّبي صيغة مثل R1: 6sc [6].', 'No rounds were recognised — try a form like R1: 6sc [6].') }}</span></div>
          }

          <div style="height: 14px"></div>
          <button type="button" class="gz-btn" [disabled]="!canConfirm()" (click)="confirm()"><svg gzIcon="check" />{{ i18n.q('تأكيد واستخدام التحويل', 'Confirm and use this conversion') }}</button>
          <div class="gz-field-hint" style="text-align: center">{{ i18n.q('النص الأصلي بيتحفظ مع الباترون ويمكن استرجاعه.', 'The original text is kept with the pattern and can be recovered.') }}</div>
        }
      </div>
    </ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SmartImportPage {
  protected readonly i18n = inject(I18nService);
  protected readonly nav = inject(NavController);
  private readonly route = inject(ActivatedRoute);
  private readonly drafts = inject(ImportDraftService);
  private readonly ui = inject(UiFeedback);
  protected readonly t = this.i18n.t;
  protected readonly placeholder = PLACEHOLDER;

  protected readonly target = signal<'collection' | 'pattern'>(this.route.snapshot.queryParamMap.get('target') === 'pattern' ? 'pattern' : 'collection');
  protected readonly text = signal('');
  protected readonly terms = signal<TermsChoice>('auto');
  protected readonly result = signal<ConversionResult | null>(null);
  protected readonly parts = signal<EditablePart[]>([]);
  protected readonly view = signal<View>('preview');

  protected readonly termsOptions = computed<{ id: TermsChoice; label: string }[]>(() => [
    { id: 'auto', label: this.i18n.q('تلقائي', 'Auto') },
    { id: 'us', label: this.t().us },
    { id: 'uk', label: this.t().uk },
  ]);
  protected readonly views = computed<{ id: View; label: string }[]>(() => [
    { id: 'preview', label: this.i18n.q('الأجزاء', 'Parts') },
    { id: 'original', label: this.i18n.q('النص الأصلي', 'Original') },
    { id: 'normalized', label: this.i18n.q('النص المعياري', 'Normalized') },
  ]);
  protected readonly counts = computed(() => {
    const rounds = this.parts().flatMap((p) => p.conv.rounds);
    return {
      validated: rounds.filter((r) => r.status === 'validated').length,
      review: rounds.filter((r) => r.status === 'needs-review').length,
      unsupported: rounds.filter((r) => r.status === 'unsupported').length,
    };
  });
  protected readonly normalizedAll = computed(() => this.parts().map((p) => (this.parts().length === 1 && !p.name ? p.text : `${p.name}:\n${p.text}`)).join('\n\n') || (this.result() ? normalizedDocument(this.result()!) : ''));
  protected readonly canConfirm = computed(() => this.parts().length > 0 && this.parts().some((p) => p.conv.rounds.length > 0) && this.parts().every((p) => p.name.trim().length > 0));

  protected back(): void {
    void this.nav.back();
  }

  protected onText(ev: Event): void {
    this.text.set((ev.target as HTMLTextAreaElement).value);
  }
  protected setTerms(t: TermsChoice): void {
    this.terms.set(t);
  }

  protected convert(): void {
    const r = convertPatternText(this.text(), { terms: this.terms() });
    this.result.set(r);
    this.view.set('preview');
    this.parts.set(
      r.parts.map((p) => ({
        name: p.name,
        quantity: p.quantity,
        assemblyNotes: p.notes.join('\n'),
        conv: p,
        confirmed: !p.quantityToConfirm,
        text: p.text,
      })),
    );
  }

  private patch(i: number, fn: (p: EditablePart) => EditablePart): void {
    this.parts.update((l) => l.map((p, k) => (k === i ? fn(p) : p)));
  }

  protected onName(i: number, ev: Event): void {
    const name = (ev.target as HTMLInputElement).value;
    this.patch(i, (p) => ({ ...p, name }));
  }
  protected onNotes(i: number, ev: Event): void {
    const assemblyNotes = (ev.target as HTMLTextAreaElement).value;
    this.patch(i, (p) => ({ ...p, assemblyNotes }));
  }
  protected setQty(i: number, q: number): void {
    this.patch(i, (p) => ({ ...p, quantity: Math.max(1, Math.min(30, q)), confirmed: true }));
  }
  /** The user corrected a line: re-run the deterministic conversion for this part only. */
  protected onPartText(i: number, ev: Event): void {
    const text = (ev.target as HTMLTextAreaElement).value;
    this.patch(i, (p) => {
      const conv = convertPartText(text, p.name, { terms: this.result()?.detectedTerms ?? 'us' });
      return { ...p, text: conv.rounds.length ? conv.text : text, conv: conv.rounds.length ? { ...conv, name: p.name } : p.conv };
    });
  }

  protected async confirm(): Promise<void> {
    const parts = this.parts();
    const unsupported = this.counts().unsupported;
    if (unsupported > 0) {
      const ok = await this.ui.confirm(
        this.i18n.q('فيه أسطر غير مدعومة', 'Some lines are unsupported'),
        this.i18n.q(`${unsupported} سطر مش هيتعدّ تلقائيًا في العدّاد. هتتحفظ كما هي في الباترون. تكملي؟`, `${unsupported} line(s) will not be counted automatically by the counter. They are saved exactly as written. Continue?`),
        this.i18n.q('كمّلي وحفظ', 'Continue'),
        false,
      );
      if (!ok) return;
    }
    const draftParts: DraftPart[] = parts.map((p) => ({
      name: p.name.trim().slice(0, 80),
      quantity: p.quantity,
      text: p.text,
      assemblyNotes: p.assemblyNotes.trim(),
      status: p.conv.status as ConvStatus,
    }));
    this.drafts.offer({ target: this.target(), collectionName: this.result()?.collectionName ?? null, sourceText: this.text(), parts: draftParts });
    if (this.target() === 'collection' && this.route.snapshot.queryParamMap.get('target') === 'pattern') {
      // the user switched a multi-part paste into a collection: continue in the collection editor
      await this.nav.navigateForward('/tabs/home/collections/new', { replaceUrl: true });
      return;
    }
    await this.nav.back();
  }

  protected cls(s: ConvStatus): string {
    return s === 'validated' ? 'sage' : s === 'needs-review' ? 'peach' : 'rose';
  }
  protected label(s: ConvStatus): string {
    return s === 'validated' ? this.i18n.q('تم التحقق', 'Validated') : s === 'needs-review' ? this.i18n.q('يحتاج مراجعة', 'Needs review') : this.i18n.q('غير مدعوم', 'Unsupported');
  }
  protected msg(m: ConvMessage): string {
    return this.i18n.isAr() ? m.ar : m.en;
  }
}
