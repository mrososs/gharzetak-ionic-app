import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { CAT, LVL, YARN } from '../data/catalog';
import { parsePattern } from '../domain/pattern-parser';
import { patternStats, simpleProgress } from '../domain/tracker-engine';
import { I18nService } from '../i18n/i18n.service';
import { ChatMessage, DEFAULT_PROFILE, Pattern, Profile, Project, ProjectStatus, TrackerData, TutorialData } from '../models/models';
import { LocalDb, OutboxKind, Scope, ScopeDocs } from '../storage/local-db';
import { samplePatterns } from './factories';

export interface ProjectProgress {
  /** 0..100 */
  readonly pct: number;
  readonly roundLabel: string;
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
  readonly profile = signal<Profile>(DEFAULT_PROFILE);
  readonly favorites = signal<string[]>(['magic-ring']);
  readonly tutorials = signal<Record<string, TutorialData>>({});
  readonly chat = signal<ChatMessage[]>([]);
  readonly storeEmail = signal('');
  readonly storeNotified = signal(false);
  readonly currentProjectId = signal<string | null>(null);

  /** Pattern text a reader is viewing in, overrides the profile terminology. */
  readonly readerTerms = signal<'us' | 'uk' | null>(null);
  readonly viewTerms = computed(() => this.readerTerms() ?? this.profile().terms);

  readonly sortedProjects = computed(() => [...this.projects()].sort((a, b) => b.lastWorkedAt - a.lastWorkedAt));
  readonly currentProject = computed<Project | null>(() => {
    const id = this.currentProjectId();
    const list = this.sortedProjects();
    return list.find((p) => p.id === id) ?? list.find((p) => p.status === 'active') ?? null;
  });

  /** Called by SyncService whenever something needs pushing. */
  onQueued: (() => void) | null = null;

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
    const [projects, patterns, docs] = await Promise.all([this.db.loadProjects(scope), this.db.loadPatterns(scope), this.db.loadDocs(scope)]);
    if (token !== this.loadToken) return;
    this.scope.set(scope);
    this.projects.set(projects.filter((p) => !p.deletedAt));
    this.patterns.set(mergeSamples(patterns.filter((p) => !p.deletedAt)));
    this.profile.set({ ...DEFAULT_PROFILE, ...(docs.profile ?? {}) });
    this.favorites.set(docs.favorites ?? ['magic-ring']);
    this.tutorials.set(docs.tutorials ?? {});
    this.chat.set(docs.chat ?? []);
    this.storeEmail.set(docs.storeEmail ?? '');
    this.storeNotified.set(!!docs.storeNotified);
    this.currentProjectId.set(docs.currentProjectId ?? null);
    this.loaded.set(true);
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

  async addProject(p: Project): Promise<void> {
    this.projects.update((list) => [...list, p]);
    const scope = this.scope();
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

  /** Tracker change = one confirmed step: durable locally before resolving. */
  updateTracker(id: string, fn: (t: TrackerData) => TrackerData): Promise<Project | null> {
    return this.updateProject(id, (p) => ({ ...p, lastWorkedAt: Date.now(), tracker: { ...fn(p.tracker), updatedAt: Date.now() } }), ['progress']);
  }

  setStatus(id: string, status: ProjectStatus): Promise<Project | null> {
    return this.updateProject(id, (p) => ({ ...p, status }));
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
  /* profile, favourites, tutorials, chat, store                          */
  /* ------------------------------------------------------------------ */

  async updateProfile(patch: Partial<Profile>, toolsChanged = false): Promise<void> {
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
