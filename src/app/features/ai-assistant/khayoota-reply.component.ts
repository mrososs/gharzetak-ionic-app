import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { resolveActions, type ActionLookup, type ResolvedAction } from '../../core/ai/action-registry';
import type { PatternPreview } from '../../core/ai/transcript-draft';
import { TERMS, TERM_AR_NAME } from '../../core/data/catalog';
import { instanceLabel, siblingsOf } from '../../core/domain/collections';
import { I18nService } from '../../core/i18n/i18n.service';
import type { ChatMessage, Project } from '../../core/models/models';
import { AppStore } from '../../core/state/app.store';
import { IconComponent } from '../../shared/ui/icon/icon.component';

/**
 * The structured parts of one Khayoota reply, rendered ONLY with existing primitives (.gz-note, .gz-card, .gz-chip, .gz-btn*).
 * Model text is plain interpolation (never innerHTML). Actions are re-resolved against the local store on every render, and
 * the page re-resolves again on tap.
 */
@Component({
  selector: 'gz-khayoota-reply',
  imports: [IconComponent],
  template: `
    @let m = msg();
    @if (m.observations?.length || m.hypotheses?.length || m.cannotConfirm?.length) {
      <div class="gz-card kh-parts" role="group" [attr.aria-label]="i18n.q('تحليل الصورة', 'Photo analysis')">
        @if (m.observations?.length) {
          <div class="gz-note sage"><div><b>{{ i18n.q('اللي شايفاه', 'What I can see') }}</b><ul>@for (x of m.observations; track $index) {<li>{{ x }}</li>}</ul></div></div>
        }
        @if (m.hypotheses?.length) {
          <div class="gz-note lav"><div><b>{{ i18n.q('ممكن يكون السبب', 'Possible causes') }}</b><ul>@for (x of m.hypotheses; track $index) {<li>{{ x }}</li>}</ul></div></div>
        }
        @if (m.cannotConfirm?.length) {
          <div class="gz-note"><div><b>{{ i18n.q('اللي مقدرش أأكده من الصورة', 'What I can’t confirm from the photo') }}</b><ul>@for (x of m.cannotConfirm; track $index) {<li>{{ x }}</li>}</ul></div></div>
        }
      </div>
    }
    @if (m.citations?.length) {
      <div class="flex flex-wrap gap-1.5">
        @for (c of m.citations; track $index) {
          <span class="gz-chip sm gz-ltr">R{{ c.roundN }}@if (c.partName) { · {{ c.partName }} }</span>
        }
      </div>
    }
    @if (actions().length) {
      <div class="flex flex-wrap gap-2">
        @for (a of actions(); track $index) {
          <button type="button" class="gz-btn2" style="min-height: 44px; font-size: 14px" (click)="tap(a)">
            <svg [gzIcon]="a.kind === 'learn.explainStitch' ? 'book' : 'counter'" size="s" />{{ label(a) }}
          </button>
        }
      </div>
    }
    @if (card(); as k) {
      <div class="gz-card soft kh-stitch">
        <div class="flex items-center gap-2"><span class="gz-badge pur gz-ltr">{{ k.us }}</span><b>{{ i18n.isAr() ? k.arName : k.usN }}</b><span class="gz-xs gz-mute gz-ltr">UK: {{ k.uk }}</span></div>
        <p class="gz-sm" style="margin: 8px 0 0">{{ i18n.isAr() ? k.ar : k.en }}</p>
        <p class="gz-xs gz-mute gz-ltr" style="margin: 6px 0 0">{{ k.ex }}</p>
        @if (card()?.topic) {
          <button type="button" class="gz-btn3 mt-2" style="min-height: 40px; font-size: 13px" (click)="watch.emit(card()!.topic!)"><svg gzIcon="film" size="s" />{{ i18n.q('شوفي الشرح', 'Watch the tutorial') }}</button>
        }
      </div>
    }
    @if (preview(); as pv) {
      <div class="gz-card focus kh-preview">
        <div class="flex items-center gap-2"><svg gzIcon="notes" /><b class="flex-1 truncate">{{ pv.title || i18n.q('باترون من الصورة', 'Pattern from the photo') }}</b></div>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <span class="gz-badge sage">✓ {{ pv.counts.validated }} {{ i18n.q('مراجعة تمام', 'checked') }}</span>
          @if (pv.counts.needsReview) { <span class="gz-badge peach">⚠ {{ pv.counts.needsReview }} {{ i18n.q('محتاج مراجعة', 'need review') }}</span> }
          @if (pv.counts.unsupported) { <span class="gz-badge rose">✕ {{ pv.counts.unsupported }} {{ i18n.q('مش مدعوم', 'unsupported') }}</span> }
        </div>
        @for (p of pv.parts; track $index) {
          @if (pv.parts.length > 1) { <div class="gz-xs gz-b mt-2">{{ p.name }} × {{ p.quantity }}</div> }
          <ul class="kh-rounds">
            @for (r of p.rounds; track $index) {
              <li [class]="r.status"><span class="gz-code">{{ r.normalized }}</span>@if (r.status !== 'validated') { <span class="gz-xs"> — {{ reason(r.codes) }}</span> }</li>
            }
          </ul>
        }
        <p class="gz-xs gz-mute" style="margin: 8px 0 0">{{ i18n.q('خيوطة قرت الصورة؛ الحساب من آلة غرزتك. مفيش حاجة هتتحفظ غير لما تدوسي حفظ.', 'Khayoota read the photo; the arithmetic is Gharzetak’s parser. Nothing is saved until you press Save.') }}</p>
        <div class="mt-2 flex flex-wrap gap-2">
          <button type="button" class="gz-btn" style="min-height: 44px" (click)="addDraft.emit(pv)"><svg gzIcon="plus" size="s" />{{ i18n.q('إضافة لغرزتك', 'Add to Gharzetak') }}</button>
          <button type="button" class="gz-btn-text" (click)="dismissPreview.emit()">{{ i18n.q('إلغاء', 'Cancel') }}</button>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host { display: flex; flex-direction: column; gap: 8px; max-width: 92%; }
      .kh-parts { display: flex; flex-direction: column; gap: 8px; padding: 10px; }
      .kh-parts ul { margin: 4px 0 0; padding-inline-start: 18px; }
      .kh-rounds { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow: auto; }
      .kh-rounds li { padding: 4px 8px; border-radius: 10px; background: var(--gz-mint-200); }
      .kh-rounds li.needs-review { background: var(--gz-warning-bg); }
      .kh-rounds li.unsupported { background: var(--gz-error-bg); }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KhayootaReplyComponent {
  protected readonly i18n = inject(I18nService);
  private readonly store = inject(AppStore);

  readonly msg = input.required<ChatMessage>();
  readonly preview = input<PatternPreview | null>(null);
  readonly act = output<ResolvedAction>();
  readonly watch = output<string>();
  readonly addDraft = output<PatternPreview>();
  readonly dismissPreview = output<void>();

  private readonly shownStitch = signal<{ stitch: string; topic: string | null } | null>(null);

  readonly lookup: ActionLookup = {
    project: (id) => this.store.project(id) ?? null,
    partLabel: (p: Project, instanceId: string) => {
      const inst = (p.parts ?? []).find((i) => i.id === instanceId && !i.retired);
      if (!inst) return null;
      return instanceLabel(inst, (p.partSnapshots ?? []).find((s) => s.partId === inst.partId), siblingsOf(p.parts ?? [], inst));
    },
  };

  protected readonly actions = computed(() => resolveActions(this.msg().actions, this.lookup));

  protected readonly card = computed(() => {
    const s = this.shownStitch();
    if (!s) return null;
    const t = TERMS.find((x) => x.k === s.stitch);
    return t ? { ...t, arName: TERM_AR_NAME[t.k] ?? t.usN, topic: s.topic } : null;
  });

  protected label(a: ResolvedAction): string {
    const q = (ar: string, en: string) => this.i18n.q(ar, en);
    if (a.kind === 'learn.explainStitch') {
      const t = TERMS.find((x) => x.k === a.stitch);
      return q(`اشرحي ${TERM_AR_NAME[a.stitch] ?? a.stitch}`, `Explain ${t?.usN ?? a.stitch}`);
    }
    if (a.kind === 'project.openPart') return q(`افتحي: ${a.partLabel}`, `Open: ${a.partLabel}`);
    return a.partLabel ? q(`افتحي العداد · ${a.partLabel}`, `Open the counter · ${a.partLabel}`) : q('افتحي العداد على دورك', 'Open the counter at your round');
  }

  protected tap(a: ResolvedAction): void {
    if (a.kind === 'learn.explainStitch') {
      const cur = this.shownStitch();
      this.shownStitch.set(cur?.stitch === a.stitch ? null : { stitch: a.stitch, topic: a.topic });
      return;
    }
    this.act.emit(a);
  }

  protected reason(codes: readonly string[]): string {
    const q = (ar: string, en: string) => this.i18n.q(ar, en);
    if (codes.includes('ai-unreadable')) return q('مش مقروء', 'unreadable');
    if (codes.includes('ai-uncertain')) return q('خيوطة مش متأكدة من القراءة', 'Khayoota was unsure reading it');
    if (codes.includes('total-mismatch')) return q('المجموع المكتوب مش مطابق', 'written total does not match');
    if (codes.includes('chain')) return q('مش ماشي مع الدور اللي قبله', 'does not follow the previous round');
    if (codes.includes('joins')) return q('تجميع مع قطعة تانية', 'joins another piece');
    if (codes.includes('ambiguous')) return q('كلمة «حشو» محتاجة تأكيد', '"حشو" needs confirming');
    if (codes.includes('ai-no-checksum')) return q('مفيش مجموع مكتوب للتأكد', 'no written total to check against');
    if (codes.includes('ai-chart')) return q('مقروء من رسمة', 'read from a chart');
    if (codes.includes('assumed-sc')) return q('نوع الغرزة مش مكتوب', 'stitch type not written');
    return q('مش مدعوم في العداد لسه', 'not supported by the counter yet');
  }
}
