import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { ACTN } from '../data/catalog';
import { ParsedRound, STITCH_IO, StitchKind, parsePattern } from '../domain/pattern-parser';
import { convertToken, displayInTerms } from '../domain/terminology';
import { patternContext } from '../domain/tracker-engine';
import { I18nService } from '../i18n/i18n.service';
import { Pattern, Project } from '../models/models';
import { AppStore } from '../state/app.store';
import { ApiClient } from '../api/api.client';

export interface AssistantReply {
  text: string;
  /** true = produced by the local deterministic rule set (always labelled in the UI). */
  demo: boolean;
}

/**
 * AI assistant boundary.
 *  - Default: a clearly labelled DEMO mode — deterministic replies built from the user's own
 *    project data (port of the prototype's rule set). Stitch arithmetic is never delegated to a model.
 *  - Future: set GZ_AI_ENDPOINT to a Worker API path (e.g. /v1/assistant — not implemented yet). Only the
 *    question and a small, explicit project context are sent — never credentials or unrestricted DB access.
 */
@Injectable({ providedIn: 'root' })
export class AssistantService {
  private readonly i18n = inject(I18nService);
  private readonly store = inject(AppStore);
  private readonly api = inject(ApiClient);

  readonly connected = !!environment.aiEndpoint && this.api.configured;

  async ask(question: string, hasImage = false): Promise<AssistantReply> {
    if (this.connected) {
      try {
        const data = await this.api.post<{ text?: string }>(environment.aiEndpoint, { question, lang: this.i18n.lang(), context: this.context() });
        if (data?.text) return { text: data.text, demo: false };
      } catch {
        /* fall back to demo rules */
      }
    }
    if (hasImage && !question.trim()) {
      return {
        demo: true,
        text: this.q(
          'وصلتني الصورة — بس تحليل الصور مش متصل في النسخة التجريبية دي، فمقدرش أحكم على الشغل منها. قوليلي مشكلتك بالكلام (مثلًا: «ليه شغلي طالع معوج؟») وهساعدك.',
          'Got your photo — but image analysis is not connected in this demo, so I cannot judge the work from it. Describe the problem in words (e.g. "why is my work crooked?") and I will help.',
        ),
      };
    }
    return { text: this.demoReply(question), demo: true };
  }

  /** Minimal context for a future server-side model. */
  private context() {
    const p = this.store.currentProject();
    if (!p) return null;
    const c = this.ctx(p);
    return { project: p.name, mode: p.tracker.mode, round: c ? c.round.raw : `round ${p.tracker.simple.round}, ${p.tracker.simple.count}/${p.tracker.simple.target}` };
  }

  private q(a: string, e: string): string {
    return this.i18n.q(a, e);
  }

  private ctx(p: Project): { pat: Pattern; round: ParsedRound } | null {
    if (p.tracker.mode !== 'pattern') return null;
    const pat = this.store.pattern(p.tracker.patternId);
    if (!pat) return null;
    const c = patternContext(parsePattern(pat.text), p.tracker.cursor);
    return c ? { pat, round: c.round } : null;
  }

  private code(r: ParsedRound, pat: Pattern): string {
    return displayInTerms(r.raw, pat.terms, this.store.viewTerms());
  }

  private actLabel(k: StitchKind, pat: Pattern | null): string {
    return ACTN[k][this.i18n.lang()] + ' (' + convertToken(k, pat?.terms ?? 'us', this.store.viewTerms()) + ')';
  }

