import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ICONS, IconName } from '../../../core/data/icons';

/**
 * Design-system icon: `<svg gzIcon="heart" size="s" />`.
 * `flip` mirrors direction-aware icons (arrows/chevrons) in RTL.
 */
@Component({
  selector: 'svg[gzIcon]',
  template: `<svg:path [attr.d]="d()" />`,
  host: {
    viewBox: '0 0 24 24',
    'aria-hidden': 'true',
    focusable: 'false',
    '[class]': 'cls()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconComponent {
  readonly gzIcon = input.required<IconName>();
  readonly size = input<'' | 's' | 'l' | 'xl'>('');
  readonly flip = input(false);
  readonly fill = input(false);
  protected readonly d = computed(() => ICONS[this.gzIcon()] ?? '');
  protected readonly cls = computed(() => ['gz-ic', this.size(), this.flip() ? 'gz-flip' : '', this.fill() ? 'f' : ''].filter(Boolean).join(' '));
}
