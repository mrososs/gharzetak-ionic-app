import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { IonContent, IonHeader, NavController } from '@ionic/angular';
import { ACTN } from '../../core/data/catalog';
import { IconName } from '../../core/data/icons';
import { PartInstance, instanceLabel, instanceProgress, nextUnfinished, projectCompletion, siblingsOf } from '../../core/domain/collections';
import { StitchKind, parsePattern } from '../../core/domain/pattern-parser';
import { TermSystem, convertToken, displayInTerms } from '../../core/domain/terminology';
import { compareTime, formatMinutes } from '../../core/domain/time';
import {
  CountMode,
  TrackerLike,
  patternContext,
  patternJump,
  patternReset,
  patternSetMode,
  patternStats,
  patternTap,
  patternUndo,
  simpleAllComplete,
  simpleNextAmount,
  simpleNextRound,
  simpleReset,
  simpleRoundComplete,
  simpleSetPerTap,
  simpleSetRound,
  simpleSetTarget,
  simpleSetTotalRounds,
  simpleTap,
  simpleUndo,
} from '../../core/domain/tracker-engine';
import { I18nService } from '../../core/i18n/i18n.service';
import { TrackerData } from '../../core/models/models';
import { TimerService } from '../../core/services/timer.service';
import { AppStore } from '../../core/state/app.store';
import { SheetComponent } from '../../shared/ui/dialogs/sheet.component';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { StepperComponent } from '../../shared/ui/inputs/stepper.component';
import { RingComponent } from '../../shared/ui/progress/ring.component';

/** Minimum gap between two counted taps — swallows accidental double-fires, not real fast counting. */
const TAP_GUARD_MS = 120;
const pad2 = (n: number) => (n < 10 ? '0' + n : '' + n);
const fmtHMS = (s: number) => Math.floor(s / 3600) + ':' + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60);

