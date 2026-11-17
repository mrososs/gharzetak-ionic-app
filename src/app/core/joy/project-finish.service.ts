import { Injectable, inject } from '@angular/core';
import { TimerService } from '../services/timer.service';
import { AppStore } from '../state/app.store';

/**
 * The ONE way a project is marked finished by the user (counter, project page, "all pieces done" sheet).
 * The work timer is stopped FIRST, so the recorded time the finale shows is final, and only then is the status changed with the
 * explicit `finish` origin — the only origin that can create the project-completion celebration. Finishing is never done silently.
 */
@Injectable({ providedIn: 'root' })
export class ProjectFinishService {
  private readonly store = inject(AppStore);
  private readonly timer = inject(TimerService);

  async finish(projectId: string): Promise<void> {
    const p = this.store.project(projectId);
    if (!p || p.status === 'done') return;
    if (this.timer.stateFor(projectId) !== 'idle') await this.timer.stop();
    await this.store.setStatus(projectId, 'done', 'finish');
  }
}
