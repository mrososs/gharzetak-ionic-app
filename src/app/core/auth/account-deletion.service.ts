import { Injectable, inject, signal } from '@angular/core';
import { LocalDb, type Scope } from '../storage/local-db';
import { TimerService } from '../services/timer.service';
import { AuthService, type DeleteFailure } from './auth.service';

/** Per-account flag written by the biometric-offer prompt (features/auth/auth.page.ts). Must go with the account. */
const declinedKey = (userId: string): string => `gz.bio.declined.${userId}`;

export type DeletionOutcome =
  | {
      readonly ok: true;
      /** 'complete' = the server confirmed every stored file is gone; 'pending' = account deleted, file removal still finishing server-side. */
      readonly storageCleanup: 'complete' | 'pending';
      /** 'failed' = the server deleted the account but this device could not erase its copy (the UI says so). */
      readonly localCleanup: 'done' | 'failed';
    }
  | { readonly ok: false; readonly failure: DeleteFailure | 'busy' };

/**
 * Deletes the signed-in account END TO END.
 *
 *   1. Remote first: authenticate + ask the Worker (AuthService.requestAccountDeletion). Local data is NOT touched while the remote
 *      outcome is unresolved or negative: a wrong password, a server error or a lost connection must never cost the person
 *      their projects.
 *   2. Only after the server confirmed: erase THIS account's scope on the device (projects, patterns, revisions, outbox of pending
 *      sync operations, revisions map, joy ledger, docs) and its per-account flags, then end the session.
 *   3. Guest data is a different scope (`guest`) and is never read, merged or erased here.
 *
 * Other devices signed in to the same account cannot be reached from here: their next request gets 401 and they sign out; the copy
 * they hold stays until the person erases it there (the page tells them so).
 */
@Injectable({ providedIn: 'root' })
export class AccountDeletionService {
  private readonly auth = inject(AuthService);
  private readonly db = inject(LocalDb);
  private readonly timer = inject(TimerService);

  /** True from the moment the request is sent until the outcome is known. The UI disables every control while it is true. */
  readonly busy = signal(false);

  private inFlight: Promise<DeletionOutcome> | null = null;

  /** A second call while one is running returns `busy` instead of sending a second request (double-tap protection). */
  delete(password: string | null): Promise<DeletionOutcome> {
    if (this.inFlight) return Promise.resolve({ ok: false, failure: 'busy' });
    this.inFlight = this.run(password).finally(() => {
      this.inFlight = null;
      this.busy.set(false);
    });
    return this.inFlight;
  }

  private async run(password: string | null): Promise<DeletionOutcome> {
    const user = this.auth.user();
    if (!user) return { ok: false, failure: 'unavailable' };
    this.busy.set(true);
    this.auth.deleting.set(true); // sync stands down for the duration
    const scope: Scope = `user:${user.id}`;

    let result: Awaited<ReturnType<AuthService['requestAccountDeletion']>>;
    try {
      result = await this.auth.requestAccountDeletion(password);
    } catch {
      result = { ok: false, failure: 'failed' };
    }
    if (!result.ok) {
      this.auth.deleting.set(false); // nothing was deleted: sync resumes, the person keeps working
      return { ok: false, failure: result.failure };
    }

    // The server confirmed. From here the account no longer exists: erase the device copy and end the session.
    let localCleanup: 'done' | 'failed' = 'done';
    try {
      await this.timer.stop().catch(() => undefined); // persists the running segment into the scope that is about to be erased
      await this.db.clearScope(scope);
    } catch {
      localCleanup = 'failed';
    }
    try {
      localStorage.removeItem(declinedKey(user.id));
    } catch {
      /* private mode */
    }
    await this.auth.finishAccountDeletion(); // clears the session + biometric-protected copy; the app falls back to the signed-out state
    // A debounced write that was already queued could have re-created a row between the first clear and the session ending.
    try {
      await this.db.clearScope(scope);
    } catch {
      localCleanup = 'failed';
    }
    return { ok: true, storageCleanup: result.storageCleanup, localCleanup };
  }
}
