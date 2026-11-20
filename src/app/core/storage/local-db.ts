import { Injectable } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import type { JoyRow } from '../domain/joy';
import type { ScopePrefs } from '../joy/joy.models';
import type { TourEventRecord } from '../tour/tour.types';
import type { ChatMessage, Pattern, PatternCollection, PatternRevision, Profile, Project, TutorialData } from '../models/models';

/** A data scope: everything a guest or a signed-in user owns on this device. */
export type Scope = 'guest' | `user:${string}`;

export type OutboxKind =
  | 'project'
  | 'progress'
  | 'note'
  | 'pattern'
  | 'collection'
  | 'patternrev'
  | 'profile'
  | 'tools'
  | 'favorite'
  | 'tutorial'
  | 'photo'
  | 'cover'
  | 'session'
  | 'interest';

export interface OutboxEntry {
  /** `${scope}|${kind}|${id}` — one coalesced entry per entity. */
  key: string;
  scope: Scope;
  kind: OutboxKind;
  id: string;
  op: 'upsert' | 'delete';
  queuedAt: number;
  attempts: number;
  /** Optional immutable payload (e.g. a finished work session). */
  payload?: unknown;
}

/**
 * A local change that the server's newer version replaced (or that the server rejected). It is kept on the device
 * instead of being silently discarded, so the user's work can always be recovered.
 */
export interface ConflictBackup {
  readonly id: string;
  readonly at: number;
  readonly kind: OutboxKind;
  readonly entityId: string;
  /** Human label (project / pattern name) shown in the notice. */
  readonly label: string;
  readonly reason: 'newer-on-server' | 'deleted' | 'rejected';
  /** The exact data this device tried to save. */
  readonly snapshot: unknown;
}

export interface ScopeDocs {
  /** Most recent first-in-last-out list (capped) of local changes that lost a conflict. */
  conflicts: ConflictBackup[];
  profile: Profile;
  favorites: string[];
  tutorials: Record<string, TutorialData>;
  chat: ChatMessage[];
  storeEmail: string;
  storeNotified: boolean;
  lastSyncAt: number;
  currentProjectId: string | null;
  /** The work timer's running segment, persisted so an app kill / restart never loses recorded time. */
  timer: PersistedTimer | null;
  /** Local display preferences (immersive Android navigation) and Crochet Joy preferences (celebrations, reminders, share cards). */
  prefs: ScopePrefs;
  /**
   * Guest → account import journal (stored in the GUEST scope while an import is in progress): guest project id → account project id.
   * It makes the import resumable and idempotent even when an id had to be remapped.
   */
  importMap: Record<string, string>;
  /** Crochet Joy ledger rows that could not be migrated safely from the guest scope. Kept so nothing is lost and no count is invented. */
  joyRecovery: JoyRow[];
  /** Local product-tour event log (last 200). Content-free: event names, tour and step ids, reasons. Never leaves the device. */
  tourEvents: TourEventRecord[];
}

/** A running timer segment. `beat` is refreshed every few seconds; after a crash only time up to the last beat is credited. */
export interface PersistedTimer {
  readonly projectId: string;
  readonly instanceId: string | null;
  readonly startedAt: number;
  readonly beat: number;
}

interface GzDb extends DBSchema {
  projects: { key: string; value: { k: string; scope: Scope; v: Project }; indexes: { scope: string } };
  patterns: { key: string; value: { k: string; scope: Scope; v: Pattern }; indexes: { scope: string } };
  collections: { key: string; value: { k: string; scope: Scope; v: PatternCollection }; indexes: { scope: string } };
  /** Immutable history of earlier pattern / collection content. key = `${scope}|${revision.id}` */
  patternRevs: { key: string; value: { k: string; scope: Scope; v: PatternRevision }; indexes: { scope: string } };
  docs: { key: string; value: { k: string; scope: Scope; v: Partial<ScopeDocs> } };
  outbox: { key: string; value: OutboxEntry; indexes: { scope: string } };
  /** Server revision last seen per synced entity (optimistic-concurrency base). key = `${scope}|${kind}|${id}` */
  revisions: { key: string; value: { k: string; scope: Scope; rev: number }; indexes: { scope: string } };
  /** Crochet Joy ledger: one row per celebrated event / unlocked achievement. key = `${scope}|${row.key}`. Insert-if-absent only. */
  joy: { key: string; value: { k: string; scope: Scope; v: JoyRow }; indexes: { scope: string } };
}

