import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { achievementDef } from '../../../core/joy/achievements';
import { I18nService } from '../../../core/i18n/i18n.service';
import { MilestoneView, JoyPresenter } from '../../../core/joy/joy-presenter.service';
import { AppStore } from '../../../core/state/app.store';
import { ShareLauncher } from '../../../core/joy/share-launcher.service';
import { ShareSource } from '../../../core/joy/share-card';
import { AvatarReactionComponent } from '../avatar/avatar-reaction.component';
import { IconComponent } from '../icon/icon.component';

/**
 * Level-2 milestone card (25 / 50 / 75 %, or every 10th round of open-ended counting).
 * Deliberately ONE compact row (~52px): it must fit between the header and the counter ring on a 320×640 phone and never hide the
 * stitch counter or the tap row. Non-modal, never takes focus, pointer-transparent except for the card, collapses by itself.
 * Put it in `ion-content` with `slot="fixed"` next to `<gz-joy-banner>`; the presenter shows only one of them at a time.
 */
@Component({
  selector: 'gz-joy-milestone',
  imports: [AvatarReactionComponent, IconComponent],
  template: `
    <div class="live" role="status" aria-live="polite" aria-atomic="true">
      @if (presenter.card(); as c) {
        <section class="card">
          <gz-avatar-reaction [id]="store.avatar()" [mood]="c.mood" [size]="36" [run]="c.id" />
          <div class="body">
            <div class="title">{{ c.title }}</div>
            @if (detail(c); as d) {
              <div class="sub">{{ d }}</div>
            }
          </div>
          @if (c.share) {
            <button type="button" class="sh" (click)="shareCard(c.share)" [attr.aria-label]="i18n.q('مشاركة التقدّم', 'Share progress')"><svg gzIcon="send" size="s" /></button>
          }
          <button type="button" class="go" (click)="presenter.dismissCard()">{{ i18n.q('كمّلي', 'Continue') }}</button>
          @if (c.pct !== null) {
            <div class="bar" role="img" [attr.aria-label]="c.pct + '%'"><i [style.width.%]="c.pct"></i></div>
          }
        </section>
      }
    </div>
  `,
  styles: `
    :host { display: block; position: absolute; inset-block-start: 8px; inset-inline: 12px; z-index: 30; pointer-events: none; }
    .live { display: flex; justify-content: center; }
    .card {
      position: relative; overflow: hidden; pointer-events: auto; display: flex; align-items: center; gap: 8px; box-sizing: border-box;
      width: min(100%, 420px); min-height: 52px; padding-block: 4px; padding-inline: 10px 4px; background: var(--gz-pink-100);
      border: 1px solid var(--gz-pink-200); border-radius: 18px; box-shadow: var(--gz-shadow-card); color: var(--gz-text);
      animation: gzMileIn 220ms ease-out both;
    }
    .body { flex: 1; min-width: 0; }
    .title { font-weight: 800; font-size: 14px; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sub { font-size: 12px; color: var(--gz-text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* a 44px-high touch target inside the 52px card */
    .go { flex: none; min-width: 44px; min-height: 44px; padding: 0 10px; border: 0; border-radius: 14px; background: none; color: var(--gz-primary); font: inherit; font-weight: 800; font-size: 13px; cursor: pointer; }
    .sh { flex: none; width: 44px; height: 44px; border: 0; border-radius: 14px; background: none; color: var(--gz-primary); display: inline-grid; place-items: center; cursor: pointer; }
    .go:focus-visible, .sh:focus-visible { outline: 3px solid var(--gz-primary); outline-offset: -2px; }
    .bar { position: absolute; inset-inline: 0; inset-block-end: 0; height: 4px; background: var(--gz-pink-200); }
    .bar i { display: block; height: 100%; background: var(--gz-primary); border-radius: 0 4px 4px 0; }
    @keyframes gzMileIn { from { opacity: 0; transform: translateY(-8px) scale(0.98); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .card { animation: none !important; } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JoyMilestoneComponent {
  protected readonly presenter = inject(JoyPresenter);
  protected readonly store = inject(AppStore);
  protected readonly i18n = inject(I18nService);
  private readonly launcher = inject(ShareLauncher);

  /** Opens the share-card sheet (a user action). The card is only rendered there, and nothing is sent until the user presses Share. */
  protected shareCard(src: ShareSource): void {
    this.presenter.dismissCard();
    this.launcher.open(src);
  }

  /** The detail line: a newly earned badge wins over the progress text (it is rarer); otherwise the project / piece and its progress. */
  protected detail(c: MilestoneView): string {
    const names = c.badges.map((id) => achievementDef(id)).filter((d) => !!d).map((d) => `${d!.emoji} ${d!.name[this.i18n.lang()]}`);
    return names.length ? names.join(' · ') : c.body;
  }
}