/** GZ-S14 simple · GZ-S15 pattern-aware · GZ-T03 round complete · GZ-T05 settings · GZ-T06 reset — and, for multi-part projects, the part switcher. */
@Component({
  selector: 'gz-tracker',
  imports: [IonHeader, IonContent, IconComponent, RingComponent, StepperComponent, SheetComponent],
  templateUrl: './tracker.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrackerPage {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(AppStore);
  protected readonly nav = inject(NavController);
  protected readonly timer = inject(TimerService);
  private readonly ui = inject(UiFeedback);

  protected readonly t = this.i18n.t;
  protected readonly sheet = signal<'picker' | 'cfg' | 'reset' | 'parts' | null>(null);
  protected readonly targetPresets = [12, 18, 24, 30, 36, 48];
  protected readonly perPresets = [1, 2, 3, 5, 6, 10];
  private lastTap = 0;

  protected readonly p = this.store.currentProject;
  /** What the counter follows: the project's own tracker, or the active part instance (Arm 1/2). */
  protected readonly view = computed(() => this.store.trackerView(this.p()));
  protected readonly tr = computed<TrackerLike | null>(() => this.view()?.tracker ?? null);
  protected readonly inst = computed<PartInstance | null>(() => this.view()?.instance ?? null);
  protected readonly isPattern = computed(() => this.tr()?.mode === 'pattern');

  /* ---------------- multi-part ---------------- */
  protected readonly completion = computed(() => {
    const p = this.p();
    return p?.parts?.length ? projectCompletion(p.parts, p.partSnapshots ?? []) : null;
  });
  protected readonly partRows = computed(() => {
    const p = this.p();
    const cur = this.inst();
    if (!p?.parts?.length) return [];
    return p.parts.map((i) => {
      const snap = (p.partSnapshots ?? []).find((s) => s.partId === i.partId);
      const pr = instanceProgress(i, snap);
      return {
        id: i.id,
        label: instanceLabel(i, snap, siblingsOf(p.parts ?? [], i)) + (i.retired ? ' ·' + this.i18n.q(' إضافية', ' extra') : ''),
        pct: Math.round(pr.fraction * 100),
        done: pr.done,
        active: i.id === cur?.id,
        time: this.timer.elapsedForInstance(p.id, i.id, i.workedSeconds),
      };
    });
  });
  protected readonly nextOpen = computed(() => {
    const p = this.p();
    return p?.parts?.length ? nextUnfinished(p.parts, p.partSnapshots ?? [], this.inst()?.id ?? null) : null;
  });
  protected readonly instTime = computed(() => {
    const p = this.p();
    const i = this.inst();
    return p && i ? fmtHMS(this.timer.elapsedForInstance(p.id, i.id, i.workedSeconds)) : '0:00:00';
  });

  /* ---------------- simple ---------------- */
  protected readonly sm = computed(() => {
    const t = this.tr();
    if (!t) return null;
    const s = t.simple;
    const done = simpleRoundComplete(s);
    const last = simpleAllComplete(s);
    const q = (a: string, e: string) => this.i18n.q(a, e);
    const lastRound = s.totalRounds > 0 && s.round >= s.totalRounds;
    return {
      s,
      done,
      last,
      frac: s.target ? s.count / s.target : 0,
      roundLabel: `${this.t().roundWord} ${s.round}${s.totalRounds ? ' / ' + s.totalRounds : ''}`,
      remaining: s.target - s.count,
      roundsText: Math.max(0, s.round - 1 + (done ? 1 : 0)) + (s.totalRounds ? '/' + s.totalRounds : ''),
      doneMsg: q(`اكتمل الدور ${s.round}!` + (lastRound ? ' خلّصتي كل الأدوار.' : ''), `Round ${s.round} complete!` + (lastRound ? ' All rounds finished.' : '')),
      btnLabel: done ? (last ? q('اكتملت كل الأدوار', 'All rounds complete') : q('ابدئي الدور ', 'Start round ') + (s.round + 1)) : '+' + simpleNextAmount(s),
      btnIcon: (done ? (last ? 'check' : 'arrow') : 'plus') as IconName,
      canFinish: last && this.canFinishProject(),
    };
  });

  /** A project is finished when its single tracker — or EVERY part — is complete. */
  private canFinishProject(): boolean {
    const p = this.p();
    if (!p || p.status === 'done') return false;
    if (p.parts?.length) return projectCompletion(p.parts, p.partSnapshots ?? []).doneCount >= p.parts.filter((i) => !i.retired).length;
    return true;
  }

  /* ---------------- pattern-aware ---------------- */
  protected readonly src = computed(() => this.view()?.source ?? null);
  protected readonly parsed = computed(() => {
    const s = this.src();
    return s ? parsePattern(s.text) : null;
  });
  protected readonly pt = computed(() => {
    const t = this.tr();
    const src = this.src();
    const parsed = this.parsed();
    if (!t || !src || !parsed) return null;
    const ctx = patternContext(parsed, t.cursor);
    const st = patternStats(parsed, t.cursor);
    if (!ctx || !st) return null;
    const q = (a: string, e: string) => this.i18n.q(a, e);
    const r = ctx.round;
    const len = r.acts.length;
    const ptr = ctx.ptr;
    const pd = st.roundComplete;
    const act = pd ? null : r.acts[ptr];
    const grp = pd ? r.acts.filter((a) => a.rep === r.reps - 1) : r.acts.filter((a) => a.rep === act!.rep);
    const gStart = pd ? len - grp.length : r.acts.findIndex((a) => a.rep === act!.rep);
    const nextRound = parsed.rounds[ctx.roundIndex + 1];
    let next: string;
    if (pd) next = ctx.isLastRound ? q('الباترن خلص', 'Pattern finished') : q('الدور ', 'Round ') + nextRound.n;
    else if (ptr + 1 < len) next = this.actLabel(r.acts[ptr + 1].k, src.terms);
    else next = ctx.isLastRound ? q('نهاية الباترن', 'End of pattern') : q('آخر خطوة — بعدها الدور ', 'Last step — then round ') + nextRound.n;
    const mode = t.cursor.mode;
    return {
      pat: { id: src.id, terms: src.terms },
      name: src.name,
      st,
      n: r.n,
      code: displayInTerms(r.raw, src.terms, this.store.viewTerms()),
      sumText: `${r.cons} → ${r.prod}` + (r.declared !== null ? `  [${r.declared}]` : ''),
      okText: r.mismatch ? `[${r.declared}] ≠ ${r.prod}` : r.declared !== null ? `[${r.declared}] ✓` : q('بدون مجموع', 'No total'),
      okCls: r.mismatch ? 'rose' : 'sage',
      joins: r.joins,
      rounds: parsed.rounds.map((x, i) => ({ n: x.n, i, cls: i === ctx.roundIndex ? 'cur' : i < ctx.roundIndex ? 'dn' : '' })),
      curLabel: act ? this.actLabel(act.k, src.terms) : '',
      curIO: act ? (act.mr ? '0 → 1 · MR' : act.ref ? `0 → ${act.prod} · ${act.ref}` : `${act.cons} → ${act.prod}`) : '',
      group: grp.map((a, i) => ({ label: this.abbr(a.k, src.terms), cls: gStart + i < ptr ? 'dn' : gStart + i === ptr ? 'cur' : '' })),
      next,
      doneMsg: ctx.isLastRound ? q('اكتمل الباترن كله!', 'The whole pattern is complete!') : q(`اكتمل الدور ${r.n}!`, `Round ${r.n} complete!`),
      mode,
      btnLabel: pd
        ? ctx.isLastRound
          ? q('اكتمل الباترن', 'Pattern complete')
          : q('ابدئي الدور ', 'Start round ') + nextRound.n
        : mode === 'action'
          ? this.actLabel(act!.k, src.terms)
          : mode === 'group'
            ? q('أنهيت التكرار ', 'Group done ') + st.currentGroup + '/' + st.totalGroups
            : q('أنهيت الدور ', 'Round done ') + r.n,
      btnIcon: (pd ? (ctx.isLastRound ? 'check' : 'arrow') : 'plus') as IconName,
      disabled: st.patternComplete,
      canFinish: st.patternComplete && this.canFinishProject(),
    };
  });
  protected readonly modes = computed(() => [
    { id: 'action' as CountMode, label: this.i18n.q('كل غرزة', 'Every stitch') },
    { id: 'group' as CountMode, label: this.i18n.q('كل تكرار', 'Every group') },
    { id: 'round' as CountMode, label: this.i18n.q('كل دور', 'Whole round') },
  ]);

  /* ---------------- time ---------------- */
  protected readonly timeText = computed(() => {
    const p = this.p();
    return p ? fmtHMS(this.timer.elapsedFor(p.id, p.workedSeconds)) : '0:00:00';
  });
  protected readonly timerState = computed(() => {
    const p = this.p();
    return p ? this.timer.stateFor(p.id) : 'idle';
  });
  protected readonly timerOn = computed(() => this.timerState() === 'running');
  protected readonly timerLabel = computed(() => {
    const s = this.timerState();
    return s === 'running' ? this.i18n.q('إيقاف مؤقت', 'Pause') : s === 'paused' ? this.i18n.q('استئناف', 'Resume') : this.i18n.q('بدء', 'Start');
  });
  protected readonly timeCmp = computed(() => {
    const p = this.p();
    return p ? compareTime(p.estimatedHours, this.timer.elapsedFor(p.id, p.workedSeconds)) : null;
  });
  protected readonly timeCmpText = computed(() => {
    const c = this.timeCmp();
    if (!c || c.state === 'none') return this.i18n.q('لم يتم تحديد وقت متوقع', 'No estimated time set');
    const lang = this.i18n.lang();
    return c.state === 'over'
      ? this.i18n.q('تجاوز الوقت المتوقع: ', 'Over the estimate by ') + formatMinutes(c.overMinutes, lang)
      : this.i18n.q('المتبقي تقديريًا: ', 'Estimated remaining: ') + formatMinutes(c.remainingMinutes, lang);
  });
  protected readonly pickItems = computed(() =>
    this.store
      .sortedProjects()
      .filter((x) => x.status !== 'done')
      .map((x) => ({ id: x.id, name: x.name, st: this.store.statusName(x.status), ...this.store.progress(x) })),
  );

  private actLabel(k: StitchKind, terms: TermSystem): string {
    return ACTN[k][this.i18n.lang()] + ' (' + this.abbr(k, terms) + ')';
  }
  private abbr(k: StitchKind, terms: TermSystem): string {
    return convertToken(k, terms, this.store.viewTerms());
  }

  private update(fn: (t: TrackerLike) => TrackerLike): void {
    const p = this.p();
    if (!p) return;
    const i = this.inst();
    if (i) void this.store.updatePartTracker(p.id, i.id, fn);
    else void this.store.updateTracker(p.id, fn as (t: TrackerData) => TrackerData);
  }

  /* ---------------- actions ---------------- */
  protected tap(): void {
    const now = performance.now();
    if (now - this.lastTap < TAP_GUARD_MS) return;
    this.lastTap = now;
    const t = this.tr();
    if (!t) return;
    if (t.mode === 'pattern') {
      const parsed = this.parsed();
      if (parsed) this.update((x) => ({ ...x, cursor: patternTap(parsed, x.cursor) }));
    } else {
      this.update((x) => ({ ...x, simple: simpleRoundComplete(x.simple) ? simpleNextRound(x.simple) : simpleTap(x.simple) }));
    }
  }

  protected undo(): void {
    const t = this.tr();
    if (!t) return;
    const empty = t.mode === 'pattern' ? !t.cursor.history.length : !t.simple.history.length;
    if (empty) return void this.ui.say('مفيش حاجة للتراجع عنها', 'Nothing to undo');
    this.update((x) => (x.mode === 'pattern' ? { ...x, cursor: patternUndo(x.cursor) } : { ...x, simple: simpleUndo(x.simple) }));
  }

  protected confirmReset(): void {
    this.update((x) => (x.mode === 'pattern' ? { ...x, cursor: patternReset(x.cursor) } : { ...x, simple: simpleReset(x.simple) }));
    this.sheet.set(null);
    void this.ui.say('تمت إعادة ضبط الدور', 'Round reset');
  }

  protected setMode(mode: 'simple' | 'pattern'): void {
    this.update((x) => ({ ...x, mode }));
  }
  protected setCountMode(m: CountMode): void {
    this.update((x) => ({ ...x, cursor: patternSetMode(x.cursor, m) }));
  }
  protected jump(i: number): void {
    const parsed = this.parsed();
    if (parsed) this.update((x) => ({ ...x, cursor: patternJump(parsed, x.cursor, i) }));
  }
  protected linkPattern(id: string): void {
    const p = this.p();
    if (!p) return;
    const pat = this.store.pattern(id);
    void this.store
      .updateTracker(p.id, (t) =>
        t.patternId === id
          ? { ...t, patternId: null, mode: 'simple' }
          : { ...t, patternId: id, mode: 'pattern', cursor: { ...t.cursor, roundIndex: 0, ptr: 0, history: [] }, simple: simpleSetTotalRounds(t.simple, pat ? parsePattern(pat.text).rounds.length : 0) },
      )
      .then(() => this.store.updateProject(p.id, (x) => x));
  }

  protected async finishProject(): Promise<void> {
    const p = this.p();
    if (!p) return;
    await this.store.setStatus(p.id, 'done');
    if (this.timerOn()) await this.timer.stop();
    await this.ui.say('مبروك! المشروع اتحوّل إلى «مكتمل».', 'Congratulations! The project is now completed.');
  }

  /* ---- time ---- */
  protected toggleTimer(): void {
    const p = this.p();
    if (p) void this.timer.toggle(p.id, this.inst()?.id ?? null);
  }
  protected stopTimer(): void {
    void this.timer.stop();
  }

  /* ---- parts ---- */
  /** Switch to another part: its own position is shown, nothing else moves, and a running timer carries over without losing a second. */
  protected async switchPart(id: string): Promise<void> {
    const p = this.p();
    if (!p || id === this.inst()?.id) return this.sheet.set(null);
    await this.store.setActiveInstance(p.id, id);
    await this.timer.switchInstance(p.id, id);
    this.sheet.set(null);
  }
  protected continueUnfinished(): void {
    const n = this.nextOpen();
    if (n) void this.switchPart(n.id);
  }

  protected async pick(id: string): Promise<void> {
    if (this.timer.running() && this.timer.running()!.projectId !== id) await this.timer.stop();
    await this.store.setCurrentProject(id);
    this.sheet.set(null);
  }

  /* settings sheet */
  private nameTimer: ReturnType<typeof setTimeout> | null = null;
  protected onName(ev: Event): void {
    const v = (ev.target as HTMLInputElement).value;
    const p = this.p();
    if (!p || !v.trim()) return;
    if (this.nameTimer) clearTimeout(this.nameTimer);
    this.nameTimer = setTimeout(() => void this.store.updateProject(p.id, (x) => ({ ...x, name: v.trim().slice(0, 120) })), 400);
  }
  protected setRound(n: number): void {
    this.update((x) => ({ ...x, simple: simpleSetRound(x.simple, n) }));
  }
  protected setTarget(n: number): void {
    this.update((x) => ({ ...x, simple: simpleSetTarget(x.simple, n) }));
  }
  protected setPer(n: number): void {
    this.update((x) => ({ ...x, simple: simpleSetPerTap(x.simple, n) }));
  }
  protected setTotal(n: number): void {
    this.update((x) => ({ ...x, simple: simpleSetTotalRounds(x.simple, n) }));
  }
  protected restartRound(): void {
    this.update((x) => ({ ...x, cursor: patternReset(x.cursor) }));
    this.sheet.set(null);
  }

  protected newProject(): void {
    this.sheet.set(null);
    void this.nav.navigateForward('/tabs/projects/new');
  }
  protected openSource(): void {
    const s = this.src();
    const p = this.p();
    if (s?.id) void this.nav.navigateForward(['/tabs/home/patterns', s.id]);
    else if (p?.collectionId) void this.nav.navigateForward(['/tabs/home/collections', p.collectionId]);
  }
  protected fmt(sec: number): string {
    return fmtHMS(sec);
  }
}
