import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { CategoryId, YarnId, AccessoryId, LevelId } from '../data/catalog';
import { parsePattern } from '../domain/pattern-parser';
import { createPatternCursor, createSimpleCounter } from '../domain/tracker-engine';
import { Pattern, Profile, Project, ProjectPhoto, TutorialData } from '../models/models';
import { NetworkService } from '../services/network.service';
import { AppStore } from '../state/app.store';
import { LocalDb, OutboxEntry, OutboxKind } from '../storage/local-db';
import { SUPABASE } from '../supabase/supabase.client';
import { dataUrlToBlob } from '../utils/image';

export type SyncState = 'local' | 'idle' | 'syncing' | 'offline' | 'error';

const ORDER: OutboxKind[] = ['profile', 'tools', 'pattern', 'project', 'cover', 'progress', 'note', 'photo', 'session', 'favorite', 'tutorial', 'interest'];
const MAX_ATTEMPTS = 5;
const iso = (ms: number) => new Date(ms || Date.now()).toISOString();
const ms = (s: string | null | undefined) => (s ? new Date(s).getTime() : 0);

class NetworkFailure extends Error {}

/**
 * Offline-first synchronisation with Supabase.
 *
 * Push: every local mutation of a signed-in user is coalesced in an IndexedDB outbox
 *       (one entry per entity) and flushed in dependency order when online. Upserts carry
 *       the client `updated_at`; a DB trigger ignores writes older than the stored row,
 *       so a stale device can never overwrite newer progress.
 * Pull: on sign-in, resume and reconnect, remote rows are merged last-write-wins, except
 *       entities with a pending local change, which are kept and pushed.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly sb = inject(SUPABASE);
  private readonly auth = inject(AuthService);
  private readonly store = inject(AppStore);
  private readonly db = inject(LocalDb);
  private readonly net = inject(NetworkService);

  readonly state = signal<SyncState>('local');
  readonly pending = signal(0);
  readonly lastError = signal<string | null>(null);
  readonly active = computed(() => !!this.sb && this.auth.signedIn());

  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly signed = new Map<string, { url: string; exp: number }>();

  constructor() {
    this.store.onQueued = () => this.schedule(400);
    this.net.onChange((online) => (online ? this.schedule(0, true) : this.state.set(this.active() ? 'offline' : 'local')));
    effect(() => {
      const loaded = this.store.loaded();
      const scope = this.store.scope();
      if (loaded && scope !== 'guest' && this.active()) untracked(() => this.schedule(0, true));
      if (!this.active()) untracked(() => this.state.set('local'));
    });
  }

  /** Debounced flush (+ optional pull). */
  schedule(delay = 400, pull = false): void {
    if (!this.active()) return;
    if (pull) this.pullRequested = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delay);
  }
  private pullRequested = false;
  private retryDelay = 0;

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
          await this.flush();
          if (this.pullRequested) {
            this.pullRequested = false;
            await this.pull();
          }
          this.lastError.set(null);
          this.state.set('idle');
          this.retryDelay = 0;
        } catch (e) {
          this.state.set(e instanceof NetworkFailure ? 'offline' : 'error');
          this.lastError.set(e instanceof Error ? e.message : String(e));
          // Server unreachable while the device reports "online": retry with backoff (5s → 5min).
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

  private uid(): string {
    const id = this.auth.user()?.id;
    if (!id) throw new Error('not signed in');
    return id;
  }

  /* ------------------------------------------------------------------ */
  /* push                                                                */
  /* ------------------------------------------------------------------ */

  private async flush(): Promise<void> {
    const scope = this.store.scope();
    if (scope === 'guest') return;
    const entries = (await this.db.outbox(scope)).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.queuedAt - b.queuedAt);
    for (const e of entries) {
      try {
        await this.push(e);
        await this.db.dequeue(e);
      } catch (err) {
        if (err instanceof NetworkFailure) throw err;
        console.warn('[sync] push failed', e.kind, e.id, err);
        if (e.attempts + 1 >= MAX_ATTEMPTS) await this.db.dequeue(e);
        else await this.db.bumpAttempts(e);
      }
    }
  }

  private check<T extends { error: { message: string; code?: string } | null }>(res: T): T {
    if (res.error) {
      const msg = res.error.message || '';
      if (/fetch|network|Failed to fetch|timeout/i.test(msg) || res.error.code === '') throw new NetworkFailure(msg);
      throw new Error(`${res.error.code ?? ''} ${msg}`.trim());
    }
    return res;
  }

  private async push(e: OutboxEntry): Promise<void> {
    const sb = this.sb!;
    const uid = this.uid();
    const project = () => this.store.project(e.id);

    switch (e.kind) {
      case 'profile': {
        const p = this.store.profile();
        this.check(
          await sb.from('profiles').upsert({
            id: uid, display_name: p.displayName.slice(0, 80), level: p.level, terms: p.terms, locale: document.documentElement.lang === 'en' ? 'en' : 'ar',
            interests: [...p.interests], onboarded: p.onboarded, updated_at: iso(p.updatedAt),
          }),
        );
        return;
      }
      case 'tools': {
        const p = this.store.profile();
        const rows = [
          ...p.hooks.map((value) => ({ user_id: uid, kind: 'hook', value })),
          ...p.yarns.map((value) => ({ user_id: uid, kind: 'yarn', value })),
          ...p.accessories.map((value) => ({ user_id: uid, kind: 'accessory', value })),
        ];
        this.check(await sb.from('user_tools').delete().eq('user_id', uid));
        if (rows.length) this.check(await sb.from('user_tools').insert(rows));
        return;
      }
      case 'pattern': {
        if (e.op === 'delete') {
          this.check(await sb.from('patterns').delete().eq('id', e.id).eq('owner_id', uid));
          return;
        }
        const p = this.store.pattern(e.id);
        if (!p || p.isSample) return;
        this.check(
          await sb.from('patterns').upsert({
            id: p.id, owner_id: uid, is_sample: false, name: p.name.slice(0, 120), level: p.level, terms: p.terms, source_type: p.source,
            source_url: p.sourceUrl || null, attribution: p.attribution || null, raw_text: p.text, file_path: p.file?.storagePath ?? null,
            file_name: p.file?.name ?? null, file_size: p.file?.size ?? null, file_mime: p.file?.mime ?? null, reading_position: p.position, updated_at: iso(p.updatedAt),
          }),
        );
        const parsed = parsePattern(p.text);
        this.check(await sb.from('pattern_rounds').delete().eq('pattern_id', p.id));
        if (parsed.rounds.length) {
          this.check(
            await sb.from('pattern_rounds').insert(
              parsed.rounds.map((r, i) => ({ pattern_id: p.id, position: i, round_number: r.n, raw: r.raw.slice(0, 500), parsed_ok: r.ok, consumed: r.cons, produced: r.prod, declared_total: r.declared })),
            ),
          );
        }
        return;
      }
      case 'project': {
        if (e.op === 'delete') {
          const { data } = await sb.storage.from('project-photos').list(`${uid}/${e.id}`, { limit: 1000 });
          if (data?.length) await sb.storage.from('project-photos').remove(data.map((f) => `${uid}/${e.id}/${f.name}`));
          this.check(await sb.from('projects').delete().eq('id', e.id).eq('owner_id', uid));
          return;
        }
        const p = project();
        if (!p) return;
        this.check(await sb.from('projects').upsert(this.projectRow(p, uid)));
        return;
      }
      case 'progress': {
        const p = project();
        if (!p) return;
        const t = p.tracker;
        this.check(
          await sb.from('project_progress').upsert({
            project_id: p.id, owner_id: uid, mode: t.mode, round: t.simple.round, target: t.simple.target, per_tap: t.simple.perTap,
            count: t.simple.count, total_rounds: t.simple.totalRounds, pattern_id: t.patternId, pattern_round_index: t.cursor.roundIndex,
            action_ptr: t.cursor.ptr, count_mode: t.cursor.mode, history: t.simple.history.slice(-100) as never, pattern_history: t.cursor.history.slice(-100) as never,
            updated_at: iso(t.updatedAt),
          }),
        );
        return;
      }
      case 'note': {
        const p = project();
        if (!p) return;
        this.check(await sb.from('project_notes').upsert({ project_id: p.id, owner_id: uid, body: p.notes.slice(0, 10000), updated_at: iso(p.updatedAt) }, { onConflict: 'project_id' }));
        return;
      }
      case 'cover': {
        const p = project();
        if (!p?.coverLocalUrl) return;
        const path = `${uid}/${p.id}/cover-${Date.now()}.jpg`;
        const blob = dataUrlToBlob(p.coverLocalUrl);
        this.check(await sb.storage.from('project-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true }));
        const old = p.coverPath;
        await this.store.updateProject(p.id, (x) => ({ ...x, coverPath: path }), []);
        this.check(await sb.from('projects').update({ cover_path: path, updated_at: iso(Date.now()) }).eq('id', p.id));
        if (old && old !== path) await sb.storage.from('project-photos').remove([old]);
        return;
      }
      case 'photo': {
        const pid = (e.payload as { projectId?: string } | undefined)?.projectId;
        const p = this.store.project(pid);
        if (!p) return;
        if (e.op === 'delete') {
          const path = (e.payload as { storagePath?: string }).storagePath;
          if (path) await sb.storage.from('project-photos').remove([path]);
          this.check(await sb.from('project_photos').delete().eq('id', e.id));
          return;
        }
        const ph = p.photos.find((x) => x.id === e.id);
        if (!ph?.localUrl) return;
        const path = `${uid}/${p.id}/${ph.id}.jpg`;
        const blob = dataUrlToBlob(ph.localUrl);
        this.check(await sb.storage.from('project-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true }));
        this.check(await sb.from('project_photos').upsert({ id: ph.id, project_id: p.id, owner_id: uid, storage_path: path, mime_type: 'image/jpeg', size_bytes: blob.size }));
        await this.store.updateProject(p.id, (x) => ({ ...x, photos: x.photos.map((y) => (y.id === ph.id ? { ...y, storagePath: path } : y)) }), []);
        return;
      }
      case 'session': {
        const s = e.payload as { projectId: string; startedAt: number; endedAt: number; seconds: number };
        if (!this.store.project(s.projectId)) return;
        this.check(await sb.from('work_sessions').upsert({ id: e.id, project_id: s.projectId, owner_id: uid, started_at: iso(s.startedAt), ended_at: iso(s.endedAt), seconds: s.seconds }));
        return;
      }
      case 'favorite': {
        if (e.op === 'delete') this.check(await sb.from('favorites').delete().match({ user_id: uid, item_type: 'tutorial', item_id: e.id }));
        else this.check(await sb.from('favorites').upsert({ user_id: uid, item_type: 'tutorial', item_id: e.id }));
        return;
      }
      case 'tutorial': {
        const t = this.store.tutorial(e.id);
        const yt = /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(t.link) ? t.link : null;
        const res = this.check(
          await sb
            .from('tutorial_bookmarks')
            .upsert({ user_id: uid, tutorial_id: e.id, youtube_url: yt, creator_name: t.creator ? t.creator.slice(0, 120) : null, project_id: t.projectId && this.store.project(t.projectId) ? t.projectId : null, notes: t.notes, updated_at: iso(t.updatedAt) }, { onConflict: 'user_id,tutorial_id' })
            .select('id')
            .maybeSingle(),
        );
        let bookmarkId = res.data?.id;
        if (!bookmarkId) bookmarkId = (this.check(await sb.from('tutorial_bookmarks').select('id').match({ user_id: uid, tutorial_id: e.id }).maybeSingle())).data?.id;
        if (!bookmarkId) return;
        this.check(await sb.from('tutorial_timestamps').delete().eq('bookmark_id', bookmarkId));
        if (t.stamps.length) this.check(await sb.from('tutorial_timestamps').insert(t.stamps.map((s) => ({ id: s.id, bookmark_id: bookmarkId!, user_id: uid, seconds: s.sec, note: s.note.slice(0, 300) }))));
        return;
      }
      case 'interest': {
        if (e.op === 'delete') this.check(await sb.from('store_interest').delete().eq('user_id', uid));
        else this.check(await sb.from('store_interest').upsert({ user_id: uid, email: this.store.storeEmail().trim() }));
        return;
      }
    }
  }

  private projectRow(p: Project, uid: string) {
    return {
      id: p.id, owner_id: uid, name: p.name.slice(0, 120), category: p.category, hook_size: p.hook, yarn_type: p.yarn, status: p.status,
      pattern_id: p.tracker.patternId, cover_path: p.coverPath, estimated_hours: p.estimatedHours, worked_seconds: p.workedSeconds,
      last_worked_at: iso(p.lastWorkedAt), created_at: iso(p.createdAt), updated_at: iso(p.updatedAt),
    };
  }

  /* ------------------------------------------------------------------ */
  /* pull & merge                                                        */
  /* ------------------------------------------------------------------ */

  private async pull(): Promise<void> {
    const sb = this.sb!;
    const uid = this.uid();
    const scope = this.store.scope();
    const outbox = await this.db.outbox(scope);
    const dirty = new Set(outbox.map((o) => `${o.kind}|${o.id}`));

    const [prof, tools, pats, projs, progs, notes, photos, favs, bms, stamps, interest] = await Promise.all([
      sb.from('profiles').select('*').eq('id', uid).maybeSingle(),
      sb.from('user_tools').select('kind,value').eq('user_id', uid),
      sb.from('patterns').select('*').eq('owner_id', uid),
      sb.from('projects').select('*').eq('owner_id', uid),
      sb.from('project_progress').select('*').eq('owner_id', uid),
      sb.from('project_notes').select('*').eq('owner_id', uid),
      sb.from('project_photos').select('*').eq('owner_id', uid),
      sb.from('favorites').select('item_id').eq('user_id', uid).eq('item_type', 'tutorial'),
      sb.from('tutorial_bookmarks').select('*').eq('user_id', uid),
      sb.from('tutorial_timestamps').select('*').eq('user_id', uid),
      sb.from('store_interest').select('email').eq('user_id', uid).maybeSingle(),
    ]);
    for (const r of [prof, tools, pats, projs, progs, notes, photos, favs, bms, stamps, interest]) this.check(r);
    if (this.store.scope() !== scope) return; // user switched meanwhile

    // profile + tools
    const lp = this.store.profile();
    if (prof.data && !dirty.has('profile|me') && ms(prof.data.updated_at) > lp.updatedAt) {
      const next: Profile = {
        ...lp, displayName: prof.data.display_name, level: prof.data.level as LevelId, terms: prof.data.terms as 'us' | 'uk',
        interests: prof.data.interests as CategoryId[], onboarded: prof.data.onboarded, updatedAt: ms(prof.data.updated_at),
      };
      if (!dirty.has('tools|me') && tools.data && (tools.data.length || prof.data.onboarded)) {
        Object.assign(next, {
          hooks: tools.data.filter((t) => t.kind === 'hook').map((t) => t.value),
          yarns: tools.data.filter((t) => t.kind === 'yarn').map((t) => t.value as YarnId),
          accessories: tools.data.filter((t) => t.kind === 'accessory').map((t) => t.value as AccessoryId),
        });
      }
      this.store.profile.set(next);
      await this.db.patchDocs(scope, { profile: next });
    }

    // patterns
    const localPats = this.store.patterns();
    const remotePats = new Map((pats.data ?? []).map((r) => [r.id, r]));
    const mergedPats: Pattern[] = localPats.filter((p) => p.isSample || remotePats.has(p.id) || dirty.has(`pattern|${p.id}`));
    for (const r of remotePats.values()) {
      const local = mergedPats.find((p) => p.id === r.id);
      if (local && (dirty.has(`pattern|${r.id}`) || local.updatedAt >= ms(r.updated_at))) continue;
      const pat: Pattern = {
        id: r.id, isSample: false, name: r.name, level: r.level as LevelId, terms: r.terms as 'us' | 'uk', source: r.source_type as Pattern['source'],
        text: r.raw_text, attribution: r.attribution ?? '', sourceUrl: r.source_url ?? '', position: r.reading_position,
        file: r.file_name ? { name: r.file_name, size: r.file_size ?? 0, mime: r.file_mime ?? '', storagePath: r.file_path } : null,
        updatedAt: ms(r.updated_at), deletedAt: null,
      };
      if (local) mergedPats.splice(mergedPats.indexOf(local), 1, pat);
      else mergedPats.push(pat);
    }

    // projects (+ progress, notes, photos)
    const progBy = new Map((progs.data ?? []).map((r) => [r.project_id, r]));
    const noteBy = new Map((notes.data ?? []).map((r) => [r.project_id, r]));
    const localProjects = this.store.projects();
    const remoteIds = new Set((projs.data ?? []).map((r) => r.id));
    const merged: Project[] = localProjects.filter((p) => remoteIds.has(p.id) || dirty.has(`project|${p.id}`));
    for (const r of projs.data ?? []) {
      const local = merged.find((p) => p.id === r.id);
      const pr = progBy.get(r.id);
      const note = noteBy.get(r.id);
      const remotePhotos: ProjectPhoto[] = (photos.data ?? [])
        .filter((x) => x.project_id === r.id && !x.is_cover)
        .map((x) => ({ id: x.id, storagePath: x.storage_path, localUrl: local?.photos.find((lp2) => lp2.id === x.id)?.localUrl ?? null, createdAt: ms(x.created_at) }));
      const keepLocalPhotos = (local?.photos ?? []).filter((x) => !remotePhotos.some((y) => y.id === x.id));
      const projDirty = dirty.has(`project|${r.id}`) || (!!local && local.updatedAt > ms(r.updated_at));
      const progDirty = dirty.has(`progress|${r.id}`) || (!!local && !!pr && local.tracker.updatedAt > ms(pr.updated_at));
      const base: Project =
        local && projDirty
          ? local
          : {
              id: r.id, name: r.name, category: r.category as CategoryId, hook: r.hook_size, yarn: r.yarn_type as YarnId, status: r.status as Project['status'],
              notes: local?.notes ?? '', coverLocalUrl: local && local.coverPath === r.cover_path ? local.coverLocalUrl : null, coverPath: r.cover_path,
              photos: [], workedSeconds: r.worked_seconds, estimatedHours: Number(r.estimated_hours), lastWorkedAt: ms(r.last_worked_at),
              createdAt: ms(r.created_at), updatedAt: ms(r.updated_at), deletedAt: null, tracker: local?.tracker ?? this.emptyTracker(),
            };
      const tracker =
        pr && !progDirty
          ? {
              mode: pr.mode as 'simple' | 'pattern',
              simple: createSimpleCounter({ round: pr.round, target: pr.target, perTap: pr.per_tap, count: pr.count, totalRounds: pr.total_rounds, history: (pr.history as never) ?? [] }),
              patternId: pr.pattern_id,
              cursor: createPatternCursor({ roundIndex: pr.pattern_round_index, ptr: pr.action_ptr, mode: pr.count_mode as 'action', history: (pr.pattern_history as never) ?? [] }),
              updatedAt: ms(pr.updated_at),
            }
          : base.tracker;
      const notesText = note && !dirty.has(`note|${r.id}`) && (!local || ms(note.updated_at) >= local.updatedAt || !projDirty) ? note.body : base.notes;
      const next: Project = { ...base, tracker, notes: notesText, photos: [...remotePhotos, ...keepLocalPhotos] };
      if (local) merged.splice(merged.indexOf(local), 1, next);
      else merged.push(next);
    }

    // favourites, tutorials, store interest
    const favList = dirty.size && [...dirty].some((d) => d.startsWith('favorite|')) ? this.store.favorites() : (favs.data ?? []).map((f) => f.item_id);
    const tutorials: Record<string, TutorialData> = { ...this.store.tutorials() };
    for (const b of bms.data ?? []) {
      if (dirty.has(`tutorial|${b.tutorial_id}`) || (tutorials[b.tutorial_id]?.updatedAt ?? 0) > ms(b.updated_at)) continue;
      tutorials[b.tutorial_id] = {
        tutorialId: b.tutorial_id, link: b.youtube_url ?? '', creator: b.creator_name ?? '', notes: b.notes, projectId: b.project_id, updatedAt: ms(b.updated_at),
        stamps: (stamps.data ?? []).filter((s) => s.bookmark_id === b.id).map((s) => ({ id: s.id, sec: s.seconds, note: s.note })).sort((a, z) => a.sec - z.sec),
      };
    }

    await this.applyMerged(scope, merged, mergedPats, favList, tutorials, dirty.has('interest|me') ? null : (interest.data?.email ?? ''));
  }

  private async applyMerged(scope: string, projects: Project[], patterns: Pattern[], favorites: string[], tutorials: Record<string, TutorialData>, interestEmail: string | null): Promise<void> {
    const s = scope as `user:${string}`;
    const old = this.store.projects();
    for (const p of old) if (!projects.some((x) => x.id === p.id)) await this.db.removeProject(s, p.id);
    for (const p of projects) await this.db.putProject(s, p);
    const oldPats = this.store.patterns();
    for (const p of oldPats) if (!p.isSample && !patterns.some((x) => x.id === p.id)) await this.db.removePattern(s, p.id);
    for (const p of patterns) if (!p.isSample) await this.db.putPattern(s, p);
    await this.db.patchDocs(s, { favorites, tutorials, lastSyncAt: Date.now(), ...(interestEmail !== null ? { storeEmail: interestEmail, storeNotified: !!interestEmail } : {}) });
    this.store.projects.set(projects);
    this.store.patterns.set(patterns);
    this.store.favorites.set(favorites);
    this.store.tutorials.set(tutorials);
    if (interestEmail !== null) {
      this.store.storeEmail.set(interestEmail);
      this.store.storeNotified.set(!!interestEmail);
    }
  }

  private emptyTracker(): Project['tracker'] {
    return { mode: 'simple', simple: createSimpleCounter(), patternId: null, cursor: createPatternCursor(), updatedAt: 0 };
  }

  /* ------------------------------------------------------------------ */
  /* private media                                                       */
  /* ------------------------------------------------------------------ */

  /** Short-lived signed URL for a private storage object (cached). */
  async signedUrl(path: string, bucket: 'project-photos' | 'pattern-files' = 'project-photos'): Promise<string | null> {
    if (!this.sb || !path) return null;
    const hit = this.signed.get(path);
    if (hit && hit.exp > Date.now() + 60_000) return hit.url;
    const { data } = await this.sb.storage.from(bucket).createSignedUrl(path, 3600);
    if (!data?.signedUrl) return null;
    this.signed.set(path, { url: data.signedUrl, exp: Date.now() + 3600_000 });
    return data.signedUrl;
  }

  /** Uploads a pattern reference file (PDF / image) right away; returns the storage path. */
  async uploadPatternFile(patternId: string, file: File): Promise<string | null> {
    if (!this.active() || !this.net.online()) return null;
    const uid = this.uid();
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
    const path = `${uid}/${patternId}/source.${ext}`;
    const { error } = await this.sb!.storage.from('pattern-files').upload(path, file, { contentType: file.type, upsert: true });
    return error ? null : path;
  }
}
