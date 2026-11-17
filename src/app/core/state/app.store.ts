import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { AvatarId, DEFAULT_AVATAR, isAvatarId, toAvatarId } from '../data/avatars';
import { CAT, LVL, YARN } from '../data/catalog';
import { PartInstance, PartSnapshot, instanceLabel, instanceTracker, nextUnfinished, projectCompletion, siblingsOf } from '../domain/collections';
import { JoyEvent, JoyOrigin, detectJoy } from '../domain/joy';
import { ParsedPattern, parsePattern } from '../domain/pattern-parser';
import { TrackerLike, patternStats, simpleProgress } from '../domain/tracker-engine';
import { TermSystem } from '../domain/terminology';
import { I18nService } from '../i18n/i18n.service';
import { JoyPrefs, ReminderPrefs, ScopePrefs, SharePrefs } from '../joy/joy.models';
import { ChatMessage, DEFAULT_PROFILE, Pattern, PatternCollection, PatternRevision, Profile, Project, ProjectStatus, TrackerData, TutorialData } from '../models/models';
import { LocalDb, OutboxKind, Scope, ScopeDocs } from '../storage/local-db';
import { samplePatterns } from './factories';

/** What the tracker is currently following: the project's own tracker, or the active part instance's tracker. */
export interface TrackerView {
  readonly tracker: TrackerLike;
  readonly instance: PartInstance | null;
  readonly snapshot: PartSnapshot | null;
  /** Instructions the tracker reads (a pinned copy when the pattern was edited under the project). */
  readonly source: { readonly text: string; readonly terms: TermSystem; readonly name: string; readonly id: string | null } | null;
  /** The pattern / collection this project follows has a newer revision than the one it is pinned to. */
  readonly outdated: boolean;
}

export interface ProjectProgress {
  /** 0..100 */
  readonly pct: number;
  readonly roundLabel: string;
}

/**
 * Why a tracker is being changed. Only `tap` (a counting action) and `finish` (explicit "mark finished") can create Crochet Joy events;
 * everything else — including every call that does not pass an origin — is silent. `parsed` is the pattern the tap actually used
 * (the pinned revision / part snapshot), required to recognise pattern-mode rounds.
 */
export interface TrackerChange {
  readonly origin?: JoyOrigin;
  readonly parsed?: ParsedPattern | null;
}

/**
 * Local-first application state (Angular signals).
 *  - Every mutation updates the signal immediately, is written to IndexedDB (awaited, ordered),
 *    and — for signed-in users — is queued in the outbox for Worker API sync.
 *  - Guest data lives in the 'guest' scope and never leaves the device.
 */
