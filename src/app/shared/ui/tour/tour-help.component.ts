import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { I18nService } from '../../../core/i18n/i18n.service';
import { AppStore } from '../../../core/state/app.store';
import { ReplayResult, TourCoordinator } from '../../../core/tour/tour-coordinator.service';
import type { TourId } from '../../../core/tour/tour-ids';
import { L, pick } from '../../../core/tour/tour-labels';
import type { LocalText } from '../../../core/tour/tour.types';
import { UiFeedback } from '../feedback/toast.service';
import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../../../core/data/icons';

interface Row {
  readonly id: TourId | 'list';
  readonly label: LocalText;
  readonly icon: IconName;
}

/**
 * Settings → "Tours & help": replay any tour, or bring the Getting Started list back. Sits next to (and never replaces) the existing
 * "Replay app intro", which replays the onboarding slides. A replay goes to the tour's screen first and never changes a finished tour.
 */
@Component({
  selector: 'gz-tour-help',
  imports: [IconComponent],
  template: `
    @if (coordinator.enabled()) {
      <div class="gz-sec"><h2 class="gz-h3 gz-hd" id="se-tours-h">{{ pick(L.helpSection) }}</h2></div>
      <div role="group" aria-labelledby="se-tours-h" data-tour-help>
        @for (r of rows(); track r.id) {
          <button type="button" class="gz-btn3 w mt-2" [attr.data-help]="r.id" (click)="run(r)"><svg [gzIcon]="r.icon" size="s" />{{ pick(r.label) }}</button>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TourHelpComponent {
  protected readonly coordinator = inject(TourCoordinator);
  private readonly store = inject(AppStore);
  private readonly i18n = inject(I18nService);
  private readonly ui = inject(UiFeedback);
  protected readonly L = L;

  /** The pieces tour needs a multi-part project; the row appears only when one exists. */
  private readonly hasParts = computed(() => this.store.projects().some((p) => !!p.parts?.length));

  protected readonly rows = computed<readonly Row[]>(() => [
    { id: 'welcome', label: L.helpWelcome, icon: 'reset' },
    { id: 'patterns', label: L.helpPatterns, icon: 'reset' },
    { id: 'tracker-simple', label: L.helpTracker, icon: 'reset' },
    { id: 'project-create', label: L.helpProject, icon: 'reset' },
    ...(this.hasParts() ? ([{ id: 'tracker-parts', label: L.helpParts, icon: 'reset' }] as const) : []),
    { id: 'khayoota', label: L.helpKhayoota, icon: 'reset' },
    { id: 'list', label: L.helpList, icon: 'list' },
  ]);

  protected pick(t: LocalText): string {
    return pick(t, this.i18n.lang());
  }

  protected async run(r: Row): Promise<void> {
    if (r.id === 'list') {
      await this.coordinator.restoreGettingStarted();
      await this.ui.toast(pick(L.helpListRestored, this.i18n.lang()));
      return;
    }
    const result: ReplayResult = await this.coordinator.replay(r.id);
    const msg = result === 'needs-project' ? L.helpNeedsProject : result === 'needs-parts' ? L.helpNeedsParts : result === 'unavailable' ? L.helpUnavailable : null;
    if (msg) await this.ui.toast(pick(msg, this.i18n.lang()));
  }
}
