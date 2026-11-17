import { Injectable, signal } from '@angular/core';
import type { ConvStatus } from '../../core/domain/smart-parser';

export interface DraftPart {
  readonly name: string;
  readonly quantity: number;
  /** Strict-notation instructions (already confirmed by the user in the preview). */
  readonly text: string;
  readonly assemblyNotes: string;
  readonly status: ConvStatus;
}

/** The result of a confirmed smart conversion, waiting for the editor that asked for it to pick it up. */
export interface ImportDraft {
  readonly target: 'collection' | 'pattern';
  readonly collectionName: string | null;
  /** The exact text the user pasted — stored with the saved collection / pattern so the original is always recoverable. */
  readonly sourceText: string;
  readonly parts: readonly DraftPart[];
}

/**
 * Hand-over between the Smart Import page and the editors (collection editor / pattern editor).
 * The editor takes the draft exactly once when it becomes active again, so a stale draft can never be applied twice.
 */
@Injectable({ providedIn: 'root' })
export class ImportDraftService {
  readonly pending = signal<ImportDraft | null>(null);

  offer(draft: ImportDraft): void {
    this.pending.set(draft);
  }

  /** Returns the pending draft for this target (and clears it), or null. */
  take(target: ImportDraft['target']): ImportDraft | null {
    const d = this.pending();
    if (!d || d.target !== target) return null;
    this.pending.set(null);
    return d;
  }

  discard(): void {
    this.pending.set(null);
  }
}
