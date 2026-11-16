import { Injectable } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import type { ChatMessage, Pattern, Profile, Project, TutorialData } from '../models/models';

/** A data scope: everything a guest or a signed-in user owns on this device. */
export type Scope = 'guest' | `user:${string}`;

export type OutboxKind =
  | 'project'
  | 'progress'
  | 'note'
  | 'pattern'
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
}

interface GzDb extends DBSchema {
  projects: { key: string; value: { k: string; scope: Scope; v: Project }; indexes: { scope: string } };
  patterns: { key: string; value: { k: string; scope: Scope; v: Pattern }; indexes: { scope: string } };
  docs: { key: string; value: { k: string; scope: Scope; v: Partial<ScopeDocs> } };
  outbox: { key: string; value: OutboxEntry; indexes: { scope: string } };
  /** Server revision last seen per synced entity (optimistic-concurrency base). key = `${scope}|${kind}|${id}` */
  revisions: { key: string; value: { k: string; scope: Scope; rev: number }; indexes: { scope: string } };
}

const DB_NAME = 'gharzetak';
/** v2 adds the `revisions` store. The upgrade is additive: existing stores and records are untouched. */
const DB_VERSION = 2;

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
    const tx = db.transaction(['projects', 'patterns', 'docs', 'outbox', 'revisions'], 'readwrite');
    for (const store of ['projects', 'patterns', 'outbox', 'revisions'] as const) {
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
