import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { I18nService } from '../../../core/i18n/i18n.service';
import type { GsTask } from '../../../core/tour/getting-started';
import { TourCoordinator } from '../../../core/tour/tour-coordinator.service';
import { GS_ROWS, L, fill, pick } from '../../../core/tour/tour-labels';
import { IconComponent } from '../icon/icon.component';
import { TourTargetDirective } from './tour-target.directive';

/**
 * The Getting Started card on Home. One surface, four states: the invitation to the welcome tour, the list of five first steps, a short
 * completion message, or nothing. A task is ticked only by the real action (see core/tour/getting-started.ts); tapping a row only
 * navigates, and the card never creates or changes anything for the person.
 */
@Component({
  selector: 'gz-getting-started',
  imports: [IconComponent, TourTargetDirective],
  template: `
    @if (view(); as v) {
      @if (v.state !== 'hidden') {
        <section class="gs" [gzTour]="'home.getting-started'" [attr.aria-label]="pick(L.gsTitle)" [attr.data-gs]="v.state">
          <header class="head">
            <div class="gz-tile t-blush tile"><svg gzIcon="sparkles" /></div>
            <div class="titles">
              @switch (v.state) {
                @case ('offer') {
                  <h2 class="ttl gz-hd">{{ pick(L.offerTitle) }}</h2>
                  <p class="sub gz-sm gz-mute">{{ pick(L.offerBody) }}</p>
                }
                @case ('done') {
                  <h2 class="ttl gz-hd">{{ pick(L.gsDoneTitle) }}</h2>
                  <p class="sub gz-sm gz-mute">{{ pick(L.gsDoneBody) }}</p>
                }
                @default {
                  <h2 class="ttl gz-hd">{{ pick(L.gsTitle) }}</h2>
                  <p class="sub gz-xs gz-mute">{{ progress(v.doneCount, v.total) }}</p>
                }
              }
            </div>
            @if (v.state === 'list') {
              <button type="button" class="gz-lnk gz-sm hide" (click)="hide()">{{ pick(L.hide) }}</button>
            }
          </header>

          @switch (v.state) {
            @case ('offer') {
              <div class="acts">
                <button type="button" class="gz-btn" data-gs-start (click)="start()">{{ pick(L.start) }}</button>
                <button type="button" class="gz-btn-text" data-gs-notnow (click)="notNow()">{{ pick(L.notNow) }}</button>
              </div>
            }
            @case ('list') {
              <div class="gz-bar thin bar" aria-hidden="true"><i [style.width.%]="(v.doneCount / v.total) * 100"></i></div>
              <ul class="rows" role="list" [attr.aria-label]="pick(L.gsListAria)">
                @for (r of v.tasks; track r.id) {
                  <li>
                    <button type="button" class="row" [class.done]="r.done" [disabled]="r.done" [attr.data-task]="r.id" (click)="open(r.id)">
                      <span class="mark" aria-hidden="true">@if (r.done) {<svg gzIcon="check" size="s" />}</span>
                      <span class="lbl">{{ rowLabel(r.id) }}@if (r.done) {<span class="gz-sr"> — {{ pick(L.gsDoneWord) }}</span>}</span>
                      @if (!r.done) {<svg gzIcon="chevr" size="s" [flip]="true" class="chev" />}
                    </button>
                  </li>
                }
              </ul>
            }
          }
        </section>
      }
    }
  `,
  styles: `
    :host { display: block; }
    .gs { margin-top: 14px; padding: 16px 16px 8px; border: 1.5px solid var(--gz-pink-200); border-radius: var(--gz-r-md); background: var(--gz-surface-elevated); }
    .head { display: flex; align-items: center; gap: 12px; }
    .tile { width: 44px; height: 44px; flex: none; }
    .titles { flex: 1; min-width: 0; }
    .ttl { margin: 0; font-size: 16px; }
    .sub { margin: 2px 0 0; }
    .hide { flex: none; }
    .acts { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; padding-bottom: 8px; }
    .bar { margin: 12px 0 6px; }
    .rows { list-style: none; margin: 0; padding: 0; }
    .row {
      display: flex; align-items: center; gap: 12px; width: 100%; min-height: 48px; padding: 0 2px; border: 0; border-top: 1px solid var(--gz-border);
      background: none; color: var(--gz-text); font: inherit; font-weight: var(--gz-fw-semibold); font-size: 14.5px; text-align: start; cursor: pointer;
    }
    li:first-child .row { border-top: 0; }
    .row:focus-visible { outline: 3px solid var(--gz-primary); outline-offset: -3px; border-radius: var(--gz-r-xs); }
    .mark {
      display: flex; align-items: center; justify-content: center; flex: none; width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--gz-border-strong);
    }
    .row.done { cursor: default; color: var(--gz-text-3); }
    .row.done .lbl { text-decoration: line-through; }
    .row.done .mark { border: 0; background: var(--gz-success-bg); color: var(--gz-success); }
    .lbl { flex: 1; min-width: 0; }
    .chev { color: var(--gz-text-3); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GettingStartedComponent {
  private readonly coordinator = inject(TourCoordinator);
  private readonly i18n = inject(I18nService);
  protected readonly L = L;
  protected readonly view = this.coordinator.gettingStarted;
  protected readonly lang = computed(() => this.i18n.lang());

  protected pick(t: { ar: string; en: string }): string {
    return pick(t, this.lang());
  }

  protected rowLabel(id: GsTask): string {
    return pick(GS_ROWS[id], this.lang());
  }

  protected progress(n: number, total: number): string {
    // Numbers are isolated left-to-right so Arabic text cannot reorder them.
    return fill(pick(L.gsProgress, this.lang()), { n: `⁦${n}⁩`, total: `⁦${total}⁩` });
  }

  protected start(): void {
    void this.coordinator.accept('welcome');
  }

  protected notNow(): void {
    void this.coordinator.decline('welcome');
  }

  protected hide(): void {
    void this.coordinator.hideGettingStarted();
  }

  protected open(task: GsTask): void {
    void this.coordinator.openTask(task);
  }
}