const DB_NAME = 'gharzetak';
/** v2 adds `revisions`; v3 adds `collections` and `patternRevs`; v4 adds `joy`. Upgrades are additive: existing stores and records are untouched. */
const DB_VERSION = 4;

/**
 * IndexedDB persistence for structured offline data (projects, patterns, tracker state,
 * the sync outbox). Writes are awaited so a confirmed tracker step is durable.
 * Falls back to an in-memory map when IndexedDB is unavailable (private mode / tests).
 */
@Injectable({ providedIn: 'root' })
export class LocalDb {
  private dbp: Promise<IDBPDatabase<GzDb> | null> | null = null;
  private readonly mem = new Map<string, unknown>();

  private db(): Promise<IDBPDatabase<GzDb> | null> {
    if (!this.dbp) {
      this.dbp =
        typeof indexedDB === 'undefined'
          ? Promise.resolve(null)
          : openDB<GzDb>(DB_NAME, DB_VERSION, {
              upgrade(db, oldVersion) {
                if (oldVersion < 1) {
                  db.createObjectStore('projects', { keyPath: 'k' }).createIndex('scope', 'scope');
                  db.createObjectStore('patterns', { keyPath: 'k' }).createIndex('scope', 'scope');
                  db.createObjectStore('docs', { keyPath: 'k' });
                  db.createObjectStore('outbox', { keyPath: 'key' }).createIndex('scope', 'scope');
                }
                if (oldVersion < 2) {
                  db.createObjectStore('revisions', { keyPath: 'k' }).createIndex('scope', 'scope');
                }
                if (oldVersion < 3) {
                  db.createObjectStore('collections', { keyPath: 'k' }).createIndex('scope', 'scope');
                  db.createObjectStore('patternRevs', { keyPath: 'k' }).createIndex('scope', 'scope');
                }
                if (oldVersion < 4) {
                  db.createObjectStore('joy', { keyPath: 'k' }).createIndex('scope', 'scope');
                }
              },
            }).catch(() => null);
    }
    return this.dbp;
  }

  async loadProjects(scope: Scope): Promise<Project[]> {
    const db = await this.db();
    if (!db) return this.memList<Project>(`projects|${scope}|`);
    return (await db.getAllFromIndex('projects', 'scope', scope)).map((r) => r.v);
  }

  async putProject(scope: Scope, p: Project): Promise<void> {
    const db = await this.db();
    const k = `${scope}|${p.id}`;
    if (!db) return void this.mem.set(`projects|${k}`, p);
    await db.put('projects', { k, scope, v: p });
  }

  async removeProject(scope: Scope, id: string): Promise<void> {
    const db = await this.db();
    if (!db) return void this.mem.delete(`projects|${scope}|${id}`);
    await db.delete('projects', `${scope}|${id}`);
  }

  async loadPatterns(scope: Scope): Promise<Pattern[]> {
    const db = await this.db();
    if (!db) return this.memList<Pattern>(`patterns|${scope}|`);
    return (await db.getAllFromIndex('patterns', 'scope', scope)).map((r) => r.v);
  }

  async putPattern(scope: Scope, p: Pattern): Promise<void> {
    const db = await this.db();
    const k = `${scope}|${p.id}`;
    if (!db) return void this.mem.set(`patterns|${k}`, p);
    await db.put('patterns', { k, scope, v: p });
  }

  async removePattern(scope: Scope, id: string): Promise<void> {
    const db = await this.db();
    if (!db) return void this.mem.delete(`patterns|${scope}|${id}`);
    await db.delete('patterns', `${scope}|${id}`);
  }

