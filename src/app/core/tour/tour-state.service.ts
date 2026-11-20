import { Injectable, computed, inject } from '@angular/core';
import { AppStore } from '../state/app.store';
import { DefMeta, applyDeclined, applyEnded, applyOffered, applyStarted, emptyRecord, emptyTourPrefs, evidenceCancels, recordOf, recoverActive, seedTourPrefs, withMilestone } from './tour-eligibility';
import type { MilestoneId, TourId } from './tour-ids';
import type { EndReason, Evidence, TourPrefs, TourRecord } from './tour.types';

/**
 * Reads and writes the tour state of the CURRENT scope (guest, or one account) through the store's per-scope preferences:
 * device-local, never synced, no backend. Every write replaces the whole `TourPrefs` object from the latest value, so two quick
 * writes can never overwrite each other with stale data.
 */
@Injectable({ providedIn: 'root' })
export class TourStateService {
  private readonly store = inject(AppStore);

  /** The stored tour state of this scope, or null if it has none yet. */
  readonly prefs = computed<TourPrefs | null>(() => this.store.prefs().tour ?? null);

  record(id: TourId): TourRecord {
    return recordOf(this.prefs(), id);
  }

  private async write(fn: (p: TourPrefs) => TourPrefs): Promise<void> {
    const cur = this.prefs() ?? emptyTourPrefs(Date.now());
    const next = fn(cur);
    if (next === cur && this.prefs()) return;
    await this.store.updatePrefs({ tour: next });
  }

  /**
   * First look at a scope with no tour state: remember what is already known (so later deletions never re-offer a tour), and turn a
   * tour a crash left `active` into an interruption. Idempotent.
   */
  async ensureSeeded(evidence: Evidence, defs: readonly DefMeta[]): Promise<void> {
    const cur = this.prefs();
    if (!cur) return this.store.updatePrefs({ tour: seedTourPrefs(evidence, Date.now()) });
    const next = recoverActive(cur, defs, Date.now());
    if (next !== cur) await this.store.updatePrefs({ tour: next });
  }

  /** An entry event (guest start, sign-up, new Google account, fresh sign-in): from now on the welcome tour may be offered. */
  async arm(evidence: Evidence): Promise<void> {
    await this.write((p) => {
      const base = p.seededAt ? p : seedTourPrefs(evidence, Date.now());
      if (evidenceCancels('welcome', evidence) || base.armed) return base === p ? p : base;
      return { ...base, armed: true };
    });
  }

  async noteOffered(def: DefMeta): Promise<void> {
    await this.write((p) => ({ ...p, tours: { ...p.tours, [def.id]: applyOffered(recordOf(p, def.id), def, Date.now()) } }));
  }

  async noteStarted(def: DefMeta): Promise<void> {
    await this.write((p) => ({ ...p, tours: { ...p.tours, [def.id]: applyStarted(recordOf(p, def.id), def, Date.now()) } }));
  }

  async noteDeclined(def: DefMeta): Promise<void> {
    await this.write((p) => ({ ...p, tours: { ...p.tours, [def.id]: applyDeclined(recordOf(p, def.id), def, Date.now()) } }));
  }

  /** Records the step reached (so a resume can start there) without changing the status. */
  async noteStep(def: DefMeta, step: string): Promise<void> {
    await this.write((p) => {
      const rec = recordOf(p, def.id);
      return rec.step === step ? p : { ...p, tours: { ...p.tours, [def.id]: { ...(rec.v ? rec : emptyRecord()), v: def.version, step, at: Date.now(), status: rec.status } } };
    });
  }

  async noteEnded(def: DefMeta, reason: EndReason, step: string | undefined, replay: boolean): Promise<TourRecord> {
    let result = this.record(def.id);
    await this.write((p) => {
      result = applyEnded(recordOf(p, def.id), def, reason, step, Date.now(), replay);
      return result === recordOf(p, def.id) ? p : { ...p, tours: { ...p.tours, [def.id]: result } };
    });
    return result;
  }

  async mark(id: MilestoneId): Promise<boolean> {
    if (this.prefs()?.milestones[id]) return false;
    await this.write((p) => withMilestone(p, id, Date.now()));
    return true;
  }

  async hideGettingStarted(): Promise<void> {
    await this.write((p) => ({ ...p, gettingStarted: { ...p.gettingStarted, hiddenAt: Date.now() } }));
  }

  /** Brings the list back on Home. Also valid for someone the app treated as established: asking for it is the signal that it is wanted. */
  async restoreGettingStarted(): Promise<void> {
    await this.write((p) => ({ ...p, armed: true, gettingStarted: {} }));
  }

  async completeGettingStarted(): Promise<void> {
    await this.write((p) => (p.gettingStarted?.completedAt ? p : { ...p, gettingStarted: { ...p.gettingStarted, completedAt: Date.now() } }));
  }

  /** Copies another scope's tour state into this one, only when this scope has none (guest → account in the same session). */
  async adopt(from: TourPrefs): Promise<void> {
    if (this.prefs()) return;
    await this.store.updatePrefs({ tour: from });
  }
}
