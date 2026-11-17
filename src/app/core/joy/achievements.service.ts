import { Injectable, computed, effect, inject, untracked } from '@angular/core';
import { instanceProgress } from '../domain/collections';
import { JoyRow, joyKey } from '../domain/joy';
import { AppStore } from '../state/app.store';
import { Scope } from '../storage/local-db';
import { ACHIEVEMENTS, AchievementFacts, metAchievements } from './achievements';
import { JoyLedgerService } from './joy-ledger.service';
import { AchievementId } from './joy.models';

/**
 * Evaluates achievements against the ledger and the user's durable projects.
 *  - `live`: called right after a real event; new unlocks may be celebrated;
 *  - `backfill`: silent derivation (never celebrated), run when a scope loads, so an existing user's finished / multi-part projects
 *    are credited without a fake celebration.
 * Unlocks are ledger rows (insert-if-absent): never duplicated, never removed — undo, a reverted status or a deleted project does not
 * take a badge away. Everything is device-local and scoped to the signed-in account (or guest); nothing is synced.
 */
@Injectable({ providedIn: 'root' })
export class AchievementsService {
  private readonly store = inject(AppStore);
  private readonly ledger = inject(JoyLedgerService);

  /** unlocked achievement → its ledger row (carries the unlock date and whether it was credited silently). */
  readonly unlocked = computed(() => new Map(this.ledger.rows('achievement').map((r) => [r.achievementId as AchievementId, r])));
  readonly list = computed(() => {
    const map = this.unlocked();
    return ACHIEVEMENTS.map((def) => ({ def, row: map.get(def.id) ?? null }));
  });
  readonly count = computed(() => this.unlocked().size);

  private backfilledScope: Scope | null = null;

  constructor() {
    effect(() => {
      const scope = this.store.scope();
      const ready = this.store.loaded() && this.ledger.loadedScope() === scope;
      if (!ready || this.backfilledScope === scope) return;
      untracked(() => {
        this.backfilledScope = scope;
        void this.evaluate(scope, 'backfill', true);
      });
    });
  }

  /** Re-run the silent derivation (e.g. after the app resumed and sync may have brought projects from another device). */
  async backfill(): Promise<void> {
    await this.evaluate(this.store.scope(), 'backfill', true);
  }

  /** Facts from real data only. `scanPieces` additionally parses every part snapshot, so it is reserved for back-fill. */
  facts(scanPieces: boolean): AchievementFacts {
    const projects = this.store.projects();
    const counts = this.ledger.counts();
    let piece = counts.part > 0;
    if (!piece && scanPieces) {
      piece = projects.some((p) => (p.parts ?? []).some((i) => instanceProgress(i, (p.partSnapshots ?? []).find((s) => s.partId === i.partId)).done));
    }
    return {
      rounds: counts.round,
      projects: projects.length,
      multipart: projects.some((p) => !!p.collectionId && (p.parts ?? []).filter((i) => !i.retired).length >= 2),
      piece,
      finished: counts.project > 0 || projects.some((p) => p.status === 'done'),
      amigurumiDone: projects.some((p) => p.status === 'done' && p.category === 'amigurumi'),
    };
  }

  /**
   * Records every newly met achievement and returns the ids that were new.
   * `only` restricts the evaluation to the achievements the triggering action can legitimately earn (a live celebration is only ever
   * for what the user JUST did; anything else that is already true is credited silently by the back-fill).
   */
  async evaluate(scope: Scope, source: 'live' | 'backfill', scanPieces = false, only?: readonly AchievementId[]): Promise<AchievementId[]> {
    // Facts are read from the store, so only evaluate for the scope it currently holds.
    if (scope !== this.store.scope() || !this.store.loaded()) return [];
    const fresh: AchievementId[] = [];
    try {
      for (const id of metAchievements(this.facts(scanPieces))) {
        if (only && !only.includes(id)) continue;
        const key = joyKey({ kind: 'achievement', achievementId: id });
        if (this.ledger.has(key)) continue;
        const row: JoyRow = { key, kind: 'achievement', achievementId: id, at: Date.now(), source };
        const added = source === 'live' ? await this.ledger.record(scope, row) : await this.ledger.recordSilently(scope, row);
        if (added) fresh.push(id);
      }
    } catch {
      /* achievements are decoration: never affect the tracker */
    }
    return fresh;
  }
}
