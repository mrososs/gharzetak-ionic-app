import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { JoyKind, JoyRow, isValidJoyRow, joyKey } from '../domain/joy';
import { AppStore } from '../state/app.store';
import { LocalDb, Scope } from '../storage/local-db';

export interface JoyImportReport {
  /** Rows newly written to the account. */
  migrated: number;
  /** Achievements that already existed in the account and whose unlock date was moved EARLIER. */
  merged: number;
  /** Rows the account already had (not counted twice). */
  duplicates: number;
  /** Rows that could not be mapped safely: kept in the account's recovery list, never turned into counts. */
  recovered: number;
  /** Rows that should have been written but could not be confirmed present afterwards. When > 0 the guest data must NOT be erased. */
  failed: number;
}

/**
 * The single idempotent Crochet Joy ledger (IndexedDB store `joy`, scope-keyed like every other store).
 *
 *  - insert-if-absent: one event is stored exactly once, whatever happens afterwards (undo, restart, sync, retries);
 *  - the in-memory index is only a fast path + a source for counts; the IndexedDB insert is authoritative;
 *  - nothing here is ever sent to the server.
 */
@Injectable({ providedIn: 'root' })
export class JoyLedgerService {
  private readonly db = inject(LocalDb);
  private readonly store = inject(AppStore);

  private cache = new Map<string, JoyRow>();
  private cacheScope: Scope | null = null;
  private loadToken = 0;
  /** Bumped whenever the index changes, so computed counts update. */
  private readonly version = signal(0);
  /** The scope the in-memory index currently holds (null until the first load finishes). */
  readonly loadedScope = signal<Scope | null>(null);

  /** How many rows of each kind the current scope has. */
  readonly counts = computed<Record<JoyKind, number>>(() => {
    this.version();
    const c: Record<JoyKind, number> = { round: 0, milestone: 0, part: 0, allParts: 0, project: 0, achievement: 0 };
    for (const r of this.cache.values()) c[r.kind]++;
    return c;
  });

  constructor() {
    effect(() => {
      const scope = this.store.scope();
      if (!this.store.loaded()) return;
      untracked(() => void this.load(scope));
    });
  }

  async load(scope: Scope): Promise<void> {
    const token = ++this.loadToken;
    let rows: JoyRow[] = [];
    try {
      rows = await this.db.loadJoy(scope);
    } catch {
      rows = [];
    }
    if (token !== this.loadToken) return;
    this.cache = new Map(rows.filter(isValidJoyRow).map((r) => [r.key, r]));
    this.cacheScope = scope;
    this.version.update((v) => v + 1);
    this.loadedScope.set(scope);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  row(key: string): JoyRow | null {
    return this.cache.get(key) ?? null;
  }

  rows(kind?: JoyKind): JoyRow[] {
    this.version();
    const all = [...this.cache.values()];
    return kind ? all.filter((r) => r.kind === kind) : all;
  }

  /** Counts for one project (finale statistics). */
  projectRounds(projectId: string): number {
    this.version();
    let n = 0;
    for (const r of this.cache.values()) if (r.kind === 'round' && r.projectId === projectId) n++;
    return n;
  }

  /**
   * Stores the row if its key is absent in `scope`. Resolves true ONLY for a genuinely new event — the caller may then celebrate.
   * Never throws into the tracker: a storage failure resolves false (no celebration, counting unaffected).
   */
  async record(scope: Scope, row: JoyRow): Promise<boolean> {
    if (scope === this.cacheScope && this.cache.has(row.key)) return false; // fast path: already celebrated
    let inserted = false;
    try {
      inserted = await this.db.putJoyIfAbsent(scope, row);
    } catch {
      return false;
    }
    if (inserted && scope === this.cacheScope) {
      this.cache.set(row.key, row);
      this.version.update((v) => v + 1);
    }
    return inserted;
  }

  /**
   * Silent insert for derived data (back-fill): same idempotence, never celebrated. Resolves true when newly added.
   */
  async recordSilently(scope: Scope, row: JoyRow): Promise<boolean> {
    return this.record(scope, { ...row, source: 'backfill' });
  }

  /**
   * Guest → account migration of the ledger (approved behaviour):
   *  - guest rows are copied into the account with project ids remapped through `projectMap` (the same map the project import used);
   *  - rows the account already has are skipped (no double counting); achievements keep the EARLIEST unlock date;
   *  - malformed rows or rows whose key no longer matches their content are NOT guessed at: they are kept in the account's
   *    `joyRecovery` list and reported;
   *  - no count is ever inferred from tracker positions;
   *  - the guest rows are NOT deleted here. The caller erases the guest scope only after `failed === 0`.
   * Idempotent: running it again after an interruption changes nothing that already succeeded.
   */
  async importFromGuest(target: Scope, projectMap: ReadonlyMap<string, string>): Promise<JoyImportReport> {
    const report: JoyImportReport = { migrated: 0, merged: 0, duplicates: 0, recovered: 0, failed: 0 };
    if (target === 'guest') return report;
    const guestRows = (await this.db.loadJoy('guest')) as unknown[];
    const toWrite: JoyRow[] = [];
    const unmappable: JoyRow[] = [];

    for (const raw of guestRows) {
      if (!isValidJoyRow(raw) || joyKey(raw) !== raw.key) {
        unmappable.push(raw as JoyRow);
        continue;
      }
      const pid = raw.projectId ? (projectMap.get(raw.projectId) ?? raw.projectId) : raw.projectId;
      const next: JoyRow = { ...raw, projectId: pid };
      toWrite.push({ ...next, key: joyKey(next) });
    }

    for (const row of toWrite) {
      try {
        const res = await this.db.mergeJoyRow(target, row);
        if (res === 'inserted') report.migrated++;
        else if (res === 'earlier') report.merged++;
        else report.duplicates++;
      } catch {
        report.failed++;
      }
    }

    if (unmappable.length) {
      const docs = await this.db.loadDocs(target);
      const seen = new Set((docs.joyRecovery ?? []).map((r) => JSON.stringify(r)));
      const add = unmappable.filter((r) => !seen.has(JSON.stringify(r)));
      if (add.length) await this.db.patchDocs(target, { joyRecovery: [...(docs.joyRecovery ?? []), ...add] });
      report.recovered = unmappable.length;
    }

    // Confirm every row we meant to write is really there before the caller is allowed to erase the guest copy.
    const present = new Set((await this.db.loadJoy(target)).map((r) => r.key));
    report.failed = toWrite.filter((r) => !present.has(r.key)).length;

    if (target === this.store.scope()) await this.load(target);
    return report;
  }
}
