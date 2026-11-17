import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { ACC, ACC_IDS, AccessoryId, HOOKS, YARN, YARN_IDS, YarnId } from '../../../core/data/catalog';
import { I18nService } from '../../../core/i18n/i18n.service';
import { AppStore } from '../../../core/state/app.store';
import { IconComponent } from '../icon/icon.component';

const toggle = <T,>(arr: readonly T[], x: T): T[] => (arr.includes(x) ? arr.filter((y) => y !== x) : [...arr, x]);

/** GZ-T07 — "My tools" sheet body (hooks, yarn, accessories). */
@Component({
  selector: 'gz-tools-sheet-body',
  template: `
    <span class="gz-lbl">{{ t().hookQ }}</span>
    <div class="gz-chips">
      @for (h of hooks; track h) {
        <button type="button" class="gz-chip sm" [class.on]="pf().hooks.includes(h)" [attr.aria-pressed]="pf().hooks.includes(h)" (click)="store.updateProfile({ hooks: toggle(pf().hooks, h) })"><span class="gz-ltr">{{ h }} mm</span></button>
      }
    </div>
    <span class="gz-lbl">{{ t().yarnQ }}</span>
    <div class="gz-chips">
      @for (y of yarns; track y) {
        <button type="button" class="gz-chip sm" [class.on]="pf().yarns.includes(y)" [attr.aria-pressed]="pf().yarns.includes(y)" (click)="toggleYarn(y)">{{ YARN[y][i18n.lang()] }}</button>
      }
    </div>
    <span class="gz-lbl">{{ t().accQ }}</span>
    <div class="gz-chips">
      @for (a of accs; track a) {
        <button type="button" class="gz-chip sm" [class.on]="pf().accessories.includes(a)" [attr.aria-pressed]="pf().accessories.includes(a)" (click)="toggleAcc(a)">{{ ACC[a][i18n.lang()] }}</button>
      }
    </div>
    <button type="button" class="gz-btn mt-[18px]" (click)="done.emit()">{{ t().done }}</button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolsSheetBody {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(AppStore);
  readonly done = output<void>();
  protected readonly t = this.i18n.t;
  protected readonly pf = this.store.profile;
  protected readonly hooks = HOOKS;
  protected readonly yarns = YARN_IDS;
  protected readonly accs = ACC_IDS;
  protected readonly YARN = YARN;
  protected readonly ACC = ACC;
  protected readonly toggle = toggle;
  protected toggleYarn(y: YarnId): void {
    void this.store.updateProfile({ yarns: toggle(this.pf().yarns, y) });
  }
  protected toggleAcc(a: AccessoryId): void {
    void this.store.updateProfile({ accessories: toggle(this.pf().accessories, a) });
  }
}

/** GZ-T08 — notifications sheet (reminders are honestly marked as not available yet). */
@Component({
  selector: 'gz-notif-sheet-body',
  imports: [IconComponent],
  template: `
    <div class="flex flex-col gap-2.5">
      <div class="gz-rcard">
        <div class="flex items-start gap-2.5">
          <div class="gz-tile t-lav" style="width: 40px; height: 40px; border-radius: 12px"><svg gzIcon="counter" size="s" /></div>
          <div class="flex-1">
            <div class="gz-b gz-sm">{{ i18n.q('كمّلي مشروعك', 'Keep going') }}</div>
            <div class="gz-xs gz-mute">{{ i18n.q('مشروعك الحالي مستنيكي — الدور الجاي قريب!', 'Your current project is waiting — the next round is close!') }}</div>
          </div>
        </div>
      </div>
      <div class="gz-rcard">
        <div class="flex items-start gap-2.5">
          <div class="gz-tile t-peach" style="width: 40px; height: 40px; border-radius: 12px"><svg gzIcon="bag" size="s" /></div>
          <div class="flex-1">
            <div class="gz-b gz-sm">{{ i18n.q('المتجر قريباً', 'Store coming soon') }}</div>
            <div class="gz-xs gz-mute">{{ i18n.q('سجّلي اهتمامك علشان تعرفي أول ما يفتح.', 'Register your interest to hear when it opens.') }}</div>
          </div>
        </div>
      </div>
    </div>
    <p class="gz-xs gz-mute mt-3 text-center">{{ t().notifDemo }}</p>
    <button type="button" class="gz-btn3 w mt-2.5" (click)="done.emit()">{{ t().close }}</button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsSheetBody {
  protected readonly i18n = inject(I18nService);
  readonly done = output<void>();
  protected readonly t = this.i18n.t;
}
