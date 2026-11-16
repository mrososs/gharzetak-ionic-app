import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

/**
 * Brand mark. Uses the supplied logo (src/assets/brand/logo.png) when present; otherwise the
 * original flat SVG mark from the Design System (purple tile, pink yarn ball, peach hook, mint thread).
 */
@Component({
  selector: 'gz-brand-mark',
  template: `
    @if (!logoFailed()) {
      <img [src]="logoSrc" [alt]="label()" [style.width.px]="size()" [style.height.px]="size()" (error)="logoFailed.set(true)" />
    } @else {
      <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 48 48" role="img" [attr.aria-label]="label()">
        <rect width="48" height="48" rx="15" fill="#813DB5" />
        <circle cx="21" cy="29" r="12.5" fill="#F56FA8" />
        <path d="M10.2 25.5c7 3.6 15.4 3.2 21.6-1.2M9.4 31.5c7.6 3.4 16.6 2.6 23-2.4M14.5 19c4.6 5 11.6 6.6 17.6 4" fill="none" stroke="#FFF9F5" stroke-width="1.7" stroke-linecap="round" opacity=".92" />
        <path d="M40.5 8.5L27.5 27" fill="none" stroke="#FFCCAA" stroke-width="3" stroke-linecap="round" />
        <path d="M40.5 8.5c1.6-1.6 4.4-.4 3.6 1.8" fill="none" stroke="#FFCCAA" stroke-width="2.6" stroke-linecap="round" />
        <path d="M30.5 33.5c4.8.6 8-1.2 8.5-4.4" fill="none" stroke="#A6DCC9" stroke-width="2.2" stroke-linecap="round" />
      </svg>
    }
  `,
  styles: `:host { display: inline-flex; flex: none; } img { object-fit: contain; border-radius: 15px; }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrandMarkComponent {
  readonly size = input(46);
  readonly label = input('غرزتك');
  protected readonly logoSrc = 'assets/brand/logo.png';
  protected readonly logoFailed = signal(false);
}
