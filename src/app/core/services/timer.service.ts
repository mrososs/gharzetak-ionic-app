import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AppStore } from '../state/app.store';
import { LocalDb } from '../storage/local-db';
import { uuid } from '../state/factories';

interface Segment {
  readonly projectId: string;
  /** The part instance being worked on (multi-part projects), or null for the whole project. */
  readonly instanceId: string | null;
  readonly startedAt: number;
}

/** How often a running segment is checkpointed to storage so a force-stop can lose at most this much. */
const BEAT_MS = 5000;
/** A single committed segment can never exceed one day (guards a clock jump / a forgotten timer). */
const MAX_SEGMENT_S = 86_400;

/**
 * Work timer — the authoritative source of recorded time (`Project.workedSeconds`).
 *
 *   idle ──start──▶ running ──pause──▶ paused ──resume──▶ running
 *                      └────────stop──────▶ idle (from running or paused)
 *
 *  - Time is derived from timestamps (not tick counting), so it stays correct while the app is backgrounded.
 *  - Every pause / stop / part switch commits the segment's whole seconds ONCE: to the project total and, for multi-part
 *    projects, to the active part instance. The instance time is a breakdown of the project total, never added on top.
 *  - Only one segment can run at a time (starting elsewhere commits the previous one first; commits are serialised).
 *  - The running segment is persisted every few seconds. If the app is force-stopped, the next launch credits the time up
 *    to the last heartbeat and leaves the timer paused, so nothing is lost and nothing is invented.
 */
@Injectable({ providedIn: 'root' })
export class TimerService {
  private readonly store = inject(AppStore);
  private readonly db = inject(LocalDb);

  readonly running = signal<Segment | null>(null);
  /** A paused session (shown as "Resume"); cleared by stop(). */
  readonly paused = signal<{ projectId: string; instanceId: string | null } | null>(null);
  readonly now = signal(Date.now());
  /** Seconds credited by crash recovery on this launch (the UI tells the user once). */
  readonly recovered = signal<number | null>(null);
  private iv: ReturnType<typeof setInterval> | null = null;
  private beatAt = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private recoveredFor: string | null = null;

  readonly isOn = computed(() => !!this.running());

  constructor() {
    // Crash / force-stop recovery runs once per loaded scope.
    effect(() => {
      const loaded = this.store.loaded();
      const scope = this.store.scope();
      if (loaded && this.recoveredFor !== scope) {
        this.recoveredFor = scope;
        untracked(() => void this.recover(scope));
      }
    });
  }

  elapsedFor(projectId: string, base: number): number {
    const r = this.running();
    const extra = r && r.projectId === projectId ? Math.max(0, Math.floor((this.now() - r.startedAt) / 1000)) : 0;
    return base + extra;
  }

  /** Recorded seconds of one part instance including the segment that is running right now. */
  elapsedForInstance(projectId: string, instanceId: string, base: number): number {
    const r = this.running();
    const extra = r && r.projectId === projectId && r.instanceId === instanceId ? Math.max(0, Math.floor((this.now() - r.startedAt) / 1000)) : 0;
    return base + extra;
  }

  /** Is the timer running on this project (and, if given, this part instance)? */
  isRunningOn(projectId: string, instanceId?: string | null): boolean {
    const r = this.running();
    return !!r && r.projectId === projectId && (instanceId === undefined || r.instanceId === instanceId);
  }

  /** 'running' | 'paused' | 'idle' for a project. */
  stateFor(projectId: string): 'running' | 'paused' | 'idle' {
    if (this.running()?.projectId === projectId) return 'running';
    if (this.paused()?.projectId === projectId) return 'paused';
    return 'idle';
  }

  /** Starts (or restarts) the timer on a project / part instance. Starting while one is already running there is a no-op. */
  async start(projectId: string, instanceId: string | null = null): Promise<void> {
    const cur = this.running();
    if (cur && cur.projectId === projectId && cur.instanceId === instanceId) return;
    await this.serial(async () => {
      const r = this.running();
      if (r && r.projectId === projectId && r.instanceId === instanceId) return; // another tap won the race
      if (r) await this.commitRunning(Date.now());
      this.begin({ projectId, instanceId, startedAt: Date.now() });
    });
  }

  /** Pauses: commits the recorded seconds and remembers where to resume. */
  async pause(): Promise<void> {
    await this.serial(async () => {
      const r = this.running();
      if (!r) return;
      await this.commitRunning(Date.now());
      this.paused.set({ projectId: r.projectId, instanceId: r.instanceId });
    });
  }

  async resume(): Promise<void> {
    const p = this.paused();
    if (!p) return;
    await this.start(p.projectId, p.instanceId);
  }

  /** Ends the session (from running or paused). */
  async stop(): Promise<void> {
    await this.serial(async () => {
      if (this.running()) await this.commitRunning(Date.now());
      this.paused.set(null);
    });
  }

