import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import { I18nService } from '../../../core/i18n/i18n.service';
import { formatMinutes, splitMinutes, toMinutes } from '../../../core/domain/time';

let seq = 0;

/**
 * Hours + minutes entry for an OPTIONAL duration. The value is whole minutes (0 = not set).
 * Empty fields mean "no estimate": nothing is required and nothing is imposed.
 *   2 h · 4 h 30 min · 12 h · 25 h (hours are not capped at 24).
 */
@Component({
  selector: 'gz-duration-input',
  template: `
    <div class="flex items-stretch gap-2.5" role="group" [attr.aria-labelledby]="labelId()">
      <div class="flex flex-1 flex-col">
        <div class="gz-in"><input class="gz-ltr" type="number" inputmode="numeric" min="0" max="99999" step="1" [id]="hid" [value]="hours()" (input)="onHours($event)" placeholder="0" [attr.aria-label]="i18n.q('ساعات', 'Hours')" /><span class="gz-sm gz-mute">{{ i18n.q('ساعة', 'h') }}</span></div>
      </div>
      <div class="flex flex-1 flex-col">
        <div class="gz-in"><input class="gz-ltr" type="number" inputmode="numeric" min="0" max="59" step="1" [id]="mid" [value]="mins()" (input)="onMinutes($event)" placeholder="0" [attr.aria-label]="i18n.q('دقائق', 'Minutes')" /><span class="gz-sm gz-mute">{{ i18n.q('دقيقة', 'min') }}</span></div>
      </div>
    </div>
    @if (value() > 0) {
      <div class="gz-field-hint" aria-live="polite">{{ summary() }}</div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DurationInputComponent {
  protected readonly i18n = inject(I18nService);
  private readonly n = ++seq;
  protected readonly hid = `gz-dur-h-${this.n}`;
  protected readonly mid = `gz-dur-m-${this.n}`;
  /** id of the visible label that names this group (optional). */
  readonly labelId = input<string | null>(null);
  /** Whole minutes; 0 = no estimate. */
  readonly value = model(0);

  protected readonly parts = computed(() => splitMinutes(this.value()));
  protected readonly hours = computed(() => (this.value() > 0 ? String(this.parts().hours) : ''));
  protected readonly mins = computed(() => (this.value() > 0 && this.parts().minutes > 0 ? String(this.parts().minutes) : ''));
  protected readonly summary = computed(() => formatMinutes(this.value(), this.i18n.lang()));

  protected onHours(ev: Event): void {
    const raw = (ev.target as HTMLInputElement).value.trim();
    const h = raw === '' ? 0 : Number(raw);
    this.value.set(toMinutes(Number.isFinite(h) ? h : 0, this.parts().minutes));
  }

  protected onMinutes(ev: Event): void {
    const raw = (ev.target as HTMLInputElement).value.trim();
    const m = raw === '' ? 0 : Number(raw);
    // 90 minutes typed in the minutes box is accepted and normalised to 1 h 30 min instead of being rejected.
    this.value.set(toMinutes(this.parts().hours, Number.isFinite(m) ? m : 0));
  }
}