  async loadCollections(scope: Scope): Promise<PatternCollection[]> {
    const db = await this.db();
    if (!db) return this.memList<PatternCollection>(`collections|${scope}|`);
    return (await db.getAllFromIndex('collections', 'scope', scope)).map((r) => r.v);
  }

  async putCollection(scope: Scope, c: PatternCollection): Promise<void> {
    const db = await this.db();
    const k = `${scope}|${c.id}`;
    if (!db) return void this.mem.set(`collections|${k}`, c);
    await db.put('collections', { k, scope, v: c });
  }

  async removeCollection(scope: Scope, id: string): Promise<void> {
    const db = await this.db();
    if (!db) return void this.mem.delete(`collections|${scope}|${id}`);
    await db.delete('collections', `${scope}|${id}`);
  }

  async loadPatternRevs(scope: Scope): Promise<PatternRevision[]> {
    const db = await this.db();
    if (!db) return this.memList<PatternRevision>(`patternRevs|${scope}|`);
    return (await db.getAllFromIndex('patternRevs', 'scope', scope)).map((r) => r.v);
  }

  /** History is append-only: an existing revision id is never overwritten. */
  async putPatternRev(scope: Scope, r: PatternRevision): Promise<boolean> {
    const db = await this.db();
    const k = `${scope}|${r.id}`;
    if (!db) {
      if (this.mem.has(`patternRevs|${k}`)) return false;
      this.mem.set(`patternRevs|${k}`, r);
      return true;
    }
    if (await db.get('patternRevs', k)) return false;
    await db.put('patternRevs', { k, scope, v: r });
    return true;
  }

  /* ---- Crochet Joy ledger (insert-if-absent; achievements keep the EARLIEST unlock date) ---- */

  async loadJoy(scope: Scope): Promise<JoyRow[]> {
    const db = await this.db();
    if (!db) return this.memList<JoyRow>(`joy|${scope}|`);
    return (await db.getAllFromIndex('joy', 'scope', scope)).map((r) => r.v);
  }

  /** Returns true only when the row was newly inserted. An existing key is never overwritten (one event is stored once). */
  async putJoyIfAbsent(scope: Scope, row: JoyRow): Promise<boolean> {
    const k = `${scope}|${row.key}`;
    const db = await this.db();
    if (!db) {
      if (this.mem.has(`joy|${k}`)) return false;
      this.mem.set(`joy|${k}`, row);
      return true;
    }
    // One readwrite transaction: the existence check and the insert cannot interleave with another writer.
    const tx = db.transaction('joy', 'readwrite');
    const exists = await tx.store.get(k);
    if (!exists) await tx.store.put({ k, scope, v: row });
    await tx.done;
    return !exists;
  }

  /**
   * Merge used by the guest → account import: inserts a missing row; for an achievement that already exists keeps whichever unlock
   * date is EARLIER. Round / part / project rows are never touched when they already exist (no double counting).
   */
  async mergeJoyRow(scope: Scope, row: JoyRow): Promise<'inserted' | 'earlier' | 'exists'> {
    const k = `${scope}|${row.key}`;
    const db = await this.db();
    if (!db) {
      const cur = this.mem.get(`joy|${k}`) as JoyRow | undefined;
      if (!cur) {
        this.mem.set(`joy|${k}`, row);
        return 'inserted';
      }
      if (row.kind === 'achievement' && row.at < cur.at) {
        this.mem.set(`joy|${k}`, { ...cur, at: row.at, source: row.source === 'live' ? 'live' : cur.source });
        return 'earlier';
      }
      return 'exists';
    }
    const tx = db.transaction('joy', 'readwrite');
    const cur = await tx.store.get(k);
    let result: 'inserted' | 'earlier' | 'exists' = 'exists';
    if (!cur) {
      await tx.store.put({ k, scope, v: row });
      result = 'inserted';
    } else if (row.kind === 'achievement' && row.at < cur.v.at) {
      await tx.store.put({ k, scope, v: { ...cur.v, at: row.at, source: row.source === 'live' ? 'live' : cur.v.source } });
      result = 'earlier';
    }
    await tx.done;
    return result;
  }

