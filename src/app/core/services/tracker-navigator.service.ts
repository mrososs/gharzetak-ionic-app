import { Injectable, inject } from '@angular/core';
import { NavController } from '@ionic/angular';
import { AppStore } from '../state/app.store';
import { TimerService } from './timer.service';

export type OpenTrackerResult = 'opened' | 'missing' | 'done';

/**
 * Opens the counter on a project and (optionally) one of its pieces. The ONE implementation of "go to Project → active piece":
 * used by the project page's piece list and by notification taps, so both behave identically (the running work timer moves with the
 * piece: no gap, no double counting).
 */
@Injectable({ providedIn: 'root' })
export class TrackerNavigator {
  private readonly store = inject(AppStore);
  private readonly timer = inject(TimerService);
  private readonly nav = inject(NavController);

  /**
   * @param instanceId the piece to continue on. An unknown or retired piece is ignored: the counter then opens on the project's current piece.
   * @param allowDone  a finished project is only opened when the user explicitly chose it (a reminder must not reopen the counter of a finished project).
   */
  async open(projectId: string, instanceId: string | null = null, allowDone = false): Promise<OpenTrackerResult> {
    const p = this.store.project(projectId);
    if (!p) return 'missing';
    if (p.status === 'done' && !allowDone) return 'done';
    const inst = instanceId ? (p.parts ?? []).find((i) => i.id === instanceId && !i.retired) : undefined;
    if (inst) {
      await this.store.setActiveInstance(p.id, inst.id);
      await this.timer.switchInstance(p.id, inst.id);
    }
    await this.store.setCurrentProject(p.id);
    await this.nav.navigateRoot('/tabs/tracker');
    return 'opened';
  }
}
