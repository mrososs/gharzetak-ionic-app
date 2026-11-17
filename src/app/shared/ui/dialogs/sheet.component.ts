import { ChangeDetectionStrategy, Component, inject, input, output, viewChild } from '@angular/core';
import { IonModal } from '@ionic/angular';
import { I18nService } from '../../../core/i18n/i18n.service';
import { IconComponent } from '../icon/icon.component';

let seq = 0;

/**
 * The one dialog / bottom-sheet container (28px top radius, grab handle, cream surface, scrollable when tall).
 * Built on ion-modal's sheet presentation: swipe-to-close, backdrop tap and Android hardware Back all dismiss it.
 *
 *   <gz-sheet [open]="open()" title="…" description="…" (closed)="open.set(false)">
 *     …fields / content…
 *     <ng-container gzActions>
 *       <button class="gz-btn">Primary</button> <button class="gz-btn2">Secondary</button> <button class="gz-btn-text">Cancel</button>
 *     </ng-container>
 *   </gz-sheet>
 *
 *  - `title` (optional, backward compatible): renders the standard header with a 44px close button.
 *  - `busy`: while a save is in flight the sheet cannot be dismissed (no lost work, no duplicate submit).
 *  - Content scrolls inside the sheet (max 86vh) so actions never leave the screen; the actions block is sticky at the bottom.
 */
@Component({
  selector: 'gz-sheet',
  imports: [IonModal, IconComponent],
  template: `
    <ion-modal #modal class="gz-sheet" [isOpen]="open()" [initialBreakpoint]="1" [breakpoints]="[0, 1]" [handle]="false" [canDismiss]="!busy()" (didDismiss)="closed.emit()">
      <ng-template>
        <div class="gz-sheet-scroll">
          <div class="gz-sheet-body" role="dialog" aria-modal="true" [attr.aria-label]="label() || title() || null" [attr.aria-labelledby]="title() ? titleId : null" [attr.aria-busy]="busy()">
            <div class="gz-grab" aria-hidden="true"></div>
            @if (title()) {
              <header class="gz-dlg-head">
                <div class="gz-dlg-titles">
                  <h2 class="gz-h2 gz-hd gz-dlg-title" [id]="titleId">{{ title() }}</h2>
                  @if (description()) {
                    <p class="gz-dlg-desc">{{ description() }}</p>
                  }
                </div>
                <button type="button" class="gz-dlg-x" [attr.aria-label]="i18n.t().close" [disabled]="busy()" (click)="dismiss()"><svg gzIcon="x" /></button>
              </header>
            }
            <ng-content />
            <div class="gz-dlg-actions"><ng-content select="[gzActions]" /></div>
          </div>
        </div>
      </ng-template>
    </ion-modal>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SheetComponent {
  protected readonly i18n = inject(I18nService);
  private readonly modal = viewChild<IonModal>('modal');
  protected readonly titleId = `gz-sheet-t-${++seq}`;

  readonly open = input(false);
  readonly label = input('');
  readonly title = input('');
  readonly description = input('');
  /** True while an action is running: dismissal is blocked. */
  readonly busy = input(false);
  readonly closed = output<void>();

  /** Closes the sheet programmatically (the parent still receives `closed`). */
  dismiss(): void {
    void this.modal()?.dismiss();
  }
}