  /** One-button behaviour for the tracker chip: running → pause, paused → resume, idle → start. */
  async toggle(projectId: string, instanceId: string | null = null): Promise<void> {
    const s = this.stateFor(projectId);
    if (s === 'running') {
      if (this.running()!.instanceId === instanceId) await this.pause();
      else await this.start(projectId, instanceId); // a different part: switch without losing time
    } else if (s === 'paused') await this.start(projectId, instanceId ?? this.paused()!.instanceId);
    else await this.start(projectId, instanceId);
  }

  /**
   * The user moved to another part while the timer runs: the time so far goes to the part they were on, and a new segment starts
   * on the new part at the same instant (no gap, no overlap, no double counting).
   */
  async switchInstance(projectId: string, instanceId: string): Promise<void> {
    const r = this.running();
    if (r && r.projectId === projectId && r.instanceId !== instanceId) await this.start(projectId, instanceId);
    else if (!r && this.paused()?.projectId === projectId) this.paused.set({ projectId, instanceId });
  }

  /** Persist elapsed time without stopping (used when the app goes to background). */
  async checkpoint(): Promise<void> {
    await this.serial(async () => {
      const r = this.running();
      if (!r) return;
      const now = Date.now();
      await this.commit(r, now);
      this.begin({ ...r, startedAt: now });
    });
  }

  /* ------------------------------------------------------------------ */

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private begin(seg: Segment): void {
    this.running.set(seg);
    this.paused.set(null);
    this.now.set(Date.now());
    this.iv ??= setInterval(() => {
      this.now.set(Date.now());
      if (Date.now() - this.beatAt >= BEAT_MS) void this.persist();
    }, 1000);
    void this.persist();
  }

  private async commitRunning(endedAt: number): Promise<void> {
    const r = this.running();
    if (!r) return;
    this.running.set(null);
    if (this.iv) {
      clearInterval(this.iv);
      this.iv = null;
    }
    await this.commit(r, endedAt);
    await this.clearPersisted();
  }

  /** Writes one finished segment: project total (+ part instance breakdown) and a work session for sync. */
  private async commit(r: Segment, endedAt: number): Promise<void> {
    const seconds = Math.max(0, Math.min(MAX_SEGMENT_S, Math.floor((endedAt - r.startedAt) / 1000)));
    if (seconds < 1) return;
    const hasInstance = !!r.instanceId && !!this.store.project(r.projectId)?.parts?.some((i) => i.id === r.instanceId);
    await this.store.updateProject(
      r.projectId,
      (p) => ({
        ...p,
        workedSeconds: p.workedSeconds + seconds,
        lastWorkedAt: endedAt,
        ...(hasInstance
          ? {
              parts: (p.parts ?? []).map((i) => (i.id === r.instanceId ? { ...i, workedSeconds: i.workedSeconds + seconds, updatedAt: endedAt } : i)),
              // the part breakdown travels with the progress row: bump its clock so the next sync pushes it
              tracker: { ...p.tracker, updatedAt: endedAt },
            }
          : {}),
      }),
      hasInstance ? ['project', 'progress'] : ['project'],
    );
    const scope = this.store.scope();
    if (scope !== 'guest') {
      await this.db.enqueue({ scope, kind: 'session', id: uuid(), op: 'upsert', payload: { projectId: r.projectId, startedAt: r.startedAt, endedAt, seconds, partInstanceId: hasInstance ? r.instanceId : null } });
      this.store.onQueued?.();
    }
  }

  /* ------------------------------------------------------------------ */
  /* persistence across restarts                                          */
  /* ------------------------------------------------------------------ */

  private async persist(): Promise<void> {
    const r = this.running();
    if (!r) return;
    this.beatAt = Date.now();
    await this.db.patchDocs(this.store.scope(), { timer: { projectId: r.projectId, instanceId: r.instanceId, startedAt: r.startedAt, beat: this.beatAt } });
  }

  private async clearPersisted(): Promise<void> {
    await this.db.patchDocs(this.store.scope(), { timer: null });
  }

  /**
   * A persisted running segment at launch means the app was killed while timing. Credit the time up to the last heartbeat
   * (never beyond it), leave the timer paused on that part, and tell the user.
   */
  private async recover(scope: string): Promise<void> {
    if (this.running()) return;
    const docs = await this.db.loadDocs(scope as never);
    const t = docs.timer;
    if (!t) return;
    await this.serial(async () => {
      const exists = !!this.store.project(t.projectId);
      const seconds = Math.max(0, Math.min(MAX_SEGMENT_S, Math.floor((t.beat - t.startedAt) / 1000)));
      if (exists && seconds >= 1) {
        await this.commit({ projectId: t.projectId, instanceId: t.instanceId, startedAt: t.startedAt }, t.beat);
        this.recovered.set(seconds);
      }
      if (exists) this.paused.set({ projectId: t.projectId, instanceId: t.instanceId });
      await this.clearPersisted();
    });
  }
}