  explainRound(r: ParsedRound | undefined, pat: Pattern | null): string {
    if (!r || !r.ok)
      return this.q('الصيغة دي مش مدعومة في القارئ، فمقدرش أحسب الغرز. جرّبي الصيغة: (2sc, inc) × 6 [24].', 'This syntax is not supported by the reader, so I cannot compute the stitches. Try: (2sc, inc) × 6 [24].');
    const counts: Partial<Record<StitchKind, number>> = {};
    r.unit.forEach((u) => (counts[u.k] = (counts[u.k] ?? 0) + 1));
    const desc = (Object.keys(counts) as StitchKind[]).map((k) => (counts[k]! > 1 ? counts[k] + ' × ' : '') + this.actLabel(k, pat)).join(' + ');
    const mr = r.unit.some((u) => u.mr);
    const uc = r.unit.reduce((a, u) => a + (u.mr ? 0 : STITCH_IO[u.k][0]), 0);
    const up = r.unit.reduce((a, u) => a + STITCH_IO[u.k][1], 0);
    const l1 = r.reps > 1 ? this.q(`كرري ${r.reps} مرات: ${desc}.`, `Repeat ${r.reps} times: ${desc}.`) : this.q(`اعملي: ${desc}.`, `Work: ${desc}.`);
    const l2 = mr
      ? this.q('الغرز كلها بتتعمل جوّه الحلقة السحرية (MR)، فمفيش غرز من دور قبلها.', 'All stitches go into the magic ring (MR), so nothing is taken from a previous round.')
      : this.q(`كل تكرار بياخد ${uc} غرز من الدور اللي قبله وبيطلّع ${up}.`, `Each repeat takes ${uc} stitch(es) from the previous round and produces ${up}.`);
    const chk = r.declared === null ? '' : r.mismatch ? this.q(` — الباترن مكتوب [${r.declared}] لكن الحساب ${r.prod} ⚠`, ` — the pattern says [${r.declared}] but the maths gives ${r.prod} ⚠`) : ' ✓';
    const l3 = this.q(`الإجمالي: ${r.cons} ← ${r.prod} غرزة${chk}.`, `Total: ${r.cons} → ${r.prod} stitches${chk}.`);
    return `${l1}\n${l2}\n${l3}`;
  }

  explainCurrent(): string {
    const p = this.store.currentProject();
    if (!p) return this.q('مفيش مشروع نشط لسه. اعملي مشروع جديد وأنا أشرحلك دوره.', 'There is no active project yet. Create one and I will explain its rounds.');
    const c = this.ctx(p);
    if (c)
      return this.q(`مشروع «${p.name}»، الدور ${c.round.n}:\n${this.code(c.round, c.pat)}\n\n`, `Project "${p.name}", round ${c.round.n}:\n${this.code(c.round, c.pat)}\n\n`) + this.explainRound(c.round, c.pat);
    const t = p.tracker.simple;
    return this.q(
      `مشروع «${p.name}»: إنتي في الدور ${t.round}، الهدف ${t.target} غرزة وبتعدّي ${t.perTap} مع كل ضغطة. عندك دلوقتي ${t.count} وفاضل ${t.target - t.count}.\n\nنصيحة: حطّي علامة غرز في أول الدور علشان تعرفي إنك رجعتي لنفس النقطة.`,
      `Project "${p.name}": you are in round ${t.round}, target ${t.target} stitches, counting ${t.perTap} per tap. You have ${t.count} now with ${t.target - t.count} to go.\n\nTip: put a stitch marker at the start of the round so you know when you are back at the same spot.`,
    );
  }

