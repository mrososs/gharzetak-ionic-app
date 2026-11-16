import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IonModal } from '@ionic/angular';

/**
 * Bottom sheet from the design (28px top radius, grab handle, cream surface, scrollable when tall).
 * Built on ion-modal's sheet presentation: swipe-to-close, backdrop tap, Android back all dismiss it.
 */
@Component({
  selector: 'gz-sheet',
  imports: [IonModal],
  template: `
    <ion-modal class="gz-sheet" [isOpen]="open()" [initialBreakpoint]="1" [breakpoints]="[0, 1]" [handle]="false" (didDismiss)="closed.emit()">
      <ng-template>
        <div class="gz-sheet-scroll">
          <div class="gz-sheet-body" role="dialog" aria-modal="true" [attr.aria-label]="label()">
            <div class="gz-grab" aria-hidden="true"></div>
            <ng-content />
          </div>
        </div>
      </ng-template>
    </ion-modal>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SheetComponent {
  readonly open = input(false);
  readonly label = input('');
  readonly closed = output<void>();
}
