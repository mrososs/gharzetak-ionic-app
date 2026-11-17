import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { instanceLabel, nextUnfinished, projectCompletion, siblingsOf } from '../domain/collections';
import { JoyEvent } from '../domain/joy';
import { formatMinutes } from '../domain/time';
import { I18nService } from '../i18n/i18n.service';
import { HapticsService } from '../services/haptics.service';
import { AppStore } from '../state/app.store';
import { achievementDef } from './achievements';
import {
  ALL_PARTS_INLINE,
  ALL_PARTS_TITLE,
  BADGE_TOAST,
  Bilingual,
  FINALE_TITLE,
  MILESTONE_BODY,
  MILESTONE_ROUNDS_TITLE,
  MILESTONE_TITLE,
  PART_INLINE,
  PART_TITLE,
  PLAIN_ROUND,
  PLAIN_ROUNDS_IN_A_ROW,
  PROJECT_DONE_QUIET,
  ROUNDS_COUNTED_DETAIL,
  ROUNDS_DETAIL,
  ROUNDS_IN_A_ROW,
  ROUND_MESSAGES,
  arOrdinal,
  arRounds,
  nextIndex,
} from './joy.copy';
import { AchievementId, JoyPrefs, joyPrefsOf } from './joy.models';
import { JoyLedgerService } from './joy-ledger.service';
import { CelebrationBatch, JoyService } from './joy.service';
import { ShareSource } from './share-card';
import { SHARE_HEADLINE, projectSource } from './share-source';

export type AvatarMood = 'happy' | 'celebrate' | 'proud' | 'relaxed';

/** The one-line banner currently on screen (a round, a badge, or — on the video page — a milestone / finished piece). */
export interface BannerView {
  /** Changes for every banner, so animations restart. */
  readonly id: number;
  readonly text: string;
  readonly mood: AvatarMood;
  /** Rounds this banner stands for (> 1 when quick rounds were coalesced into one summary). */
  readonly rounds: number;
}

/** Level 2: a compact card for 25 / 50 / 75 % (or every 10th round of open-ended counting). */
export interface MilestoneView {
  readonly id: number;
  readonly title: string;
  readonly body: string;
  /** Progress to show in the bar; null for open-ended counting (no fabricated percentage). */
  readonly pct: number | null;
  /** Achievements this milestone unlocked. */
  readonly badges: readonly AchievementId[];
  /** What a share card for this moment may contain (a small whitelist; see share-source.ts). */
  readonly share: ShareSource | null;
  readonly mood: AvatarMood;
}

/** Level 3: a finished physical piece. */
export interface PartView {
  readonly id: number;
  readonly projectId: string;
  readonly instanceId: string;
  readonly title: string;
  /** "Time on this piece" (null when nothing was recorded on it). */
  readonly timeText: string | null;
  readonly done: number;
  readonly total: number;
  /** Every piece is finished: the user may now EXPLICITLY mark the project finished (it is never completed silently). */
  readonly allDone: boolean;
  readonly nextId: string | null;
  /** Achievements this piece unlocked. */
  readonly badges: readonly AchievementId[];
  readonly share: ShareSource | null;
  readonly mood: AvatarMood;
}

/** Level 4: the explicit project completion. */
export interface FinaleView {
  readonly id: number;
  readonly projectId: string;
  readonly name: string;
  readonly title: string;
  readonly photoUrl: string | null;
  readonly timeText: string | null;
  readonly pieces: { readonly done: number; readonly total: number } | null;
  /** Rounds counted with the Gharzetak counter for this project (real ledger rows only; 0 = not shown). */
  readonly rounds: number;
  readonly badges: readonly AchievementId[];
  readonly share: ShareSource | null;
  readonly mood: AvatarMood;
}

/** At most one Level-1 banner per window. Rounds finished inside it are NOT lost: they are folded into the next banner's summary. */
export const BANNER_WINDOW_MS = 20_000;
export const BANNER_VISIBLE_MS = 2_400;
export const CARD_VISIBLE_MS = 6_000;