  demoReply(text: string): string {
    const ql = text.toLowerCase();
    const has = (...ks: string[]) => ks.some((k) => ql.includes(k));
    const p = this.store.currentProject();
    const c = p ? this.ctx(p) : null;
    const ord: Record<string, number> = { 'الأول': 1, 'الاول': 1, 'الثاني': 2, 'التاني': 2, 'الثالث': 3, 'التالت': 3, 'الرابع': 4, 'الخامس': 5, 'السادس': 6, 'السابع': 7, 'الثامن': 8, 'التاسع': 9, 'العاشر': 10 };
    let n = 0;
    const dm = ql.match(/(\d+)/);
    if (dm) n = parseInt(dm[1], 10);
    for (const k of Object.keys(ord)) if (ql.includes(k)) n = ord[k];

    if ((has('الدور', 'round', 'rnd') && n > 0) || has('اشرحلي الدور', 'explain round')) {
      let pat = c?.pat ?? this.store.patterns()[0] ?? null;
      if (!pat) return this.explainCurrent();
      let r = parsePattern(pat.text).rounds.find((x) => x.n === n);
      if (!r) {
        pat = this.store.patterns()[0];
        r = parsePattern(pat.text).rounds.find((x) => x.n === n);
      }
      const name = this.store.patternName(pat);
      if (!r) return this.q(`مش لاقية دور رقم ${n} في «${name}» (فيه ${parsePattern(pat.text).rounds.length} أدوار).`, `I cannot find round ${n} in "${name}" (it has ${parsePattern(pat.text).rounds.length} rounds).`);
      return this.q(`«${name}» — الدور ${n}:\n${this.code(r, pat)}\n\n`, `"${name}" — round ${n}:\n${this.code(r, pat)}\n\n`) + this.explainRound(r, pat);
    }
    if (has('حشو', 'stuff'))
      return this.q(
        'الحشو مش غرزة — هو خطوة بتتعمل قبل ما تقفلي الشكل:\n• ابدئي الحشو لما يتبقى حوالي 3 أدوار على القفل.\n• احشي على دفعات صغيرة وادفعيها لأطراف الشكل الأول.\n• لو شايفة فتحات بين الغرز، استخدمي إبرة أصغر أو شدّي الخيط أكتر.\n• بعد الحشو كمّلي التنقيص (dec) لحد ما يتقفل.',
        'Stuffing is not a stitch — it is a step before closing the shape:\n• Start stuffing when about 3 rounds remain.\n• Add small handfuls and push them into the extremities first.\n• If gaps show between stitches, use a smaller hook or tighten your tension.\n• Then finish the decreases (dec) until it closes.',
      );
    if (has('زيادة', 'تنقيص', 'الفرق', 'increase', 'decrease', 'inc', 'dec')) {
      const extra =
        c && c.round.acts.some((a) => a.k === 'inc' || a.k === 'dec')
          ? this.q(`\n\nفي الدور الحالي (R${c.round.n}) عندك: ${this.code(c.round, c.pat)} — ${c.round.cons} ← ${c.round.prod} غرزة.`, `\n\nYour current round (R${c.round.n}) is ${this.code(c.round, c.pat)} — ${c.round.cons} → ${c.round.prod} stitches.`)
          : '';
      return (
        this.q(
          'الزيادة (inc): غرزتين في نفس الغرزة — بتاخدي 1 وبتطلّعي 2، فالشكل بيوسّع.\nالتنقيص (dec): ضم غرزتين مع بعض — بتاخدي 2 وبتطلّعي 1، فالشكل بيضيق.\nالغرزة العادية (sc): بتاخدي 1 وبتطلّعي 1.',
          'Increase (inc): two stitches in the same stitch — consumes 1, produces 2, so the shape widens.\nDecrease (dec): join two stitches together — consumes 2, produces 1, so the shape narrows.\nA plain stitch (sc): consumes 1, produces 1.',
        ) + extra
      );
    }
    if (has('معوج', 'مايل', 'crooked', 'wonky', 'twist', 'uneven', 'slant'))
      return this.q(
        'أسباب الشغل المعوج الشائعة:\n• الزيادات بتتحط دايمًا في نفس المكان — بدّلي أماكنها بين الأدوار.\n• ناسية تحسبي أول غرزة في الدور أو بتعدّي غرزة بالغلط.\n• الشدّ مش ثابت — جرّبي تمسكي الخيط بنفس الطريقة.\n• من غير علامة غرز بتفقدي بداية الدور. استخدمي علامة وعدّي كل دور.\nتحليل الصور مش متصل في الوضع التجريبي.',
        'Common reasons work comes out crooked:\n• Increases always land in the same spot — stagger them between rounds.\n• Missing the first stitch of a round or skipping one by mistake.\n• Inconsistent tension — hold the yarn the same way each time.\n• Without a stitch marker you lose the round start. Use one and count every round.\nPhoto analysis is not connected in demo mode.',
      );
    if (has('عدد', 'صح', 'count', 'correct', 'right number'))
      return this.q(
        'علشان تتأكدي إن عدد الغرز صح:\n• قارني عدد الغرز في آخر الدور بالرقم بين [ ] في الباترن.\n• استخدمي علامات غرز كل 6 أو 10 غرز.\n• استخدمي العداد هنا — بيحسب الناتج (output) لكل زيادة وتنقيص.\n• لو العدد غلط، فكّي لآخر علامة وارجعي منها.' + (c ? `\n\nدلوقتي في R${c.round.n} المفروض ينتهي الدور بـ ${c.round.prod} غرزة.` : ''),
        'To check your stitch count:\n• Compare the stitches at the end of the round with the number in [ ] in the pattern.\n• Place stitch markers every 6 or 10 stitches.\n• Use the counter here — it counts the output of every increase and decrease.\n• If the count is off, unravel to your last marker and redo.' + (c ? `\n\nIn R${c.round.n} the round should end with ${c.round.prod} stitches.` : ''),
      );
    return this.q(
      'سؤال حلو! في الوضع التجريبي بجاوب على: الزيادة والتنقيص، الحشو، الشغل المعوج، التأكد من عدد الغرز، وشرح أي دور (جرّبي «اشرحلي الدور الخامس»). ' + (p ? `ومشروعك الحالي «${p.name}» بيتم استخدامه في الشرح.` : ''),
      'Good question! Demo mode answers: increase vs decrease, stuffing, crooked work, checking your stitch count, and explaining any round (try "explain round 5"). ' + (p ? `Your current project "${p.name}" is used in explanations.` : ''),
    );
  }
}
