import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const R = 104;
const CIRC = 2 * Math.PI * R;

/** Circular progress ring from the tracker design (lavender track, purple/mint arc). */
@Component({
  selector: 'gz-ring',
  template: `
    <div class="wrap" [class.gz-glow]="done()" [style.width.px]="size()" [style.height.px]="size()">
      <svg viewBox="0 0 240 240" [style.width.px]="size()" [style.height.px]="size()" aria-hidden="true">
        <circle cx="120" cy="120" r="104" fill="none" [style.stroke]="'var(--gz-lavender-200)'" [attr.stroke-width]="stroke()" />
        <circle
          class="gz-ring-arc"
          cx="120"
          cy="120"
          r="104"
          fill="none"
          stroke-linecap="round"
          [style.stroke]="done() ? 'var(--gz-mint-ink)' : 'var(--gz-primary)'"
          [attr.stroke-width]="stroke()"
          [style.stroke-dasharray]="dash()"
        />
      </svg>
      <div class="center" role="status" aria-live="polite"><ng-content /></div>
    </div>
  `,
  styles: `
    :host { display: block; }
    .wrap { position: relative; }
    svg { transform: rotate(-90deg); display: block; }
    .center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RingComponent {
  readonly fraction = input(0);
  readonly size = input(236);
  readonly stroke = input(15);
  readonly done = input(false);
  protected readonly dash = computed(() => {
    const f = Math.max(0, Math.min(1, this.fraction()));
    return `${(CIRC * f).toFixed(1)} ${CIRC.toFixed(1)}`;
  });
}
