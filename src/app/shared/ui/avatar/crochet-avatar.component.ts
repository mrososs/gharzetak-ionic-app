import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { AVATARS, AvatarId, avatarSrc } from '../../../core/data/avatars';
import { I18nService } from '../../../core/i18n/i18n.service';

/** A bundled crochet avatar (static SVG, transparent corners, built-in pastel disc). `<gz-crochet-avatar id="bunny" [size]="48" />` */
@Component({
  selector: 'gz-crochet-avatar',
  template: `<img [src]="src()" [width]="size()" [height]="size()" [alt]="decorative() ? '' : label()" [attr.aria-hidden]="decorative() ? 'true' : null" decoding="async" draggable="false" />`,
  styles: `
    :host { display: inline-flex; flex: none; width: calc(var(--av, 1) * 1px); line-height: 0; }
    img { display: block; width: 100%; height: auto; aspect-ratio: 1; user-select: none; -webkit-user-drag: none; }
  `,
  host: { '[style.--av]': 'size()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CrochetAvatarComponent {
  private readonly i18n = inject(I18nService);
  readonly id = input.required<AvatarId>();
  readonly size = input(48);
  /** Purely decorative (next to a visible name): hides it from screen readers. */
  readonly decorative = input(false);
  protected readonly src = computed(() => avatarSrc(this.id()));
  protected readonly label = computed(() => AVATARS[this.id()][this.i18n.lang()]);
}
