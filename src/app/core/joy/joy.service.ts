import { Injectable, inject, signal } from '@angular/core';
import { JoyEvent, JoyKind, rowFromEvent } from '../domain/joy';
import { AppStore } from '../state/app.store';
import { Scope } from '../storage/local-db';
import { EARNED_BY_CREATION, EARNED_BY_EVENT } from './achievements';
import { AchievementsService } from './achievements.service';
import { JoyLedgerService } from './joy-ledger.service';
import { AchievementId } from './joy.models';

/** 1 = round banner · 2 = milestone card · 3 = part sheet · 4 = project finale. */
export type CelebrationLevel = 1 | 2 | 3 | 4;

export interface CelebrationRequest {
  readonly level: CelebrationLevel;
  readonly event: JoyEvent;
  readonly at: number;
}

/** The genuinely NEW events one user command created, in order. UI hosts react to `batch`; `seq` changes on every batch. */
export interface CelebrationBatch {
  readonly seq: number;
  readonly scope: Scope;
  readonly requests: readonly CelebrationRequest[];
  /** Achievements this command newly unlocked (shown with the celebration, or on their own). */
  readonly badges: readonly AchievementId[];
  /** Events that were valid but ALREADY recorded (e.g. finishing a project a second time): never celebrated again, but the user still gets a quiet confirmation. */
  readonly repeats: readonly JoyKind[];
}

export function levelOf(e: JoyEvent): CelebrationLevel {
  switch (e.kind) {
    case 'round':
      return 1;
    case 'milestone':
      return 2;
    case 'part':
    case 'allParts':
      return 3;
    default:
      return 4;
  }
}

/**
 * Turns detected events into celebrations: persist to the ledger FIRST (insert-if-absent), present only what was new.
 * Fully decoupled from the counter: the store calls `onJoy` without awaiting, and any failure here is swallowed.
 */
@Injectable({ providedIn: 'root' })
export class JoyService {
  private readonly store = inject(AppStore);
  private readonly ledger = inject(JoyLedgerService);
  private readonly achievements = inject(AchievementsService);

  readonly batch = signal<CelebrationBatch | null>(null);
  private seq = 0;

  constructor() {
    this.store.onJoy = (scope, events) => void this.handle(scope, events);
    this.store.onProjectCreated = (scope) => void this.handleCreated(scope);
  }

  /** The user created a project: "First project" / "Multi-part maker" may unlock. Never called for import, sync or demo data. */
  async handleCreated(scope: Scope): Promise<void> {
    try {
      const badges = await this.achievements.evaluate(scope, 'live', false, EARNED_BY_CREATION);
      this.publish(scope, [], badges, []);
    } catch {
      /* never let the celebration layer affect the app */
    }
  }

  async handle(scope: Scope, events: readonly JoyEvent[]): Promise<void> {
    try {
      const now = Date.now();
      const fresh: CelebrationRequest[] = [];
      const repeats: JoyKind[] = [];
      for (const e of events) {
        if (await this.ledger.record(scope, rowFromEvent(e, now))) fresh.push({ level: levelOf(e), event: e, at: now });
        else if (e.kind === 'project') repeats.push(e.kind);
      }
      // Only what these new events can earn: e.g. a round never "unlocks" First project for a project that merely arrived by sync.
      const earnable = [...new Set(fresh.flatMap((r) => (r.event.kind === 'round' || r.event.kind === 'part' || r.event.kind === 'project' ? EARNED_BY_EVENT[r.event.kind] : [])))];
      const badges = earnable.length ? await this.achievements.evaluate(scope, 'live', false, earnable) : [];
      this.publish(scope, fresh, badges, repeats);
    } catch {
      /* never let the celebration layer affect counting */
    }
  }

  private publish(scope: Scope, fresh: readonly CelebrationRequest[], badges: readonly AchievementId[], repeats: readonly JoyKind[]): void {
    if (!fresh.length && !badges.length && !repeats.length) return;
    // The account changed while we were persisting: the events are recorded (they are real) but must not be shown to someone else.
    // (`loaded()` is false for the whole account-switch window, before `scope()` itself flips.)
    if (scope !== this.store.scope() || !this.store.loaded()) return;
    this.batch.set({ seq: ++this.seq, scope, requests: fresh, badges, repeats });
  }
}