@Injectable({ providedIn: 'root' })
export class AppStore {
  private readonly db = inject(LocalDb);
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18nService);

  readonly scope = signal<Scope>('guest');
  readonly loaded = signal(false);
  readonly projects = signal<Project[]>([]);
  readonly patterns = signal<Pattern[]>(samplePatterns());
  readonly collections = signal<PatternCollection[]>([]);
  readonly patternRevs = signal<PatternRevision[]>([]);
  readonly profile = signal<Profile>(DEFAULT_PROFILE);
  readonly favorites = signal<string[]>(['magic-ring']);
  readonly tutorials = signal<Record<string, TutorialData>>({});
  readonly chat = signal<ChatMessage[]>([]);
  readonly storeEmail = signal('');
  readonly storeNotified = signal(false);
  readonly currentProjectId = signal<string | null>(null);
  /** Local display + Crochet Joy preferences of the current scope (celebrations, reminders, share cards). */
  readonly prefs = signal<ScopePrefs>({});

  /** Pattern text a reader is viewing in, overrides the profile terminology. */
  readonly readerTerms = signal<'us' | 'uk' | null>(null);
  readonly viewTerms = computed(() => this.readerTerms() ?? this.profile().terms);

  /** The avatar to display: the saved choice or the default preset. */
  readonly avatar = computed<AvatarId>(() => this.profile().avatarId ?? DEFAULT_AVATAR);
  /** True until the user has picked a preset (drives the non-blocking "choose your avatar" invitation). */
  readonly avatarChosen = computed(() => this.profile().avatarId !== null);

  readonly sortedProjects = computed(() => [...this.projects()].sort((a, b) => b.lastWorkedAt - a.lastWorkedAt));
  readonly currentProject = computed<Project | null>(() => {
    const id = this.currentProjectId();
    const list = this.sortedProjects();
    return list.find((p) => p.id === id) ?? list.find((p) => p.status === 'active') ?? null;
  });

  /** Called by SyncService whenever something needs pushing. */
  onQueued: (() => void) | null = null;
  /** Called by JoyService with the events one explicit user command created (never from sync, load, import, undo, reset or edits). */
  onJoy: ((scope: Scope, events: readonly JoyEvent[]) => void) | null = null;
  /** Called when the USER created a project (`addProject(p, true)`) — the moment "First project / multi-part" may be celebrated. */
  onProjectCreated: ((scope: Scope, project: Project) => void) | null = null;

  private writes: Promise<unknown> = Promise.resolve();
  private loadToken = 0;

  constructor() {
    effect(() => {
      const scope = this.auth.scope();
      untracked(() => void this.load(scope));
    });
  }

  /* ------------------------------------------------------------------ */
  /* loading                                                             */
  /* ------------------------------------------------------------------ */

  async load(scope: Scope): Promise<void> {
    const token = ++this.loadToken;
    this.loaded.set(false);
    const [projects, patterns, docs, collections, revs] = await Promise.all([
      this.db.loadProjects(scope),
      this.db.loadPatterns(scope),
      this.db.loadDocs(scope),
      this.db.loadCollections(scope),
      this.db.loadPatternRevs(scope),
    ]);
    if (token !== this.loadToken) return;
    this.scope.set(scope);
    this.collections.set(collections.filter((c) => !c.deletedAt));
    this.patternRevs.set(revs);
    this.projects.set(projects.filter((p) => !p.deletedAt));
    this.patterns.set(mergeSamples(patterns.filter((p) => !p.deletedAt)));
    const stored = { ...DEFAULT_PROFILE, ...(docs.profile ?? {}) };
    // Older builds have no avatarId; anything unknown is dropped rather than trusted.
    this.profile.set({ ...stored, avatarId: toAvatarId(stored.avatarId) });
    this.favorites.set(docs.favorites ?? ['magic-ring']);
    this.tutorials.set(docs.tutorials ?? {});
    this.chat.set(docs.chat ?? []);
    this.storeEmail.set(docs.storeEmail ?? '');
    this.storeNotified.set(!!docs.storeNotified);
    this.currentProjectId.set(docs.currentProjectId ?? null);
    this.prefs.set(docs.prefs ?? {});
    this.loaded.set(true);
  }

  /**
   * Resolves once the store actually holds `scope`. After a sign-in/sign-up the auth scope changes first and the store reloads from its
   * effect a moment later; writing before that lands in the previous scope (e.g. the sign-up name ending up in the guest profile).
   */
  async whenScopeLoaded(scope: Scope, timeoutMs = 5000): Promise<void> {
    const t0 = Date.now();
    while (!(this.scope() === scope && this.loaded())) {
      if (Date.now() - t0 > timeoutMs) return;
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  /** Serialises IndexedDB writes so a later step can never be overwritten by an earlier one. */
  private write(fn: () => Promise<unknown>): Promise<void> {
    const next = this.writes.then(fn, fn);
    this.writes = next.catch(() => undefined);
    return next.then(() => undefined);
  }

  private queue(kind: OutboxKind, id: string, op: 'upsert' | 'delete' = 'upsert', payload?: unknown): void {
    const scope = this.scope();
    if (scope === 'guest') return;
    void this.write(() => this.db.enqueue({ scope, kind, id, op, payload })).then(() => this.onQueued?.());
  }

  private saveDocs(patch: Partial<ScopeDocs>): Promise<void> {
    const scope = this.scope();
    return this.write(() => this.db.patchDocs(scope, patch));
  }

  /* ------------------------------------------------------------------ */
  /* projects                                                            */
  /* ------------------------------------------------------------------ */

  project(id: string | null | undefined): Project | null {
    return id ? (this.projects().find((p) => p.id === id) ?? null) : null;
  }

  /** `fresh` = the user just created it (new-project screen). Import, demo data and sync never pass it, so they never celebrate. */
  async addProject(p: Project, fresh = false): Promise<void> {
    this.projects.update((list) => [...list, p]);
    const scope = this.scope();
    if (fresh) {
      try {
        this.onProjectCreated?.(scope, p);
      } catch {
        /* celebrations are optional */
      }
    }
    await this.write(() => this.db.putProject(scope, p));
    this.queue('project', p.id);
    this.queue('progress', p.id);
    if (p.coverLocalUrl) this.queue('cover', p.id);
    await this.setCurrentProject(p.id);
  }

  /**
   * Applies a change to one project and persists it before resolving.
   * `kinds` controls which server rows need syncing.
   */
  async updateProject(id: string, fn: (p: Project) => Project, kinds: OutboxKind[] = ['project']): Promise<Project | null> {
    let updated: Project | null = null;
    this.projects.update((list) =>
      list.map((p) => {
        if (p.id !== id) return p;
        updated = { ...fn(p), updatedAt: Date.now() };
        return updated;
      }),
    );
    const result = updated as Project | null;
    if (!result) return null;
    const scope = this.scope();
    await this.write(() => this.db.putProject(scope, result));
    for (const k of kinds) this.queue(k, id);
    return result;
  }

  /**
   * Tracker change = one confirmed step: durable locally before resolving.
   * The visible counter updates synchronously; Crochet Joy detection (only for origin `tap`) is a cheap before/after comparison done
   * right after that, never awaited, and can never make the change fail.
   */
  updateTracker(id: string, fn: (t: TrackerData) => TrackerData, change?: TrackerChange): Promise<Project | null> {
    const before = this.joyBefore(id, change);
    const done = this.updateProject(id, (p) => ({ ...p, lastWorkedAt: Date.now(), tracker: { ...fn(p.tracker), updatedAt: Date.now() } }), ['progress']);
    this.emitJoy(before, id, null, change);
    return done;
  }

  setStatus(id: string, status: ProjectStatus, origin: JoyOrigin = 'edit'): Promise<Project | null> {
    const before = this.joyBefore(id, { origin });
    const done = this.updateProject(id, (p) => ({ ...p, status }));
    this.emitJoy(before, id, null, { origin });
    return done;
  }

  /** The project as it was before a change — captured only when the origin could create an event (keeps every other path free). */
  private joyBefore(id: string, change?: TrackerChange): Project | null {
    if (!this.onJoy || (change?.origin !== 'tap' && change?.origin !== 'finish')) return null;
    return this.project(id);
  }

  /** Detects events by comparing the captured `before` with the already-updated signal. Wrapped: a failure here never affects counting. */
  private emitJoy(before: Project | null, id: string, instanceId: string | null, change?: TrackerChange): void {
    if (!before || !change?.origin || !this.onJoy) return;
    try {
      const after = this.project(id);
      if (!after) return;
      const pick = (p: Project) => {
        const inst = instanceId ? (p.parts ?? []).find((i) => i.id === instanceId) : null;
        return inst ? instanceTracker(inst) : p.tracker;
      };
      const events = detectJoy(
        { tracker: pick(before), status: before.status },
        { tracker: pick(after), status: after.status },
        { origin: change.origin, projectId: id, instanceId, parsed: change.parsed ?? null, partsAfter: after.parts ?? null, partSnapshots: after.partSnapshots ?? null },
      );
      if (events.length) this.onJoy(this.scope(), events);
    } catch {
      /* celebrations are optional: the tracker must keep working */
    }
  }

  async deleteProject(id: string): Promise<void> {
    this.projects.update((list) => list.filter((p) => p.id !== id));
    const scope = this.scope();
    await this.write(() => this.db.removeProject(scope, id));
    this.queue('project', id, 'delete');
    if (this.currentProjectId() === id) await this.setCurrentProject(null);
  }

  async setCurrentProject(id: string | null): Promise<void> {
    this.currentProjectId.set(id);
    await this.saveDocs({ currentProjectId: id });
  }

  /* ------------------------------------------------------------------ */
  /* patterns                                                            */
  /* ------------------------------------------------------------------ */

  pattern(id: string | null | undefined): Pattern | null {
    return id ? (this.patterns().find((p) => p.id === id) ?? null) : null;
  }

  async addPattern(p: Pattern): Promise<void> {
    this.patterns.update((list) => [...list, p]);
    const scope = this.scope();
    await this.write(() => this.db.putPattern(scope, p));
    if (!p.isSample) this.queue('pattern', p.id);
  }

  async updatePattern(id: string, fn: (p: Pattern) => Pattern, sync = true): Promise<void> {
    let updated: Pattern | null = null;
    this.patterns.update((list) =>
      list.map((p) => {
        if (p.id !== id) return p;
        updated = { ...fn(p), updatedAt: Date.now() };
        return updated;
      }),
    );
    const result = updated as Pattern | null;
    if (!result) return;
    const scope = this.scope();
    await this.write(() => this.db.putPattern(scope, result));
    if (sync && !result.isSample) this.queue('pattern', id);
  }

  async deletePattern(id: string): Promise<void> {
    const p = this.pattern(id);
    if (!p || p.isSample) return;
    this.patterns.update((list) => list.filter((x) => x.id !== id));
    const scope = this.scope();
    await this.write(() => this.db.removePattern(scope, id));
    this.queue('pattern', id, 'delete');
    for (const proj of this.projects().filter((x) => x.tracker.patternId === id)) {
      await this.updateTracker(proj.id, (t) => ({ ...t, mode: 'simple', patternId: null }));
    }
  }

  /* ------------------------------------------------------------------ */
  /* revisions (immutable history) + pattern editing                      */
  /* ------------------------------------------------------------------ */

  /** Appends an immutable history entry (never overwrites) and queues it for sync. Returns false if that revision already exists. */
  private async recordRevision(r: PatternRevision): Promise<boolean> {
    const scope = this.scope();
    let added = false;
    await this.write(async () => {
      added = await this.db.putPatternRev(scope, r);
    });
    if (!added) return false;
    this.patternRevs.update((l) => [...l, r]);
    this.queue('patternrev', r.id, 'upsert', { kind: r.kind, entityId: r.entityId, rev: r.rev });
    return true;
  }

  revisionsOf(kind: 'pattern' | 'collection', entityId: string): PatternRevision[] {
    return this.patternRevs().filter((r) => r.kind === kind && r.entityId === entityId).sort((a, b) => b.rev - a.rev);
  }

  /**
   * Saves an edited standalone pattern. When the text or terminology changes:
   *  1. the previous content is kept as an immutable revision,
   *  2. every project that follows the pattern is PINNED to the previous content (a frozen copy) so its progress keeps
   *     meaning what it meant, and can be moved to the new text only by an explicit update,
   *  3. the pattern's revision counter is bumped.
   */
  async savePatternEdit(id: string, next: Pick<Pattern, 'name' | 'level' | 'terms' | 'text' | 'attribution' | 'suggestedMinutes'>): Promise<{ contentChanged: boolean; rev: number; pinned: number }> {
    const old = this.pattern(id);
    if (!old || old.isSample) return { contentChanged: false, rev: old?.rev ?? 1, pinned: 0 };
    const oldRev = old.rev ?? 1;
    const contentChanged = old.text !== next.text || old.terms !== next.terms;
    let pinned = 0;
    if (contentChanged) {
      await this.recordRevision({ id: `pattern:${id}:${oldRev}`, kind: 'pattern', entityId: id, rev: oldRev, name: old.name, terms: old.terms, text: old.text, at: Date.now() });
      for (const proj of this.projects().filter((x) => x.tracker.patternId === id && !x.patternPin)) {
        await this.updateProject(
          proj.id,
          (x) => ({ ...x, patternPin: { rev: oldRev, name: old.name, text: old.text, terms: old.terms }, tracker: { ...x.tracker, updatedAt: Date.now() } }),
          ['progress'],
        );
        pinned++;
      }
    }
    await this.updatePattern(id, (p) => ({ ...p, ...next, rev: contentChanged ? oldRev + 1 : oldRev }));
    return { contentChanged, rev: contentChanged ? oldRev + 1 : oldRev, pinned };
  }

  /** Explicit "update this project to the latest pattern text": clears the pin; the caller supplies the already-mapped cursor. */
  async unpinProject(projectId: string, cursor: TrackerData['cursor']): Promise<void> {
    await this.updateProject(projectId, (x) => ({ ...x, patternPin: null, tracker: { ...x.tracker, cursor, updatedAt: Date.now() } }), ['progress']);
  }

  /* ------------------------------------------------------------------ */
  /* collections                                                         */
  /* ------------------------------------------------------------------ */

  collection(id: string | null | undefined): PatternCollection | null {
    return id ? (this.collections().find((c) => c.id === id) ?? null) : null;
  }

  async addCollection(c: PatternCollection): Promise<void> {
    this.collections.update((list) => [...list, c]);
    const scope = this.scope();
    await this.write(() => this.db.putCollection(scope, c));
    this.queue('collection', c.id);
  }

  /** Saves an edited collection; a change to any part's instructions / quantity / order or the terminology keeps the previous content as a revision. */
  async saveCollectionEdit(id: string, next: Omit<PatternCollection, 'id' | 'rev' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<{ contentChanged: boolean; rev: number }> {
    const old = this.collection(id);
    if (!old) return { contentChanged: false, rev: 1 };
    const key = (c: { terms: TermSystem; parts: readonly { id: string; name: string; quantity: number; text: string; assemblyNotes: string }[] }) =>
      JSON.stringify([c.terms, c.parts.map((p) => [p.id, p.name, p.quantity, p.text, p.assemblyNotes])]);
    const contentChanged = key(old) !== key(next);
    if (contentChanged) await this.recordRevision({ id: `collection:${id}:${old.rev}`, kind: 'collection', entityId: id, rev: old.rev, name: old.name, terms: old.terms, parts: old.parts, at: Date.now() });
    const rev = contentChanged ? old.rev + 1 : old.rev;
    const updated: PatternCollection = { ...old, ...next, rev, updatedAt: Date.now() };
    this.collections.update((list) => list.map((c) => (c.id === id ? updated : c)));
    const scope = this.scope();
    await this.write(() => this.db.putCollection(scope, updated));
    this.queue('collection', id);
    return { contentChanged, rev };
  }

  /** Deletes the collection. Projects created from it keep working: they hold their own frozen copy of every part. */
  async deleteCollection(id: string): Promise<void> {
    this.collections.update((list) => list.filter((c) => c.id !== id));
    const scope = this.scope();
    await this.write(() => this.db.removeCollection(scope, id));
    this.queue('collection', id, 'delete');
  }

  /**
   * Copies an existing standalone pattern into a collection as a new part. The source pattern is NEVER changed or removed.
   */
  async copyPatternIntoCollection(patternId: string, collectionId: string, partId: string, quantity = 1): Promise<boolean> {
    const pat = this.pattern(patternId);
    const col = this.collection(collectionId);
    if (!pat || !col || !pat.text.trim() || col.parts.length >= 30) return false;
    await this.saveCollectionEdit(collectionId, {
      ...col,
      parts: [...col.parts, { id: partId, name: this.patternName(pat).slice(0, 80), quantity, text: pat.text, assemblyNotes: '' }],
    });
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* multi-part projects: independent tracker per part instance           */
  /* ------------------------------------------------------------------ */

  /** The instance the tracker is on: the remembered one, else the first unfinished, else the first. */
  activeInstance(p: Project): PartInstance | null {
    const parts = p.parts;
    if (!parts?.length) return null;
    return parts.find((i) => i.id === p.activeInstanceId) ?? nextUnfinished(parts, p.partSnapshots ?? [], null) ?? parts[0];
  }

  /** What the tracker should follow for this project (own tracker, or the active part instance). */
  trackerView(p: Project | null): TrackerView | null {
    if (!p) return null;
    const inst = this.activeInstance(p);
    if (inst) {
      const snap = (p.partSnapshots ?? []).find((s) => s.partId === inst.partId) ?? null;
      const col = this.collection(p.collectionId);
      return {
        tracker: instanceTracker(inst),
        instance: inst,
        snapshot: snap,
        source: snap ? { text: snap.text, terms: snap.terms ?? col?.terms ?? 'us', name: instanceLabel(inst, snap, siblingsOf(p.parts ?? [], inst)), id: null } : null,
        outdated: !!col && (p.collectionRev ?? 1) < col.rev,
      };
    }
    const pin = p.patternPin ?? null;
    const live = this.pattern(p.tracker.patternId);
    const source = pin
      ? { text: pin.text, terms: pin.terms, name: pin.name, id: p.tracker.patternId }
      : live
        ? { text: live.text, terms: live.terms, name: this.patternName(live), id: live.id }
        : null;
    return { tracker: p.tracker, instance: null, snapshot: null, source, outdated: !!pin && !!live && (live.rev ?? 1) > pin.rev };
  }

  /** One confirmed step on ONE part instance: durable locally before resolving. Other instances are never touched. */
  updatePartTracker(projectId: string, instanceId: string, fn: (t: TrackerLike) => TrackerLike, change?: TrackerChange): Promise<Project | null> {
    const before = this.joyBefore(projectId, change);
    const done = this.updateProject(
      projectId,
      (p) => {
        const now = Date.now();
        return {
          ...p,
          lastWorkedAt: now,
          parts: (p.parts ?? []).map((i) => {
            if (i.id !== instanceId) return i;
            const t = fn(instanceTracker(i));
            return { ...i, mode: t.mode, simple: t.simple, cursor: t.cursor, updatedAt: now };
          }),
          tracker: { ...p.tracker, updatedAt: now },
        };
      },
      ['progress'],
    );
    this.emitJoy(before, projectId, instanceId, change);
    return done;
  }

  /**
   * Applies an explicit "update to the latest collection version" plan (see planCollectionUpdate). Positions were already mapped
   * (never reset); instances that had progress but were dropped by the new version are kept as retired pieces.
   */
  applyCollectionUpdate(projectId: string, plan: { snapshots: readonly PartSnapshot[]; instances: readonly PartInstance[] }, collectionRev: number): Promise<Project | null> {
    return this.updateProject(
      projectId,
      (p) => {
        const keepActive = plan.instances.some((i) => i.id === p.activeInstanceId);
        return {
          ...p,
          collectionRev,
          partSnapshots: plan.snapshots,
          parts: plan.instances,
          activeInstanceId: keepActive ? p.activeInstanceId : (plan.instances.find((i) => !i.retired)?.id ?? null),
          tracker: { ...p.tracker, updatedAt: Date.now() },
        };
      },
      ['progress'],
    );
  }

  /** Remembers which part the user is on (restored after a restart). */
  setActiveInstance(projectId: string, instanceId: string): Promise<Project | null> {
    return this.updateProject(projectId, (p) => ({ ...p, activeInstanceId: instanceId, tracker: { ...p.tracker, updatedAt: Date.now() } }), ['progress']);
  }

  /* ------------------------------------------------------------------ */
  /* profile, favourites, tutorials, chat, store                          */
  /* ------------------------------------------------------------------ */

  /** Persists a preset avatar immediately (IndexedDB) and queues the profile for sync. Unknown ids are ignored. */
  async setAvatar(id: AvatarId): Promise<void> {
    if (!isAvatarId(id) || this.profile().avatarId === id) return;
    await this.updateProfile({ avatarId: id });
  }

  /** Merges Crochet Joy / display preferences (per scope) and persists them immediately. Local only: never synced. */
  async updatePrefs(patch: { immersive?: boolean; joy?: Partial<JoyPrefs>; reminders?: Partial<ReminderPrefs>; share?: Partial<SharePrefs> }): Promise<void> {
    const cur = this.prefs();
    const next: ScopePrefs = { ...cur };
    if (patch.immersive !== undefined) next.immersive = patch.immersive;
    if (patch.joy) next.joy = { ...cur.joy, ...patch.joy };
    if (patch.reminders) next.reminders = { ...cur.reminders, ...patch.reminders };
    if (patch.share) next.share = { ...cur.share, ...patch.share };
    this.prefs.set(next);
    await this.saveDocs({ prefs: next });
  }

  async updateProfile(patch: Partial<Profile>, toolsChanged = false): Promise<void> {
    if ('avatarId' in patch && patch.avatarId != null && !isAvatarId(patch.avatarId)) patch = { ...patch, avatarId: this.profile().avatarId };
    const next = { ...this.profile(), ...patch, updatedAt: Date.now() };
    this.profile.set(next);
    await this.saveDocs({ profile: next });
    this.queue('profile', 'me');
    if (toolsChanged || 'hooks' in patch || 'yarns' in patch || 'accessories' in patch) this.queue('tools', 'me');
  }

  async toggleFavorite(tutorialId: string): Promise<void> {
    const on = !this.favorites().includes(tutorialId);
    this.favorites.update((f) => (on ? [...f, tutorialId] : f.filter((x) => x !== tutorialId)));
    await this.saveDocs({ favorites: this.favorites() });
    this.queue('favorite', tutorialId, on ? 'upsert' : 'delete');
  }

  tutorial(id: string): TutorialData {
    return this.tutorials()[id] ?? { tutorialId: id, link: '', notes: '', projectId: null, stamps: [], updatedAt: 0 };
  }

  async updateTutorial(id: string, patch: Partial<TutorialData>): Promise<void> {
    const next = { ...this.tutorial(id), ...patch, tutorialId: id, updatedAt: Date.now() };
    this.tutorials.update((t) => ({ ...t, [id]: next }));
    await this.saveDocs({ tutorials: this.tutorials() });
    this.queue('tutorial', id);
  }

  async setChat(chat: ChatMessage[]): Promise<void> {
    const trimmed = chat.slice(-40);
    this.chat.set(trimmed);
    await this.saveDocs({ chat: trimmed.map((m) => ({ id: m.id, role: m.role, text: m.text })) });
  }

  async setStoreInterest(email: string, notified: boolean): Promise<void> {
    this.storeEmail.set(email);
    this.storeNotified.set(notified);
    await this.saveDocs({ storeEmail: email, storeNotified: notified });
    this.queue('interest', 'me', notified ? 'upsert' : 'delete');
  }

  /** Erases this device's data for the current scope (cloud data is untouched). */
  async eraseLocal(): Promise<void> {
    const scope = this.scope();
    await this.write(() => this.db.clearScope(scope));
    await this.load(scope);
  }

  /* ------------------------------------------------------------------ */
  /* derived view helpers                                                */
  /* ------------------------------------------------------------------ */

  projectName(p: Project): string {
    return p.name;
  }

  patternName(p: Pattern): string {
    if (p.isSample) return (this.i18n.isAr() ? p.nameAr : p.nameEn) ?? p.name;
    return p.name;
  }

  progress(p: Project): ProjectProgress {
    const q = (a: string, e: string) => this.i18n.q(a, e);
    if (p.parts?.length) {
      const c = projectCompletion(p.parts, p.partSnapshots ?? []);
      return { pct: p.status === 'done' ? 100 : c.percent, roundLabel: q(`${c.doneCount} من ${c.total} قطعة`, `${c.doneCount} of ${c.total} pieces`) };
    }
    if (p.tracker.mode === 'pattern') {
      const pat = this.pattern(p.tracker.patternId);
      const parsed = pat ? parsePattern(pat.text) : null;
      const st = parsed ? patternStats(parsed, p.tracker.cursor) : null;
      if (parsed && st) {
        const total = parsed.rounds.length;
        return { pct: p.status === 'done' ? 100 : Math.round(st.progress * 100), roundLabel: q(`الدور ${st.roundNumber} من ${total}`, `Round ${st.roundNumber} of ${total}`) };
      }
    }
    const s = p.tracker.simple;
    const rl = s.totalRounds > 0 ? q(`الدور ${s.round} من ${s.totalRounds}`, `Round ${s.round} of ${s.totalRounds}`) : q(`الدور ${s.round}`, `Round ${s.round}`);
    return { pct: p.status === 'done' ? 100 : Math.round(simpleProgress(s) * 100), roundLabel: rl };
  }

  categoryName(id: string): string {
    const c = CAT[id as keyof typeof CAT] ?? CAT.amigurumi;
    return c[this.i18n.lang()];
  }
  levelName(id: string): string {
    return (LVL[id as keyof typeof LVL] ?? LVL.beginner)[this.i18n.lang()];
  }
  yarnName(id: string): string {
    return (YARN[id as keyof typeof YARN] ?? YARN.cotton)[this.i18n.lang()];
  }
  statusName(s: ProjectStatus): string {
    return { active: this.i18n.q('نشط', 'Active'), paused: this.i18n.q('متوقف مؤقتًا', 'Paused'), done: this.i18n.q('مكتمل', 'Completed') }[s];
  }
  statusClass(s: ProjectStatus): string {
    return { active: 'sage', paused: 'peach', done: '' }[s];
  }
  relTime(ts: number): string {
    const d = Date.now() - ts;
    const days = Math.floor(d / 86400000);
    if (d < 3600000) return this.i18n.q('من شوية', 'Just now');
    if (days < 1) return this.i18n.q('النهارده', 'Today');
    if (days === 1) return this.i18n.q('إمبارح', 'Yesterday');
    return this.i18n.q(`من ${days} أيام`, `${days} days ago`);
  }
  duration(sec: number): string {
    if (!sec) return '—';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return this.i18n.isAr() ? (h ? h + 'س ' : '') + m + 'د' : (h ? h + 'h ' : '') + m + 'm';
  }
}

function mergeSamples(stored: Pattern[]): Pattern[] {
  const samples = samplePatterns().map((s) => {
    const local = stored.find((p) => p.id === s.id);
    return local ? { ...s, position: local.position } : s;
  });
  return [...samples, ...stored.filter((p) => !p.isSample)];
}
