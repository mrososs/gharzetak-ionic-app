import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';
import { HapticsService } from '../services/haptics.service';
import { AppStore } from '../state/app.store';
import { JoyPrefs, joyPrefsOf } from './joy.models';
import { PLAIN_ROUND, PLAIN_ROUNDS_IN_A_ROW, ROUNDS_IN_A_ROW, ROUND_MESSAGES, Bilingual, arOrdinal, arRounds, nextIndex } from './joy.copy';
import { CelebrationBatch, JoyService } from './joy.service';

export type AvatarMood = 'happy' | 'celebrate' | 'proud' | 'relaxed';

/** The Level-1 round banner currently on screen. */
export interface BannerView {
  /** Changes for every banner, so animations restart. */
  readonly id: number;
  readonly text: string;
  readonly mood: AvatarMood;
  /** Rounds this banner stands for (> 1 when quick rounds were coalesced into one summary). */
  readonly rounds: number;
}

/** At most one Level-1 banner per window. Rounds finished inside it are NOT lost: they are folded into the next banner's summary. */
export const BANNER_WINDOW_MS = 20_000;
export const BANNER_VISIBLE_MS = 2_400;

/**
 * Decides WHAT the user sees for the genuinely new events {@link JoyService} publishes. It never touches the ledger (recording already
 * happened) and never touches the counter: it only reads preferences and writes view-state signals that the UI hosts render.
 */
@Injectable({ providedIn: 'root' })
export class JoyPresenter {
  private readonly joy = inject(JoyService);
  private readonly store = inject(AppStore);
  private readonly i18n = inject(I18nService);
  private readonly haptics = inject(HapticsService);

  readonly banner = signal<BannerView | null>(null);

  private handled = this.joy.batch()?.seq ?? 0;
  private bannerId = 0;
  private lastShownAt = Number.NEGATIVE_INFINITY;
  private coalesced = 0;
  private lastMsg = -1;
  private lastSummary = -1;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

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
      untracked(() => this.dismissBanner());
    });
  }

  get prefs(): JoyPrefs {
    return joyPrefsOf(this.store.prefs());
  }

  private present(batch: CelebrationBatch): void {
    const prefs = this.prefs;
    if (prefs.celebrate === 'off') return;
    const round = batch.requests.find((r) => r.event.kind === 'round');
    const higher = batch.requests.some((r) => r.level >= 2);
    // A higher level replaces the plain round banner (P2 renders those); the round itself was already recorded.
    if (round && !higher && prefs.celebrate === 'every') this.presentRound(round.event.display ?? round.event.round ?? 0, prefs);
  }

  private presentRound(display: number, prefs: JoyPrefs): void {
    const now = Date.now();
    if (now - this.lastShownAt < BANNER_WINDOW_MS) {
      this.coalesced++; // redundant UI only: the ledger row is already stored
      return;
    }
    const rounds = this.coalesced + 1;
    this.coalesced = 0;
    this.lastShownAt = now;
    this.banner.set({ id: ++this.bannerId, text: this.roundText(display, rounds, prefs), mood: 'happy', rounds });
    if (prefs.haptics) void this.haptics.impact('light');
    this.armHide();
  }

  private roundText(display: number, rounds: number, prefs: JoyPrefs): string {
    const lang = this.i18n.lang();
    const fill = (m: Bilingual): string => {
      const t = m[lang];
      return t
        .replace('{n}', lang === 'ar' ? arOrdinal(display) : String(display))
        .replace('{r}', arRounds(rounds))
        .replace('{k}', String(rounds));
    };
    if (rounds > 1) {
      if (!prefs.messages) return fill(PLAIN_ROUNDS_IN_A_ROW);
      this.lastSummary = nextIndex(ROUNDS_IN_A_ROW.length, this.lastSummary);
      return fill(ROUNDS_IN_A_ROW[this.lastSummary]);
    }
    if (!prefs.messages) return fill(PLAIN_ROUND);
    this.lastMsg = nextIndex(ROUND_MESSAGES.length, this.lastMsg);
    return fill(ROUND_MESSAGES[this.lastMsg]);
  }

  private armHide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.dismissBanner(), BANNER_VISIBLE_MS);
  }

  dismissBanner(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    if (this.banner()) this.banner.set(null);
  }
}