  async loadDocs(scope: Scope): Promise<Partial<ScopeDocs>> {
    const db = await this.db();
    if (!db) return (this.mem.get(`docs|${scope}`) as Partial<ScopeDocs>) ?? {};
    return (await db.get('docs', scope))?.v ?? {};
  }

  async patchDocs(scope: Scope, patch: Partial<ScopeDocs>): Promise<void> {
    const cur = await this.loadDocs(scope);
    const v = { ...cur, ...patch };
    const db = await this.db();
    if (!db) return void this.mem.set(`docs|${scope}`, v);
    await db.put('docs', { k: scope, scope, v });
  }

  async enqueue(e: Omit<OutboxEntry, 'key' | 'queuedAt' | 'attempts'>): Promise<void> {
    const key = `${e.scope}|${e.kind}|${e.id}`;
    const entry: OutboxEntry = { ...e, key, queuedAt: Date.now(), attempts: 0 };
    const db = await this.db();
    if (!db) return void this.mem.set(`outbox|${key}`, entry);
    await db.put('outbox', entry);
  }

  async outbox(scope: Scope): Promise<OutboxEntry[]> {
    const db = await this.db();
    const list = db ? await db.getAllFromIndex('outbox', 'scope', scope) : this.memList<OutboxEntry>(`outbox|${scope}|`);
    return list.sort((a, b) => a.queuedAt - b.queuedAt);
  }

  async dequeue(entry: OutboxEntry): Promise<void> {
    const db = await this.db();
    if (!db) return void this.mem.delete(`outbox|${entry.key}`);
    // only remove if nothing newer was queued for the same entity meanwhile
    const cur = await db.get('outbox', entry.key);
    if (cur && cur.queuedAt === entry.queuedAt) await db.delete('outbox', entry.key);
  }

  async bumpAttempts(entry: OutboxEntry): Promise<void> {
    const db = await this.db();
    if (!db) return;
    const cur = await db.get('outbox', entry.key);
    if (cur) await db.put('outbox', { ...cur, attempts: cur.attempts + 1 });
  }

  /** Server revisions last seen for every synced entity of a scope (`${kind}|${id}` -> revision). */
  async revisions(scope: Scope): Promise<Map<string, number>> {
    const db = await this.db();
    const prefix = `${scope}|`;
    if (!db) return new Map(this.memList<{ k: string; rev: number }>(`revisions|${prefix}`).map((r) => [r.k.slice(prefix.length), r.rev]));
    const rows = await db.getAllFromIndex('revisions', 'scope', scope);
    return new Map(rows.map((r) => [r.k.slice(prefix.length), r.rev]));
  }

  /** `rev` 0 forgets the entity (it no longer exists on the server). */
  async setRevision(scope: Scope, key: string, rev: number): Promise<void> {
    const k = `${scope}|${key}`;
    const db = await this.db();
    if (!db) {
      if (rev > 0) this.mem.set(`revisions|${k}`, { k, rev });
      else this.mem.delete(`revisions|${k}`);
      return;
    }
    if (rev > 0) await db.put('revisions', { k, scope, rev });
    else await db.delete('revisions', k);
  }

  /** Erases everything stored for a scope on this device. */
  async clearScope(scope: Scope): Promise<void> {
    const db = await this.db();
    if (!db) {
      for (const k of [...this.mem.keys()]) if (k.includes(`|${scope}`) || k.endsWith(scope)) this.mem.delete(k);
      return;
    }
    const tx = db.transaction(['projects', 'patterns', 'collections', 'patternRevs', 'docs', 'outbox', 'revisions', 'joy'], 'readwrite');
    for (const store of ['projects', 'patterns', 'collections', 'patternRevs', 'outbox', 'revisions', 'joy'] as const) {
      const keys = await tx.objectStore(store).index('scope').getAllKeys(scope);
      for (const k of keys) await tx.objectStore(store).delete(k);
    }
    await tx.objectStore('docs').delete(scope);
    await tx.done;
  }

  private memList<T>(prefix: string): T[] {
    return [...this.mem.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v as T);
  }
}
