import { Injectable, computed, inject, signal } from '@angular/core';
import { AppStore } from '../state/app.store';
import { LocalDb } from '../storage/local-db';
import { uuid } from '../state/factories';

interface Running {
  readonly projectId: string;
  readonly startedAt: number;
}

/**
 * Work timer. Time is derived from timestamps (not tick counting), so it stays correct
 * while the app is backgrounded. Each stop commits seconds to the project and records a
 * work session for sync.
 */
@Injectable({ providedIn: 'root' })
export class TimerService {
  private readonly store = inject(AppStore);
  private readonly db = inject(LocalDb);
  readonly running = signal<Running | null>(null);
  readonly now = signal(Date.now());
  private iv: ReturnType<typeof setInterval> | null = null;

  readonly isOn = computed(() => !!this.running());

  elapsedFor(projectId: string, base: number): number {
    const r = this.running();
    const extra = r && r.projectId === projectId ? Math.max(0, Math.floor((this.now() - r.startedAt) / 1000)) : 0;
    return base + extra;
  }

  start(projectId: string): void {
    if (this.running()) void this.stop();
    this.running.set({ projectId, startedAt: Date.now() });
    this.now.set(Date.now());
    this.iv ??= setInterval(() => this.now.set(Date.now()), 1000);
  }

  async stop(): Promise<void> {
    const r = this.running();
    if (!r) return;
    this.running.set(null);
    if (this.iv) {
      clearInterval(this.iv);
      this.iv = null;
    }
    await this.commit(r, Date.now());
  }

  async toggle(projectId: string): Promise<void> {
    if (this.running()?.projectId === projectId) await this.stop();
    else this.start(projectId);
  }

  /** Persist elapsed time without stopping (used when the app goes to background). */
  async checkpoint(): Promise<void> {
    const r = this.running();
    if (!r) return;
    const now = Date.now();
    this.running.set({ projectId: r.projectId, startedAt: now });
    await this.commit(r, now);
  }

  private async commit(r: Running, endedAt: number): Promise<void> {
    const seconds = Math.max(0, Math.min(86400, Math.floor((endedAt - r.startedAt) / 1000)));
    if (seconds < 1) return;
    await this.store.updateProject(r.projectId, (p) => ({ ...p, workedSeconds: p.workedSeconds + seconds, lastWorkedAt: endedAt }));
    const scope = this.store.scope();
    if (scope !== 'guest') {
      await this.db.enqueue({ scope, kind: 'session', id: uuid(), op: 'upsert', payload: { projectId: r.projectId, startedAt: r.startedAt, endedAt, seconds } });
      this.store.onQueued?.();
    }
  }
}