/**
 * Decides WHAT the user sees for the genuinely new events {@link JoyService} publishes. It never touches the ledger (recording already
 * happened) and never touches the counter: it only reads preferences and writes view-state signals that the UI hosts render.
 *
 * Levels: 1 round banner · 2 milestone card · 3 finished-piece sheet · 4 project finale. A higher level replaces a lower one.
 * "Celebrate: off" silences everything (a project finish still gets a plain confirmation).
 * On the video page ("surface" = video) nothing may cover or interrupt the video: every level becomes one inline line.
 */
@Injectable({ providedIn: 'root' })
export class JoyPresenter {
  private readonly joy = inject(JoyService);
  private readonly store = inject(AppStore);
  private readonly ledger = inject(JoyLedgerService);
  private readonly i18n = inject(I18nService);
  private readonly haptics = inject(HapticsService);
  private readonly ui = inject(UiFeedback);

  readonly banner = signal<BannerView | null>(null);
  readonly card = signal<MilestoneView | null>(null);
  readonly part = signal<PartView | null>(null);
  readonly finale = signal<FinaleView | null>(null);
  /** The video page sets this so higher levels become a single inline line there. */
  readonly surface = signal<'default' | 'video'>('default');

  private handled = this.joy.batch()?.seq ?? 0;
  private viewId = 0;
  private lastShownAt = Number.NEGATIVE_INFINITY;
  private coalesced = 0;
  private lastMsg = -1;
  private lastSummary = -1;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private cardTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const b = this.joy.batch();
      if (!b || b.seq <= this.handled) return;
      untracked(() => {
        this.handled = b.seq;
        this.present(b);
      });
    });
    // Nothing from one account may linger on screen after switching to another.
    effect(() => {
      this.store.scope();
      untracked(() => this.clearAll());
    });
  }

  get prefs(): JoyPrefs {
    return joyPrefsOf(this.store.prefs());
  }

  /* ------------------------------------------------------------------ */

  private present(batch: CelebrationBatch): void {
    const prefs = this.prefs;
    const find = (kind: JoyEvent['kind']) => batch.requests.find((r) => r.event.kind === kind)?.event;
    const projectEv = find('project');

    // A finished project always gets *some* confirmation; "off" and repeats get the plain one.
    if (projectEv && prefs.celebrate !== 'off') return this.presentFinale(projectEv, batch, prefs);
    if (projectEv || batch.repeats.includes('project')) {
      void this.ui.say(PROJECT_DONE_QUIET.ar, PROJECT_DONE_QUIET.en);
      return;
    }
    if (prefs.celebrate === 'off') return; // nothing at all (the events and unlocks are still recorded)

    const partEv = find('part');
    const allParts = find('allParts');
    const mileEv = find('milestone');
    const roundEv = find('round');
    if (partEv) return this.presentPart(partEv, !!allParts, prefs, batch.badges);
    if (mileEv) return this.presentMilestone(mileEv, prefs, batch.badges);
    // A new badge is rarer and more meaningful than "round 3 done": it takes the banner's place (the round is recorded either way).
    if (batch.badges.length) return this.presentBadge(batch.badges[0], prefs);
    if (roundEv && prefs.celebrate === 'every') this.presentRound(roundEv.display ?? roundEv.round ?? 0, prefs);
  }

  /* ---- Level 1 ---- */

  private presentRound(display: number, prefs: JoyPrefs): void {
    const now = Date.now();
    if (now - this.lastShownAt < BANNER_WINDOW_MS) {
      this.coalesced++; // redundant UI only: the ledger row is already stored
      return;
    }
    const rounds = this.coalesced + 1;
    this.coalesced = 0;
    this.lastShownAt = now;
    this.showBanner(this.roundText(display, rounds, prefs), 'happy', rounds);
    if (prefs.haptics) void this.haptics.impact('light');
  }

  private roundText(display: number, rounds: number, prefs: JoyPrefs): string {
    const fill = (m: Bilingual): string => this.fill(m, { n: this.i18n.lang() === 'ar' ? arOrdinal(display) : String(display), r: arRounds(rounds), k: String(rounds) });
    if (rounds > 1) {
      if (!prefs.messages) return fill(PLAIN_ROUNDS_IN_A_ROW);
      this.lastSummary = nextIndex(ROUNDS_IN_A_ROW.length, this.lastSummary);
      return fill(ROUNDS_IN_A_ROW[this.lastSummary]);
    }
    if (!prefs.messages) return fill(PLAIN_ROUND);
    this.lastMsg = nextIndex(ROUND_MESSAGES.length, this.lastMsg);
    return fill(ROUND_MESSAGES[this.lastMsg]);
  }

  /* ---- Level 2 ---- */

  private presentMilestone(e: JoyEvent, prefs: JoyPrefs, badges: readonly AchievementId[]): void {
    const title = this.milestoneTitle(e);
    if (prefs.haptics) void this.haptics.impact('medium');
    if (this.surface() === 'video') return this.showBanner(title, 'celebrate');
    const p = this.store.project(e.projectId);
    const inst = e.instanceId ? (p?.parts ?? []).find((i) => i.id === e.instanceId) : null;
    const snap = inst ? (p?.partSnapshots ?? []).find((s) => s.partId === inst.partId) : undefined;
    const name = inst && p ? instanceLabel(inst, snap, siblingsOf(p.parts ?? [], inst)) : (p?.name ?? '');
    const total = e.total ?? 0;
    const body = e.pct && total > 0 && prefs.messages ? this.fill(MILESTONE_BODY, { name, done: String(e.round ?? 0), total: String(total) }) : name;
    const share = p
      ? projectSource({
          kind: 'milestone',
          lang: this.i18n.lang(),
          avatarId: this.store.avatar(),
          headline: title,
          project: p,
          pieceLabel: inst ? instanceLabel(inst, snap, siblingsOf(p.parts ?? [], inst)) : null,
          pct: e.pct ?? null,
          detail: e.pct && total > 0 ? this.fill(ROUNDS_DETAIL, { done: String(e.round ?? 0), total: String(total) }) : null,
          formatTime: (s) => this.duration(s),
        })
      : null;
    this.clearTransient();
    this.card.set({ id: ++this.viewId, title, body, pct: e.pct ?? null, badges, share, mood: 'celebrate' });
    this.cardTimer = setTimeout(() => this.dismissCard(), CARD_VISIBLE_MS);
  }

  private milestoneTitle(e: JoyEvent): string {
    if (e.pct && (e.pct === 25 || e.pct === 50 || e.pct === 75)) return MILESTONE_TITLE[e.pct][this.i18n.lang()];
    const k = e.roundCount ?? 0;
    return this.fill(MILESTONE_ROUNDS_TITLE, { x: arRounds(k), k: String(k) });
  }

  /* ---- Level 3 ---- */

  private presentPart(e: JoyEvent, allDone: boolean, prefs: JoyPrefs, badges: readonly AchievementId[]): void {
    const p = this.store.project(e.projectId);
    const inst = (p?.parts ?? []).find((i) => i.id === e.instanceId);
    if (!p || !inst) return;
    const snaps = p.partSnapshots ?? [];
    const snap = snaps.find((s) => s.partId === inst.partId);
    const label = instanceLabel(inst, snap, siblingsOf(p.parts ?? [], inst));
    if (prefs.haptics) void this.haptics.success();
    if (this.surface() === 'video') return this.showBanner(this.fill(allDone ? ALL_PARTS_INLINE : PART_INLINE, { part: label }), 'celebrate');
    const c = projectCompletion(p.parts ?? [], snaps);
    const next = nextUnfinished(p.parts ?? [], snaps, inst.id);
    this.clearTransient();
    this.part.set({
      id: ++this.viewId,
      projectId: p.id,
      instanceId: inst.id,
      title: allDone ? ALL_PARTS_TITLE[this.i18n.lang()] : this.fill(PART_TITLE, { part: label }),
      timeText: inst.workedSeconds >= 60 ? this.duration(inst.workedSeconds) : null,
      done: c.doneCount,
      total: c.total,
      allDone,
      nextId: next && next.id !== inst.id ? next.id : null,
      badges,
      share: projectSource({
        kind: 'part',
        lang: this.i18n.lang(),
        avatarId: this.store.avatar(),
        headline: SHARE_HEADLINE[allDone ? 'allParts' : 'part'][this.i18n.lang()],
        project: p,
        pieceLabel: label,
        pct: c.percent,
        pieces: { done: c.doneCount, total: c.total },
        formatTime: (s) => this.duration(s),
      }),
      mood: 'celebrate',
    });
  }

  /* ---- Level 4 ---- */

  private presentFinale(e: JoyEvent, batch: CelebrationBatch, prefs: JoyPrefs): void {
    const p = this.store.project(e.projectId);
    if (!p) return;
    const c = p.parts?.length ? projectCompletion(p.parts, p.partSnapshots ?? []) : null;
    if (prefs.haptics) void this.haptics.success();
    this.clearTransient();
    this.finale.set({
      id: ++this.viewId,
      projectId: p.id,
      name: p.name,
      title: this.fill(FINALE_TITLE, { name: p.name }),
      photoUrl: p.coverLocalUrl ?? p.photos.find((x) => !!x.localUrl)?.localUrl ?? null,
      timeText: p.workedSeconds >= 60 ? this.duration(p.workedSeconds) : null,
      pieces: c && c.total > 1 ? { done: c.doneCount, total: c.total } : null,
      rounds: this.ledger.projectRounds(p.id),
      badges: batch.badges,
      share: projectSource({
        kind: 'project',
        lang: this.i18n.lang(),
        avatarId: this.store.avatar(),
        headline: SHARE_HEADLINE.project[this.i18n.lang()],
        project: p,
        detail: this.ledger.projectRounds(p.id) > 0 ? this.fill(ROUNDS_COUNTED_DETAIL, { k: String(this.ledger.projectRounds(p.id)) }) : null,
        pieces: c && c.total > 1 ? { done: c.doneCount, total: c.total } : null,
        formatTime: (s) => this.duration(s),
      }),
      mood: 'proud',
    });
  }

  /* ---- badges ---- */

  private presentBadge(id: AchievementId, prefs: JoyPrefs): void {
    const def = achievementDef(id);
    if (!def) return;
    this.showBanner(this.fill(BADGE_TOAST, { name: def.name[this.i18n.lang()] }), 'proud');
    if (prefs.haptics) void this.haptics.impact('medium');
  }

  /* ------------------------------------------------------------------ */

  private fill(m: Bilingual, vars: Record<string, string>): string {
    return m[this.i18n.lang()].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
  }

  private duration(seconds: number): string {
    return formatMinutes(Math.floor(seconds / 60), this.i18n.lang());
  }

  private showBanner(text: string, mood: AvatarMood, rounds = 1): void {
    this.card.set(null);
    this.banner.set({ id: ++this.viewId, text, mood, rounds });
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.dismissBanner(), BANNER_VISIBLE_MS);
  }

  /** A higher level replaces whatever lighter celebration is still on screen. */
  private clearTransient(): void {
    this.dismissBanner();
    this.dismissCard();
  }

  dismissBanner(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    if (this.banner()) this.banner.set(null);
  }

  dismissCard(): void {
    if (this.cardTimer) clearTimeout(this.cardTimer);
    this.cardTimer = null;
    if (this.card()) this.card.set(null);
  }

  dismissPart(): void {
    if (this.part()) this.part.set(null);
  }

  dismissFinale(): void {
    if (this.finale()) this.finale.set(null);
  }

  private clearAll(): void {
    this.dismissBanner();
    this.dismissCard();
    this.dismissPart();
    this.dismissFinale();
  }
}
