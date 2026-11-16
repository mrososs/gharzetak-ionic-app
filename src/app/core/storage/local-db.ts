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

export interface ScopeDocs {
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
}

const DB_NAME = 'gharzetak';
const DB_VERSION = 1;

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
              upgrade(db) {
                db.createObjectStore('projects', { keyPath: 'k' }).createIndex('scope', 'scope');
                db.createObjectStore('patterns', { keyPath: 'k' }).createIndex('scope', 'scope');
                db.createObjectStore('docs', { keyPath: 'k' });
                db.createObjectStore('outbox', { keyPath: 'key' }).createIndex('scope', 'scope');
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

  /** Erases everything stored for a scope on this device. */
  async clearScope(scope: Scope): Promise<void> {
    const db = await this.db();
    if (!db) {
      for (const k of [...this.mem.keys()]) if (k.includes(`|${scope}`) || k.endsWith(scope)) this.mem.delete(k);
      return;
    }
    const tx = db.transaction(['projects', 'patterns', 'docs', 'outbox'], 'readwrite');
    for (const store of ['projects', 'patterns', 'outbox'] as const) {
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
