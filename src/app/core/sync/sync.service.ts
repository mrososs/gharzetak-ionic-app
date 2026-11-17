import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiClient, ApiError } from '../api/api.client';
import type { Accepted, ConflictCurrent, MediaStored, PullMultiState, PullProgress, PullResponse } from '../api/api.types';
import { AuthService } from '../auth/auth.service';
import { toAvatarId } from '../data/avatars';
import { CategoryId, YarnId, AccessoryId, LevelId } from '../data/catalog';
import { PartInstance, mergeInstances, mergeSnapshots, multiPosition } from '../domain/collections';
import { parsePattern } from '../domain/pattern-parser';
import { createPatternCursor, createSimpleCounter } from '../domain/tracker-engine';
import { Pattern, PatternCollection, PatternRevision, Profile, Project, ProjectPhoto, TutorialData } from '../models/models';
import { NetworkService } from '../services/network.service';
import { AppStore } from '../state/app.store';
import { uuid } from '../state/factories';
import { ConflictBackup, LocalDb, OutboxEntry, OutboxKind, Scope } from '../storage/local-db';
import { dataUrlToBlob } from '../utils/image';

export type SyncState = 'local' | 'idle' | 'syncing' | 'offline' | 'error';

const ORDER: OutboxKind[] = ['profile', 'tools', 'pattern', 'collection', 'patternrev', 'project', 'cover', 'progress', 'note', 'photo', 'session', 'favorite', 'tutorial', 'interest'];
const MAX_ATTEMPTS = 5;
const MAX_REBASES = 3;
const MAX_BACKUPS = 25;

/** A position on the tracker as one comparable number (rounds / pattern rows dominate, then the stitch within it). */
const position = (mode: string, round: number, count: number, rowIndex: number, ptr: number): number => (mode === 'pattern' ? rowIndex * 1_000_000 + ptr : round * 1_000_000 + count);

export interface ConflictNotice {
  readonly kind: OutboxKind;
  readonly label: string;
  readonly reason: ConflictBackup['reason'];
  readonly at: number;
}
/** Entity kinds whose server revision we track (everything else is idempotent by id). */
const VERSIONED = new Set(['profile', 'tools', 'pattern', 'collection', 'project', 'progress', 'note', 'tutorial']);

/** The server could not be reached or asked us to back off: keep the outbox entry and retry later. */
class NetworkFailure extends Error {}
/** The bearer token is no longer valid. */
class AuthExpired extends Error {}

