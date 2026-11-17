import { Injectable, inject, signal } from '@angular/core';
import { JoyEvent, rowFromEvent } from '../domain/joy';
import { AppStore } from '../state/app.store';
import { Scope } from '../storage/local-db';
import { JoyLedgerService } from './joy-ledger.service';

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

  readonly batch = signal<CelebrationBatch | null>(null);
  private seq = 0;

  constructor() {
    this.store.onJoy = (scope, events) => void this.handle(scope, events);
  }

  async handle(scope: Scope, events: readonly JoyEvent[]): Promise<void> {
    try {
      const now = Date.now();
      const fresh: CelebrationRequest[] = [];
      for (const e of events) {
        if (await this.ledger.record(scope, rowFromEvent(e, now))) fresh.push({ level: levelOf(e), event: e, at: now });
      }
      // The account changed while we were persisting: the events are recorded (they are real) but must not be shown to someone else.
      // (`loaded()` is false for the whole account-switch window, before `scope()` itself flips.)
      if (!fresh.length || scope !== this.store.scope() || !this.store.loaded()) return;
      this.batch.set({ seq: ++this.seq, scope, requests: fresh });
    } catch {
      /* never let the celebration layer affect counting */
    }
  }
}
