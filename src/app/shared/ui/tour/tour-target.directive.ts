import { Directive, ElementRef, effect, inject, input } from '@angular/core';
import type { TargetId } from '../../../core/tour/tour-ids';
import { TourTargetRegistry } from '../../../core/tour/tour-target.registry';

/**
 * Marks an element as something a product tour can point at: `<button [gzTour]="'tracker.tap'">`.
 * It writes `data-tour` (for DevTools and browser tests) and registers the element for the lifetime of its component. Pass null to
 * switch it off for one item of a list.
 */
@Directive({
  selector: '[gzTour]',
  host: { '[attr.data-tour]': 'gzTour() || null' },
})
export class TourTargetDirective {
  readonly gzTour = input<TargetId | null | undefined>();
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly registry = inject(TourTargetRegistry);

  constructor() {
    effect((onCleanup) => {
      const id = this.gzTour();
      if (!id) return;
      this.registry.register(id, this.el);
      onCleanup(() => this.registry.unregister(id, this.el));
    });
  }
}
