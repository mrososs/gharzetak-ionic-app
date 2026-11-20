import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { I18nService } from '../../../core/i18n/i18n.service';
import { TourCoordinator, TourOffer } from '../../../core/tour/tour-coordinator.service';
import type { TourId } from '../../../core/tour/tour-ids';
import { L, fill, pick } from '../../../core/tour/tour-labels';
import { IconComponent } from '../icon/icon.component';

/**
 * The first-visit invitation for a screen's tour: a quiet bar at the top of the page content. It never starts anything by itself and never
 * dims the screen. It appears only at a moment that is safe to start a tour, and once shown it stays put for the visit (so the page never
 * jumps under a finger), disappearing only when the tour is started, dismissed, or the person leaves the screen.
 */
@Component({
  selector: 'gz-tour-offer',
  imports: [IconComponent],
  template: `
    @if (shown(); as o) {
      <section class="pill" role="status" data-tour-offer>
        <svg gzIcon="sparkles" size="s" />
        <span class="txt">{{ text(o) }}</span>
        <button type="button" class="go" (click)="start(o)">{{ pick(L.startShort) }}</button>
        <button type="button" class="x" (click)="dismiss(o)" [attr.aria-label]="pick(L.notNow)"><svg gzIcon="x" size="s" /></button>
      </section>
    }
  `,
  styles: `
    :host { display: block; }
    .pill {
      display: flex; align-items: center; gap: 8px; min-height: 52px; margin: 4px 0 12px; padding: 4px 4px 4px 12px; padding-inline: 12px 4px;
      border-radius: var(--gz-r-sm); background: var(--gz-lavender-100); color: var(--gz-text); font-size: 13.5px; font-weight: var(--gz-fw-semibold); line-height: 1.5;
    }
    .pill > svg { color: var(--gz-primary); }
    .txt { flex: 1; min-width: 0; }
    .go {
      min-height: 44px; min-width: 44px; padding: 0 16px; border: 0; border-radius: var(--gz-r-sm); background: var(--gz-primary); color: #fff;
      font: inherit; font-weight: var(--gz-fw-bold); cursor: pointer;
    }
    .x { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border: 0; background: none; color: var(--gz-text-3); cursor: pointer; border-radius: 50%; }
    .go:focus-visible, .x:focus-visible { outline: 3px solid var(--gz-primary); outline-offset: 2px; }
    @media (prefers-reduced-motion: no-preference) { .pill { animation: pillIn 0.2s ease-out; } }
    @keyframes pillIn { from { opacity: 0; } to { opacity: 1; } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TourOfferComponent {
  private readonly coordinator = inject(TourCoordinator);
  private readonly i18n = inject(I18nService);
  protected readonly L = L;

  /** Candidate tours for this screen, most specific first; the first one that applies is offered. */
  readonly tours = input<readonly TourId[]>([]);

  private readonly offer = computed(() => this.coordinator.pillOffer(this.tours()));
  private readonly latched = signal(false);
  protected readonly shown = computed<TourOffer | null>(() => (this.latched() ? this.offer() : null));

  constructor() {
    effect(() => {
      const o = this.offer();
      const safe = this.coordinator.canStartNow();
      untracked(() => {
        if (!o) this.latched.set(false);
        else if (!this.latched() && safe) this.latched.set(true);
      });
    });
    effect(() => {
      const s = this.shown();
      if (s) untracked(() => this.coordinator.notePillShown(s));
    });
  }

  protected pick(t: { ar: string; en: string }): string {
    return pick(t, this.i18n.lang());
  }

  protected text(o: TourOffer): string {
    const lang = this.i18n.lang();
    // The number is isolated left-to-right so Arabic text cannot reorder it.
    return o.kind === 'resume' ? pick(L.pillResume, lang) : fill(pick(L.pillFirst, lang), { n: `⁦${o.steps}⁩` });
  }

  protected start(o: TourOffer): void {
    void this.coordinator.accept(o.tour);
  }

  protected dismiss(o: TourOffer): void {
    void this.coordinator.decline(o.tour);
  }
}