/**
 * Offline-first synchronisation with the Cloudflare Worker API (D1 + R2).
 *
 * Push: every local mutation of a signed-in user is coalesced in an IndexedDB outbox (one entry per entity)
 *       and flushed in dependency order when online. An entry is removed ONLY after the server confirmed it.
 *       Writes are compare-and-swap on a server revision (`baseRevision`): a stale device gets 409 with the
 *       server's current revision and resolves it deterministically:
 *         - server's clientUpdatedAt >= ours  -> our entry is obsolete (or already applied: idempotent retry);
 *                                                it is dropped and the next pull adopts the server state;
 *         - ours is newer                     -> adopt the server revision and retry (last-write-wins between
 *                                                a user's own devices; the server clamps skewed clocks).
 * Pull: on sign-in, resume and reconnect, remote rows are merged last-write-wins, except entities with a
 *       pending local change, which are kept and pushed.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  private readonly store = inject(AppStore);
  private readonly db = inject(LocalDb);
  private readonly net = inject(NetworkService);

  readonly state = signal<SyncState>('local');
  readonly pending = signal(0);
  readonly lastError = signal<string | null>(null);
  /** Set when a local change lost a conflict (or was rejected) and was kept as a backup; the app shows it once and clears it. */
  readonly conflictNotice = signal<ConflictNotice | null>(null);
  readonly active = computed(() => this.api.configured && this.auth.signedIn());

  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pullRequested = false;
  private retryDelay = 0;

  private revs = new Map<string, number>();
  private revScope: Scope | null = null;
  private readonly media = new Map<string, Promise<string | null>>();

  constructor() {
    this.store.onQueued = () => this.schedule(400);
    this.net.onChange((online) => (online ? this.schedule(0, true) : this.state.set(this.active() ? 'offline' : 'local')));
    effect(() => {
      const loaded = this.store.loaded();
      const scope = this.store.scope();
      if (loaded && scope !== 'guest' && this.active()) untracked(() => this.schedule(0, true));
      if (!this.active()) untracked(() => this.state.set('local'));
    });
    // Private media URLs are blob: URLs of authenticated downloads: drop them when the account changes.
    effect(() => {
      this.auth.scope();
      untracked(() => this.revokeMedia());
    });
  }

  /** Debounced flush (+ optional pull). */
  schedule(delay = 400, pull = false): void {
    if (!this.active()) return;
    if (pull) this.pullRequested = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delay);
  }

  async run(): Promise<void> {
    if (!this.active()) return;
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        if (!this.net.online()) {
          this.state.set('offline');
          await this.countPending();
          break;
        }
        this.state.set('syncing');
        try {
          await this.loadRevisions(this.store.scope());
          await this.flush();
          if (this.pullRequested) {
            this.pullRequested = false;
            await this.pull();
          }
          this.lastError.set(null);
          this.state.set('idle');
          this.retryDelay = 0;
        } catch (e) {
          if (e instanceof AuthExpired) {
            this.state.set('error');
            this.lastError.set('session expired');
            await this.auth.expire(); // local data stays on the device; sign in again to resume syncing
            await this.countPending();
            break;
          }
          this.state.set(e instanceof NetworkFailure ? 'offline' : 'error');
          this.lastError.set(e instanceof Error ? e.message : String(e));
          // Server unreachable while the device reports "online": retry with backoff (5s -> 5min).
          this.retryDelay = Math.min(300_000, Math.max(5_000, this.retryDelay * 2));
          this.schedule(this.retryDelay, true);
        }
        await this.countPending();
      } while (this.again);
    })().finally(() => (this.running = null));
    return this.running;
  }

  private async countPending(): Promise<void> {
    const scope = this.store.scope();
    this.pending.set(scope === 'guest' ? 0 : (await this.db.outbox(scope)).length);
  }

  /* ------------------------------------------------------------------ */
  /* revisions (optimistic-concurrency base, persisted per scope)        */
  /* ------------------------------------------------------------------ */

  private async loadRevisions(scope: Scope): Promise<void> {
    if (this.revScope === scope) return;
    this.revs = await this.db.revisions(scope);
    this.revScope = scope;
  }

  private rev(key: string): number {
    return this.revs.get(key) ?? 0;
  }

  private async setRev(key: string, rev: number): Promise<void> {
    if (!this.revScope) return;
    if (rev > 0) this.revs.set(key, rev);
    else this.revs.delete(key);
    await this.db.setRevision(this.revScope, key, rev);
  }

  /* ------------------------------------------------------------------ */
  /* push                                                                */
  /* ------------------------------------------------------------------ */

  private async flush(): Promise<void> {
    const scope = this.store.scope();
    if (scope === 'guest' || scope !== this.auth.scope()) return;
    const entries = (await this.db.outbox(scope)).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.queuedAt - b.queuedAt);
    for (const e of entries) {
      if (this.store.scope() !== scope) return; // the user switched accounts mid-flush: never push another scope's data
      try {
        await this.push(e);
        await this.db.dequeue(e); // only after the server confirmed
      } catch (err) {
        if (err instanceof NetworkFailure || err instanceof AuthExpired) throw err;
        console.warn('[sync] push failed', e.kind, e.id, err);
        if (e.attempts + 1 >= MAX_ATTEMPTS) {
          // Stop retrying, but never silently: keep what we tried to send and tell the user.
          await this.keepBackup(e.kind, e.id, this.labelFor(e), this.snapshotFor(e), 'rejected');
          await this.db.dequeue(e);
        } else await this.db.bumpAttempts(e);
      }
    }
  }

  /** Human label for notices. */
  private labelFor(e: OutboxEntry): string {
    switch (e.kind) {
      case 'project': case 'progress': case 'note': case 'cover': return this.store.project(e.id)?.name ?? '';
      case 'photo': return this.store.project((e.payload as { projectId?: string } | undefined)?.projectId)?.name ?? '';
      case 'pattern': return this.store.pattern(e.id)?.name ?? '';
      case 'collection': return this.store.collection(e.id)?.name ?? '';
      default: return '';
    }
  }

  /** What the device holds for an outbox entry right now (used for conflict backups). */
  private snapshotFor(e: OutboxEntry): unknown {
    switch (e.kind) {
      case 'project': return this.store.project(e.id);
      case 'progress': {
        const p = this.store.project(e.id);
        return p ? { tracker: p.tracker, parts: p.parts ?? null, activeInstanceId: p.activeInstanceId ?? null, patternPin: p.patternPin ?? null } : null;
      }
      case 'note': return { notes: this.store.project(e.id)?.notes ?? '' };
      case 'pattern': return this.store.pattern(e.id);
      case 'collection': return this.store.collection(e.id);
      case 'profile': case 'tools': return this.store.profile();
      case 'tutorial': return this.store.tutorial(e.id);
      default: return e.payload ?? null;
    }
  }

  /**
   * Keeps a local change that is about to lose (server newer / rejected) in IndexedDB and raises a notice, so unsynced
   * progress is never discarded without a trace. The list is capped; the newest entries are kept.
   */
  private async keepBackup(kind: OutboxKind, entityId: string, label: string, snapshot: unknown, reason: ConflictBackup['reason']): Promise<void> {
    const scope = this.store.scope();
    if (scope === 'guest') return;
    const docs = await this.db.loadDocs(scope);
    const backup: ConflictBackup = { id: uuid(), at: Date.now(), kind, entityId, label, reason, snapshot: JSON.parse(JSON.stringify(snapshot ?? null)) };
    await this.db.patchDocs(scope, { conflicts: [...(docs.conflicts ?? []), backup].slice(-MAX_BACKUPS) });
    this.conflictNotice.set({ kind, label, reason, at: backup.at });
  }

  /** Runs an API call and classifies failures for the retry policy. */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.isUnauthorized) throw new AuthExpired(e.message);
        if (e.isNetwork) throw new NetworkFailure(e.message);
        throw new Error(`${e.status} ${e.code} ${e.message}`.trim(), { cause: e }); // keeps the ApiError (e.g. 409 + current revision)
      }
      throw e;
    }
  }

  /**
   * Versioned upsert with deterministic conflict resolution (see class doc).
   * Returns 'applied' or 'superseded' (the server already holds same-or-newer data).
   */
  private async versioned(
    key: string,
    path: string,
    localTs: number,
    body: Record<string, unknown>,
    info: {
      kind: OutboxKind;
      id: string;
      label: string;
      ahead?: (cur: ConflictCurrent) => 'ahead' | 'same' | 'behind';
      /**
       * Multi-part progress only: merge the server's per-piece state into the local one (written to the store) and return the rebuilt
       * request. Returning null falls back to the ordinary rules. Nothing is overwritten wholesale, so a piece worked on by another
       * device keeps its progress.
       */
      merge?: (cur: ConflictCurrent) => Promise<{ body: Record<string, unknown>; localTs: number } | null>;
    },
  ): Promise<'applied' | 'superseded'> {
    for (let attempt = 0; attempt <= MAX_REBASES; attempt++) {
      try {
        const r = await this.call(() => this.api.put<Accepted>(path, { ...body, baseRevision: this.rev(key), clientUpdatedAt: localTs }));
        await this.setRev(key, r.revision);
        return 'applied';
      } catch (e) {
        const cause = e instanceof Error && 'cause' in e ? (e.cause as unknown) : null;
        const conflict = cause instanceof ApiError && cause.isConflict ? cause : null;
        if (!conflict?.current) throw e;
        const cur = conflict.current;
        await this.setRev(key, cur.revision);

        // 1) Same clientUpdatedAt = our earlier attempt already reached the server (lost response): nothing to do, nothing lost.
        if (!cur.deleted && cur.clientUpdatedAt === localTs) {
          this.pullRequested = true;
          return 'superseded';
        }
        // 1b) Multi-part projects: merge piece by piece and retry with the merged state (never a whole-blob overwrite).
        if (!cur.deleted && info.merge) {
          const merged = await info.merge(cur);
          if (merged) {
            body = merged.body;
            localTs = merged.localTs;
            continue;
          }
        }
        // 2) Tracker progress: the further-along position always wins, whatever the clocks say, so no stitches are thrown away.
        const rel = cur.deleted ? 'behind' : (info.ahead?.(cur) ?? 'behind');
        if (rel === 'same') {
          this.pullRequested = true;
          return 'superseded'; // the server is at the same position: our write adds nothing
        }
        // 3) Otherwise the newer write wins (last-write-wins between a user's own devices). Server newer: rebase only if ours is newer.
        if (!cur.deleted && (rel === 'ahead' || localTs > cur.clientUpdatedAt)) continue;

        // The server's version wins. Keep ours so it is never silently discarded, then adopt the server state.
        await this.keepBackup(info.kind, info.id, info.label, body, cur.deleted ? 'deleted' : 'newer-on-server');
        this.pullRequested = true;
        return 'superseded';
      }
    }
    throw new Error(`conflict on ${key} did not settle`);
  }

  private async push(e: OutboxEntry): Promise<void> {
    const project = () => this.store.project(e.id);
    const key = `${e.kind}|${e.id}`;

    switch (e.kind) {
      case 'profile': {
        const p = this.store.profile();
        await this.versioned(key, '/v1/profile', p.updatedAt, {
          displayName: p.displayName.slice(0, 80), level: p.level, terms: p.terms, locale: document.documentElement.lang === 'en' ? 'en' : 'ar',
          interests: [...p.interests], onboarded: p.onboarded,
          // Omitted (never null) until a preset is chosen, so an unset device can't clear another device's choice.
          ...(p.avatarId ? { avatarId: p.avatarId } : {}),
        }, { kind: 'profile', id: e.id, label: '' });
        return;
      }
      case 'tools': {
        const p = this.store.profile();
        await this.versioned(key, '/v1/tools', p.updatedAt, { hooks: [...p.hooks], yarns: [...p.yarns], accessories: [...p.accessories] }, { kind: 'tools', id: e.id, label: '' });
        return;
      }
      case 'pattern': {
        if (e.op === 'delete') {
          await this.call(() => this.api.delete(`/v1/patterns/${e.id}`));
          await this.setRev(key, 0);
          return;
        }
        const p = this.store.pattern(e.id);
        if (!p || p.isSample) return;
        const parsed = parsePattern(p.text);
        await this.versioned(key, `/v1/patterns/${p.id}`, p.updatedAt, {
          name: p.name.slice(0, 120), level: p.level, terms: p.terms, sourceType: p.source === 'sample' ? 'text' : p.source,
          sourceUrl: p.sourceUrl ? p.sourceUrl.slice(0, 500) : null, attribution: p.attribution ? p.attribution.slice(0, 200) : null,
          rawText: p.text.slice(0, 20000), readingPosition: Math.max(0, Math.trunc(p.position)), contentRev: Math.max(1, p.rev ?? 1), suggestedMinutes: Math.max(0, Math.trunc(p.suggestedMinutes ?? 0)), sourceText: (p.sourceText ?? '').slice(0, 40000),
          rounds: parsed.rounds.slice(0, 500).map((r) => ({ n: r.n, raw: r.raw.slice(0, 500), ok: r.ok, cons: r.cons, prod: r.prod, declared: r.declared })),
        }, { kind: 'pattern', id: e.id, label: p.name });
        return;
      }
      case 'collection': {
        if (e.op === 'delete') {
          await this.call(() => this.api.delete(`/v1/collections/${e.id}`));
          await this.setRev(key, 0);
          return;
        }
        const c = this.store.collection(e.id);
        if (!c) return;
        await this.versioned(key, `/v1/collections/${c.id}`, c.updatedAt, {
          name: c.name.slice(0, 120), description: c.description.slice(0, 2000), level: c.level, terms: c.terms,
          coverData: c.coverLocalUrl && c.coverLocalUrl.length <= 220_000 ? c.coverLocalUrl : null,
          contentRev: Math.max(1, c.rev), suggestedMinutes: Math.max(0, Math.trunc(c.suggestedMinutes)), sourceText: c.sourceText.slice(0, 60000),
          parts: c.parts.slice(0, 30).map((x) => ({ id: x.id, name: x.name.slice(0, 80), quantity: x.quantity, rawText: x.text.slice(0, 20000), assemblyNotes: x.assemblyNotes.slice(0, 4000) })),
        }, { kind: 'collection', id: e.id, label: c.name });
        return;
      }
      case 'patternrev': {
        // Immutable and idempotent by (kind, entity, rev): the server keeps the first write, so a retry can never rewrite history.
        const r = this.store.patternRevs().find((x) => x.id === e.id);
        if (!r) return;
        const snapshot = r.kind === 'pattern'
          ? { terms: r.terms, text: (r.text ?? '').slice(0, 20000) }
          : { terms: r.terms, parts: (r.parts ?? []).slice(0, 30).map((x) => ({ id: x.id, name: x.name.slice(0, 80), quantity: x.quantity, rawText: x.text.slice(0, 20000), assemblyNotes: x.assemblyNotes.slice(0, 4000) })) };
        await this.call(() => this.api.put(`/v1/revisions/${r.kind}/${r.entityId}/${r.rev}`, { name: r.name.slice(0, 120), createdAt: r.at, snapshot }));
        return;
      }
      case 'project': {
        if (e.op === 'delete') {
          await this.call(() => this.api.delete(`/v1/projects/${e.id}`)); // the server also removes the project's R2 objects
          await this.setRev(key, 0);
          return;
        }
        const p = project();
        if (!p) return;
        await this.versioned(key, `/v1/projects/${p.id}`, p.updatedAt, {
          name: p.name.slice(0, 120), category: p.category, hookSize: p.hook, yarnType: p.yarn, status: p.status, patternId: p.tracker.patternId, collectionId: p.collectionId ?? null,
          estimatedHours: p.estimatedHours, workedSeconds: p.workedSeconds, lastWorkedAt: p.lastWorkedAt, createdAt: p.createdAt,
        }, { kind: 'project', id: e.id, label: p.name });
        return;
      }
      case 'progress': {
        const p = project();
        if (!p) return;
        const t = p.tracker;
        await this.versioned(key, `/v1/projects/${p.id}/progress`, t.updatedAt, {
          mode: t.mode, round: t.simple.round, target: t.simple.target, perTap: t.simple.perTap, count: t.simple.count, totalRounds: t.simple.totalRounds,
          patternId: t.patternId, patternRoundIndex: t.cursor.roundIndex, actionPtr: t.cursor.ptr, countMode: t.cursor.mode,
          history: t.simple.history.slice(-100), patternHistory: t.cursor.history.slice(-100),
          multiState: p.parts?.length && p.collectionId ? this.multiStateBody(p) : null,
          patternSnapshot: p.patternPin ? { rev: p.patternPin.rev, name: p.patternPin.name.slice(0, 120), text: p.patternPin.text.slice(0, 20000), terms: p.patternPin.terms } : null,
        }, {
          kind: 'progress', id: e.id, label: p.name,
          merge: p.parts?.length && p.collectionId ? (cur) => this.mergeMultiConflict(e.id, cur) : undefined,
          ahead: (cur) => {
            const s = cur.state;
            if (p.parts?.length && s?.multi != null) {
              const mine = multiPosition(p.parts);
              return mine > s.multi ? 'ahead' : mine === s.multi ? 'same' : 'behind';
            }
            if (!s || s.mode !== t.mode) return 'behind'; // different counting modes are not comparable: fall back to the clock rule
            const mine = position(t.mode, t.simple.round, t.simple.count, t.cursor.roundIndex, t.cursor.ptr);
            const theirs = position(s.mode, s.round, s.count, s.patternRoundIndex, s.actionPtr);
            return mine > theirs ? 'ahead' : mine === theirs ? 'same' : 'behind';
          },
        });
        return;
      }
      case 'note': {
        const p = project();
        if (!p) return;
        await this.versioned(key, `/v1/projects/${p.id}/notes`, p.updatedAt, { body: p.notes.slice(0, 10000) }, { kind: 'note', id: e.id, label: p.name });
        return;
      }
      case 'cover': {
        const p = project();
        if (!p?.coverLocalUrl) return;
        const stored = await this.call(() => this.api.putBytes<MediaStored>(`/v1/media/project-covers/${p.id}`, dataUrlToBlob(p.coverLocalUrl!)));
        await this.store.updateProject(p.id, (x) => ({ ...x, coverPath: stored.key }), []);
        return;
      }
      case 'photo': {
        const pid = (e.payload as { projectId?: string } | undefined)?.projectId;
        const p = this.store.project(pid);
        if (!p) return;
        if (e.op === 'delete') {
          const path = (e.payload as { storagePath?: string }).storagePath;
          if (path) await this.call(() => this.api.delete('/v1/media/object', { key: path }));
          return;
        }
        const ph = p.photos.find((x) => x.id === e.id);
        if (!ph?.localUrl) return;
        const stored = await this.call(() => this.api.putBytes<MediaStored>(`/v1/media/project-photos/${p.id}/${ph.id}`, dataUrlToBlob(ph.localUrl!)));
        await this.store.updateProject(p.id, (x) => ({ ...x, photos: x.photos.map((y) => (y.id === ph.id ? { ...y, storagePath: stored.key } : y)) }), []);
        return;
      }
      case 'session': {
        const s = e.payload as { projectId: string; startedAt: number; endedAt: number; seconds: number; partInstanceId?: string | null };
        if (!this.store.project(s.projectId)) return;
        await this.call(() => this.api.put(`/v1/sessions/${e.id}`, { projectId: s.projectId, startedAt: s.startedAt, endedAt: s.endedAt, seconds: s.seconds, partInstanceId: s.partInstanceId ?? null }));
        return;
      }
      case 'favorite': {
        if (e.op === 'delete') await this.call(() => this.api.delete(`/v1/favorites/${encodeURIComponent(e.id)}`));
        else await this.call(() => this.api.put(`/v1/favorites/${encodeURIComponent(e.id)}`));
        return;
      }
      case 'tutorial': {
        const t = this.store.tutorial(e.id);
        const yt = /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(t.link) ? t.link.slice(0, 500) : null;
        await this.versioned(key, `/v1/tutorials/${encodeURIComponent(e.id)}`, t.updatedAt, {
          youtubeUrl: yt, creatorName: t.creator ? t.creator.slice(0, 120) : null, projectId: t.projectId && this.store.project(t.projectId) ? t.projectId : null,
          notes: t.notes.slice(0, 10000), stamps: t.stamps.slice(0, 500).map((s) => ({ id: s.id, seconds: s.sec, note: s.note.slice(0, 300) })),
        }, { kind: 'tutorial', id: e.id, label: '' });
        return;
      }
      case 'interest': {
        if (e.op === 'delete') await this.call(() => this.api.delete('/v1/interest'));
        else await this.call(() => this.api.put('/v1/interest', { email: this.store.storeEmail().trim() }));
        return;
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* pull & merge                                                        */
  /* ------------------------------------------------------------------ */

  private async pull(): Promise<void> {
    const scope = this.store.scope();
    if (scope === 'guest' || scope !== this.auth.scope()) return;
    const r = await this.call(() => this.api.get<PullResponse>('/v1/sync/pull'));
    // Re-read the outbox AFTER the response: edits queued while the request was in flight stay "dirty".
    const dirty = new Set((await this.db.outbox(scope)).map((o) => `${o.kind}|${o.id}`));
    if (this.store.scope() !== scope) return; // user switched meanwhile
    await this.recordRevisions(r, dirty);
    if (this.store.scope() !== scope) return;

    // ---- Everything below, up to the signal updates in applyMerged(), is synchronous: a project created or
    // ---- edited while this pull was running can therefore never be dropped or overwritten by a stale snapshot.
    let profileAdopted = false;
    const lp = this.store.profile();
    if (r.profile && !dirty.has('profile|me') && r.profile.clientUpdatedAt > lp.updatedAt) {
      const next: Profile = {
        ...lp, displayName: r.profile.displayName, level: r.profile.level as LevelId, terms: r.profile.terms as 'us' | 'uk',
        interests: r.profile.interests as CategoryId[], onboarded: r.profile.onboarded, updatedAt: r.profile.clientUpdatedAt,
        avatarId: toAvatarId(r.profile.avatarId) ?? lp.avatarId,
      };
      if (!dirty.has('tools|me') && (r.tools.length || r.profile.onboarded)) {
        Object.assign(next, {
          hooks: r.tools.filter((t) => t.kind === 'hook').map((t) => t.value),
          yarns: r.tools.filter((t) => t.kind === 'yarn').map((t) => t.value as YarnId),
          accessories: r.tools.filter((t) => t.kind === 'accessory').map((t) => t.value as AccessoryId),
        });
      }
      this.store.profile.set(next);
      profileAdopted = true;
    }

    // patterns
    const localPats = this.store.patterns();
    const remotePats = new Map(r.patterns.map((x) => [x.id, x]));
    // Keep anything the server has never confirmed (revision 0): it is a pending creation, not a remote deletion.
    const mergedPats: Pattern[] = localPats.filter((p) => p.isSample || remotePats.has(p.id) || dirty.has(`pattern|${p.id}`) || this.rev(`pattern|${p.id}`) === 0);
    for (const x of remotePats.values()) {
      const local = mergedPats.find((p) => p.id === x.id);
      if (local && (dirty.has(`pattern|${x.id}`) || local.updatedAt >= x.clientUpdatedAt)) {
        // keep the local text, but learn about a file uploaded from another device
        if (local && !dirty.has(`pattern|${x.id}`) && x.fileName && local.file?.storagePath !== x.filePath) {
          mergedPats.splice(mergedPats.indexOf(local), 1, { ...local, file: { name: x.fileName, size: x.fileSize ?? 0, mime: x.fileMime ?? '', storagePath: x.filePath } });
        }
        continue;
      }
      const pat: Pattern = {
        id: x.id, isSample: false, name: x.name, level: x.level as LevelId, terms: x.terms as 'us' | 'uk', source: x.sourceType as Pattern['source'],
        text: x.rawText, attribution: x.attribution ?? '', sourceUrl: x.sourceUrl ?? '', position: x.readingPosition,
        file: x.fileName ? { name: x.fileName, size: x.fileSize ?? 0, mime: x.fileMime ?? '', storagePath: x.filePath } : null,
        rev: x.contentRev ?? 1, suggestedMinutes: x.suggestedMinutes ?? 0, sourceText: x.sourceText ?? '',
        updatedAt: x.clientUpdatedAt, deletedAt: null,
      };
      if (local) mergedPats.splice(mergedPats.indexOf(local), 1, pat);
      else mergedPats.push(pat);
    }

    // collections (same merge rules as patterns: pending local changes win and are pushed; never-confirmed ones are kept)
    const remoteCols = new Map((r.collections ?? []).map((x) => [x.id, x]));
    const mergedCols: PatternCollection[] = this.store.collections().filter((c) => remoteCols.has(c.id) || dirty.has(`collection|${c.id}`) || this.rev(`collection|${c.id}`) === 0);
    for (const x of remoteCols.values()) {
      const local = mergedCols.find((c) => c.id === x.id);
      if (local && (dirty.has(`collection|${x.id}`) || local.updatedAt >= x.clientUpdatedAt)) continue;
      const col: PatternCollection = {
        id: x.id, name: x.name, description: x.description, level: x.level as LevelId, terms: x.terms as 'us' | 'uk', coverLocalUrl: x.coverData,
        parts: x.parts.map((pt) => ({ id: pt.id, name: pt.name, quantity: pt.quantity, text: pt.rawText, assemblyNotes: pt.assemblyNotes })),
        rev: x.contentRev, suggestedMinutes: x.suggestedMinutes, sourceText: x.sourceText, createdAt: x.createdAt, updatedAt: x.clientUpdatedAt, deletedAt: null,
      };
      if (local) mergedCols.splice(mergedCols.indexOf(local), 1, col);
      else mergedCols.push(col);
    }
    // revision history is append-only: adopt what the server has that this device lacks
    const localRevIds = new Set(this.store.patternRevs().map((x) => x.id));
    const newRevs: PatternRevision[] = (r.revisions ?? [])
      .filter((x) => x.snapshot && !localRevIds.has(`${x.entityKind}:${x.entityId}:${x.rev}`))
      .map((x) => ({
        id: `${x.entityKind}:${x.entityId}:${x.rev}`, kind: x.entityKind, entityId: x.entityId, rev: x.rev, name: x.name, terms: x.snapshot!.terms, at: x.createdAt,
        ...(x.entityKind === 'pattern' ? { text: x.snapshot!.text ?? '' } : { parts: (x.snapshot!.parts ?? []).map((pt) => ({ id: pt.id, name: pt.name, quantity: pt.quantity, text: pt.rawText, assemblyNotes: pt.assemblyNotes })) }),
      }));

    // projects (+ progress, notes, photos)
    const progBy = new Map(r.progress.map((x) => [x.projectId, x]));
    const noteBy = new Map(r.notes.map((x) => [x.projectId, x]));
    const localProjects = this.store.projects();
    const remoteIds = new Set(r.projects.map((x) => x.id));
    const merged: Project[] = localProjects.filter((p) => remoteIds.has(p.id) || dirty.has(`project|${p.id}`) || this.rev(`project|${p.id}`) === 0);
    for (const x of r.projects) {
      const local = merged.find((p) => p.id === x.id);
      const pr = progBy.get(x.id);
      const note = noteBy.get(x.id);
      const remotePhotos: ProjectPhoto[] = r.photos
        .filter((ph) => ph.projectId === x.id)
        .map((ph) => ({ id: ph.id, storagePath: ph.storagePath, localUrl: local?.photos.find((lp2) => lp2.id === ph.id)?.localUrl ?? null, createdAt: ph.createdAt }));
      const keepLocalPhotos = (local?.photos ?? []).filter((ph) => !remotePhotos.some((y) => y.id === ph.id));
      const projDirty = dirty.has(`project|${x.id}`) || (!!local && local.updatedAt > x.clientUpdatedAt);
      const progDirty = dirty.has(`progress|${x.id}`) || (!!local && !!pr && local.tracker.updatedAt > pr.clientUpdatedAt);
      const base: Project =
        local && projDirty
          ? { ...local, coverPath: x.coverPath ?? local.coverPath }
          : {
              id: x.id, name: x.name, category: x.category as CategoryId, hook: x.hookSize, yarn: x.yarnType as YarnId, status: x.status as Project['status'],
              collectionId: x.collectionId ?? null,
              notes: local?.notes ?? '', coverLocalUrl: local && local.coverPath === x.coverPath ? local.coverLocalUrl : null, coverPath: x.coverPath,
              photos: [], workedSeconds: x.workedSeconds, estimatedHours: x.estimatedHours, lastWorkedAt: x.lastWorkedAt,
              createdAt: x.createdAt, updatedAt: x.clientUpdatedAt, deletedAt: null, tracker: local?.tracker ?? this.emptyTracker(),
            };
      const tracker =
        pr && !progDirty
          ? {
              mode: pr.mode as 'simple' | 'pattern',
              simple: createSimpleCounter({ round: pr.round, target: pr.target, perTap: pr.perTap, count: pr.count, totalRounds: pr.totalRounds, history: (pr.history as never) ?? [] }),
              patternId: pr.patternId,
              cursor: createPatternCursor({ roundIndex: pr.patternRoundIndex, ptr: pr.actionPtr, mode: pr.countMode as 'action', history: (pr.patternHistory as never) ?? [] }),
              updatedAt: pr.clientUpdatedAt,
            }
          : base.tracker;
      const notesText = note && !dirty.has(`note|${x.id}`) && (!local || note.clientUpdatedAt >= local.updatedAt || !projDirty) ? note.body : base.notes;
      const multi = pr && !progDirty ? this.multiFromPull(pr) : local ? { parts: local.parts, partSnapshots: local.partSnapshots, activeInstanceId: local.activeInstanceId, collectionRev: local.collectionRev, patternPin: local.patternPin } : {};
      const next: Project = { ...base, ...multi, tracker, notes: notesText, photos: [...remotePhotos, ...keepLocalPhotos] };
      if (local) merged.splice(merged.indexOf(local), 1, next);
      else merged.push(next);
    }

    // favourites, tutorials, store interest
    const favList = [...dirty].some((d) => d.startsWith('favorite|')) ? this.store.favorites() : r.favorites;
    const tutorials: Record<string, TutorialData> = { ...this.store.tutorials() };
    for (const b of r.tutorials) {
      if (dirty.has(`tutorial|${b.tutorialId}`) || (tutorials[b.tutorialId]?.updatedAt ?? 0) > b.clientUpdatedAt) continue;
      tutorials[b.tutorialId] = {
        tutorialId: b.tutorialId, link: b.youtubeUrl ?? '', creator: b.creatorName ?? '', notes: b.notes, projectId: b.projectId, updatedAt: b.clientUpdatedAt,
        stamps: b.stamps.map((s) => ({ id: s.id, sec: s.seconds, note: s.note })).sort((a, z) => a.sec - z.sec),
      };
    }

    await this.applyMerged(scope, merged, mergedPats, favList, tutorials, dirty.has('interest|me') ? null : (r.interest ?? ''), profileAdopted, mergedCols, newRevs);
  }

  /**
   * Remembers the server revision of every non-dirty entity (the base for its next local edit) and forgets
   * entities that no longer exist remotely. Dirty entities keep their old base so their push surfaces the conflict.
   */
  private async recordRevisions(r: PullResponse, dirty: Set<string>): Promise<void> {
    const server = new Map<string, number>();
    if (r.profile) {
      server.set('profile|me', r.profile.revision);
      if (r.profile.toolsRevision > 0) server.set('tools|me', r.profile.toolsRevision);
    }
    for (const x of r.patterns) server.set(`pattern|${x.id}`, x.revision);
    for (const x of r.collections ?? []) server.set(`collection|${x.id}`, x.revision);
    for (const x of r.projects) server.set(`project|${x.id}`, x.revision);
    for (const x of r.progress) server.set(`progress|${x.projectId}`, x.revision);
    for (const x of r.notes) server.set(`note|${x.projectId}`, x.revision);
    for (const x of r.tutorials) server.set(`tutorial|${x.tutorialId}`, x.revision);

    for (const [key, rev] of server) if (!dirty.has(key) && this.rev(key) !== rev) await this.setRev(key, rev);
    for (const key of [...this.revs.keys()]) {
      if (!server.has(key) && !dirty.has(key) && VERSIONED.has(key.slice(0, key.indexOf('|')))) await this.setRev(key, 0);
    }
  }

  /**
   * 1) Publishes the merged state to the signals in ONE synchronous turn (no await before it).
   * 2) Persists what is *now* in memory, so an edit the user makes while IndexedDB is being written is never
   *    overwritten by the stale merge result, and a project deleted meanwhile is never resurrected.
   */
  private async applyMerged(
    scope: string,
    projects: Project[],
    patterns: Pattern[],
    favorites: string[],
    tutorials: Record<string, TutorialData>,
    interestEmail: string | null,
    profileAdopted: boolean,
    collections: PatternCollection[],
    newRevs: PatternRevision[],
  ): Promise<void> {
    const s = scope as `user:${string}`;
    const oldProjects = this.store.projects();
    const oldPatterns = this.store.patterns();
    const oldCollections = this.store.collections();

    this.store.projects.set(projects);
    this.store.patterns.set(patterns);
    this.store.collections.set(collections);
    if (newRevs.length) this.store.patternRevs.update((l) => [...l, ...newRevs]);
    this.store.favorites.set(favorites);
    this.store.tutorials.set(tutorials);
    if (interestEmail !== null) {
      this.store.storeEmail.set(interestEmail);
      this.store.storeNotified.set(!!interestEmail);
    }

    const same = () => this.store.scope() === scope;
    for (const p of oldProjects) if (same() && !projects.some((x) => x.id === p.id)) await this.db.removeProject(s, p.id);
    for (const p of projects) {
      const cur = this.store.project(p.id);
      if (same() && cur) await this.db.putProject(s, cur);
    }
    for (const p of oldPatterns) if (same() && !p.isSample && !patterns.some((x) => x.id === p.id)) await this.db.removePattern(s, p.id);
    for (const p of patterns) {
      const cur = this.store.pattern(p.id);
      if (same() && cur && !cur.isSample) await this.db.putPattern(s, cur);
    }
    for (const c of oldCollections) if (same() && !collections.some((x) => x.id === c.id)) await this.db.removeCollection(s, c.id);
    for (const c of collections) {
      const cur = this.store.collection(c.id);
      if (same() && cur) await this.db.putCollection(s, cur);
    }
    for (const rv of newRevs) if (same()) await this.db.putPatternRev(s, rv);
    if (!same()) return;
    await this.db.patchDocs(s, {
      favorites: this.store.favorites(),
      tutorials: this.store.tutorials(),
      lastSyncAt: Date.now(),
      ...(profileAdopted ? { profile: this.store.profile() } : {}),
      ...(interestEmail !== null ? { storeEmail: this.store.storeEmail(), storeNotified: this.store.storeNotified() } : {}),
    });
  }

  /**
   * A progress push lost to another device's newer revision of a MULTI-PART project: keep this device's copy as a recoverable backup,
   * merge the two states piece by piece into the store, and rebuild the push body from the merged result.
   */
  private async mergeMultiConflict(projectId: string, cur: ConflictCurrent): Promise<{ body: Record<string, unknown>; localTs: number } | null> {
    const remote = cur.state?.multiState;
    const local = this.store.project(projectId);
    if (!remote || !local?.parts?.length || !local.collectionId) return null;
    const wire = this.multiFromPull({ multiState: remote } as PullProgress);
    const remoteParts: readonly PartInstance[] = wire.parts ?? [];
    const remoteSnaps = wire.partSnapshots ?? [];
    await this.keepBackup('progress', projectId, local.name, { tracker: local.tracker, parts: local.parts, activeInstanceId: local.activeInstanceId ?? null }, 'newer-on-server');
    const parts = mergeInstances(local.parts, remoteParts);
    const snapshots = mergeSnapshots(local.partSnapshots ?? [], local.collectionRev ?? 1, remoteSnaps, remote.collectionRev);
    const active = parts.some((i) => i.id === local.activeInstanceId) ? local.activeInstanceId : remote.activeInstanceId;
    const now = Date.now();
    const next = await this.store.updateProject(
      projectId,
      (p) => ({ ...p, parts, partSnapshots: snapshots, activeInstanceId: active ?? null, collectionRev: Math.max(p.collectionRev ?? 1, remote.collectionRev), tracker: { ...p.tracker, updatedAt: now } }),
      [], // we are pushing right now: no new outbox entry needed
    );
    if (!next) return null;
    const t = next.tracker;
    return {
      localTs: t.updatedAt,
      body: {
        mode: t.mode, round: t.simple.round, target: t.simple.target, perTap: t.simple.perTap, count: t.simple.count, totalRounds: t.simple.totalRounds,
        patternId: t.patternId, patternRoundIndex: t.cursor.roundIndex, actionPtr: t.cursor.ptr, countMode: t.cursor.mode,
        history: t.simple.history.slice(-100), patternHistory: t.cursor.history.slice(-100),
        multiState: this.multiStateBody(next),
        patternSnapshot: next.patternPin ? { rev: next.patternPin.rev, name: next.patternPin.name.slice(0, 120), text: next.patternPin.text.slice(0, 20000), terms: next.patternPin.terms } : null,
      },
    };
  }

  /** Wire body of a multi-part project's state (history capped: the undo stack of each piece stays small on the wire). */
  private multiStateBody(p: Project): Record<string, unknown> {
    return {
      collectionId: p.collectionId,
      collectionRev: Math.max(1, p.collectionRev ?? 1),
      activeInstanceId: p.activeInstanceId ?? null,
      snapshots: (p.partSnapshots ?? []).map((s) => ({ partId: s.partId, name: s.name, quantity: s.quantity, text: s.text.slice(0, 20000), assemblyNotes: s.assemblyNotes.slice(0, 4000), terms: s.terms ?? 'us' })),
      instances: (p.parts ?? []).map((i) => ({
        id: i.id, partId: i.partId, index: i.index, mode: i.mode,
        simple: { round: i.simple.round, target: i.simple.target, perTap: i.simple.perTap, count: i.simple.count, totalRounds: i.simple.totalRounds, history: i.simple.history.slice(-50) },
        cursor: { roundIndex: i.cursor.roundIndex, ptr: i.cursor.ptr, mode: i.cursor.mode, history: i.cursor.history.slice(-50) },
        workedSeconds: Math.max(0, Math.trunc(i.workedSeconds)), updatedAt: i.updatedAt, ...(i.retired ? { retired: true } : {}),
      })),
    };
  }

  private multiFromPull(pr: PullProgress): Partial<Project> {
    const ms: PullMultiState | null | undefined = pr.multiState;
    const patternPin = pr.patternSnapshot ?? null;
    if (!ms) return { parts: undefined, partSnapshots: undefined, activeInstanceId: undefined, collectionRev: undefined, patternPin };
    return {
      collectionRev: ms.collectionRev,
      activeInstanceId: ms.activeInstanceId,
      partSnapshots: ms.snapshots.map((s) => ({ partId: s.partId, name: s.name, quantity: s.quantity, text: s.text, assemblyNotes: s.assemblyNotes, terms: s.terms })),
      parts: ms.instances.map((i) => ({
        id: i.id, partId: i.partId, index: i.index, mode: i.mode,
        simple: createSimpleCounter({ round: i.simple.round, target: i.simple.target, perTap: i.simple.perTap, count: i.simple.count, totalRounds: i.simple.totalRounds, history: i.simple.history as never }),
        cursor: createPatternCursor({ roundIndex: i.cursor.roundIndex, ptr: i.cursor.ptr, mode: i.cursor.mode, history: i.cursor.history as never }),
        workedSeconds: i.workedSeconds, updatedAt: i.updatedAt, ...(i.retired ? { retired: true } : {}),
      })),
      patternPin,
    };
  }

  private emptyTracker(): Project['tracker'] {
    return { mode: 'simple', simple: createSimpleCounter(), patternId: null, cursor: createPatternCursor(), updatedAt: 0 };
  }

  /* ------------------------------------------------------------------ */
  /* private media                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Object URL for a private R2 file. The Worker only serves files to their owner with a bearer token, so an
   * <img src> cannot fetch it directly: the bytes are downloaded through the API and exposed as a blob: URL
   * (cached per file, revoked when the account changes).
   */
  mediaUrl(path: string): Promise<string | null> {
    if (!this.active() || !path) return Promise.resolve(null);
    let hit = this.media.get(path);
    if (!hit) {
      hit = this.api
        .getBlob('/v1/media/object', { key: path })
        .then((blob) => URL.createObjectURL(blob))
        .catch(() => {
          this.media.delete(path); // allow a retry (offline, token refresh, ...)
          return null;
        });
      this.media.set(path, hit);
    }
    return hit;
  }

  private revokeMedia(): void {
    for (const p of this.media.values()) void p.then((u) => u && URL.revokeObjectURL(u));
    this.media.clear();
  }

  /**
   * Uploads a pattern reference file (PDF / image) and returns its storage key. The pattern row must exist on
   * the server first, so the outbox is flushed before (and, if needed, once more after) the first attempt.
   */
  async uploadPatternFile(patternId: string, file: File): Promise<string | null> {
    if (!this.active() || !this.net.online()) return null;
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.run();
      try {
        const stored = await this.api.putBytes<MediaStored>(`/v1/media/pattern-files/${patternId}`, file, { 'X-File-Name': encodeURIComponent(file.name).slice(0, 120) });
        return stored.key;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404 && attempt < 2) {
          await new Promise((res) => setTimeout(res, 400)); // outbox entry not written yet: let it land, then flush again
          continue;
        }
        return null;
      }
    }
    return null;
  }
}
