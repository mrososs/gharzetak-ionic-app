import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

/** − value + stepper (44px targets, tabular LTR numerals). */
@Component({
  selector: 'gz-stepper',
  imports: [IconComponent],
  template: `
    <div class="gz-stepper">
      <button type="button" (click)="dec.emit()" [attr.aria-label]="label() + ' −'"><svg gzIcon="minus" /></button>
      <span class="v" aria-live="polite">{{ display() }}</span>
      <button type="button" (click)="inc.emit()" [attr.aria-label]="label() + ' +'"><svg gzIcon="plus" /></button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StepperComponent {
  readonly display = input.required<string | number>();
  readonly label = input('');
  readonly inc = output<void>();
  readonly dec = output<void>();
}
