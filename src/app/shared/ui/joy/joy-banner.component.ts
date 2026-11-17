import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { JoyPresenter } from '../../../core/joy/joy-presenter.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { AppStore } from '../../../core/state/app.store';
import { AvatarReactionComponent } from '../avatar/avatar-reaction.component';
import { IconComponent } from '../icon/icon.component';

/**
 * Level-1 round celebration. Never a modal, never takes focus, never blocks a tap:
 *  - floating (default): a pointer-transparent overlay pinned just under the header — it never covers the counter or the tap row;
 *    only the pill itself (and its dismiss button) receives touches. Put it in `ion-content` with `slot="fixed"`.
 *  - inline: a single reserved line inside a card (video page), so nothing ever shifts or covers the video.
 * The container is a permanent polite live region, so a screen reader announces each banner exactly once.
 */
@Component({
  selector: 'gz-joy-banner',
  imports: [AvatarReactionComponent, IconComponent],
  template: `
    <div class="live" role="status" aria-live="polite" aria-atomic="true">
      @if (presenter.banner(); as b) {
        <div class="pill" [class.small]="inline()">
          <gz-avatar-reaction [id]="store.avatar()" [mood]="b.mood" [size]="inline() ? 24 : 32" [run]="b.id" />
          <span class="txt">{{ b.text }}</span>
          <button type="button" class="x" (click)="presenter.dismissBanner()" [attr.aria-label]="i18n.q('إخفاء', 'Dismiss')"><svg gzIcon="x" size="s" /></button>
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; pointer-events: none; }
    :host(:not(.inline)) { position: absolute; inset-block-start: 8px; inset-inline: 12px; z-index: 30; }
    /* inline: a reserved line, so showing / hiding it never moves anything */
    :host(.inline) { position: static; min-height: 34px; }
    .live { display: flex; justify-content: center; }
    .pill {
      pointer-events: auto; display: flex; align-items: center; gap: 8px; box-sizing: border-box; max-width: min(100%, 420px);
      padding-block: 6px; padding-inline: 10px 4px; background: var(--gz-surface); border: 1px solid var(--gz-pink-200);
      border-radius: 22px; box-shadow: var(--gz-shadow-card); color: var(--gz-text); font-weight: 700; font-size: 14px; line-height: 1.35;
      animation: gzBannerIn 200ms ease-out both;
    }
    .pill.small { padding-block: 3px; font-size: 13px; box-shadow: none; background: var(--gz-pink-100); }
    /* two lines at most, so a long Arabic sentence still fits a 320px phone without growing */
    .txt { flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .x { flex: none; width: 32px; height: 32px; border: 0; border-radius: 50%; background: transparent; color: var(--gz-text-3); display: inline-grid; place-items: center; cursor: pointer; }
    .x:focus-visible { outline: 3px solid var(--gz-primary); outline-offset: 1px; }
    @keyframes gzBannerIn { from { opacity: 0; transform: translateY(-6px) scale(0.97); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .pill { animation: none !important; } }
  `,
  host: { '[class.inline]': 'inline()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JoyBannerComponent {
  protected readonly presenter = inject(JoyPresenter);
  protected readonly store = inject(AppStore);
  protected readonly i18n = inject(I18nService);

  readonly inline = input(false);
}
