import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { AVATARS, AVATAR_IDS, AvatarId, DEFAULT_AVATAR } from '../../../core/data/avatars';
import { I18nService } from '../../../core/i18n/i18n.service';
import { IconComponent } from '../icon/icon.component';
import { CrochetAvatarComponent } from './crochet-avatar.component';

/**
 * Large live preview + responsive grid of the crochet avatar presets.
 * Presentational: the parent owns the selected value (setup step saves it, the Settings sheet keeps a draft).
 */
@Component({
  selector: 'gz-avatar-picker',
  imports: [CrochetAvatarComponent, IconComponent],
  template: `
    <div class="pv" aria-live="polite">
      <div class="halo" [style.background]="tint()"></div>
      @for (a of [shown()]; track a) {
        <gz-crochet-avatar class="big" [id]="a" [size]="148" [decorative]="true" />
      }
      <div class="nm gz-hd">{{ AV[shown()][i18n.lang()] }}</div>
    </div>
    <div class="grid" role="radiogroup" [attr.aria-label]="i18n.q('الشخصيات', 'Avatars')">
      @for (id of ids; track id) {
        <button type="button" class="cell" role="radio" [class.on]="selected() === id" [attr.aria-checked]="selected() === id" [attr.aria-label]="AV[id][i18n.lang()]" (click)="picked.emit(id)">
          <gz-crochet-avatar [id]="id" [size]="76" [decorative]="true" />
          @if (selected() === id) {
            <span class="ck"><svg gzIcon="check" size="s" /></span>
          }
        </button>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .pv { position: relative; display: flex; flex-direction: column; align-items: center; padding: 6px 0 4px; }
    .halo { position: absolute; top: 4px; width: 176px; height: 176px; border-radius: 50%; opacity: 0.55; filter: blur(14px); transition: background 0.3s; }
    .big { position: relative; filter: drop-shadow(0 10px 18px rgba(129, 61, 181, 0.22)); animation: avPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
    .nm { position: relative; margin-top: 8px; font-size: 18px; color: var(--gz-text); text-align: center; min-height: 28px; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px 10px; justify-items: center; margin-top: 12px; }
    .cell {
      position: relative; padding: 5px; border-radius: 50%; border: 2.5px solid transparent; background: transparent; cursor: pointer;
      transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), border-color 0.2s, background 0.2s; -webkit-tap-highlight-color: transparent;
    }
    .cell:active { transform: scale(0.94); }
    .cell.on { border-color: var(--gz-lavender); background: var(--gz-primary-tint); transform: scale(1.06); box-shadow: 0 6px 16px rgba(129, 61, 181, 0.2); }
    .cell:focus-visible { outline: 3px solid var(--gz-primary); outline-offset: 2px; }
    .ck {
      position: absolute; bottom: 0; inset-inline-end: 0; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      background: var(--gz-primary); color: #fff; border: 2px solid #fff; animation: avPop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
    }
    .ck svg { width: 14px; height: 14px; }
    @keyframes avPop { from { transform: scale(0.82); opacity: 0.4; } to { transform: scale(1); opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .big, .ck { animation: none; } .cell { transition: none; } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AvatarPickerComponent {
  protected readonly i18n = inject(I18nService);
  /** Currently selected preset, or null when nothing was chosen yet (the preview then shows the default). */
  readonly selected = input<AvatarId | null>(null);
  readonly picked = output<AvatarId>();

  protected readonly ids = AVATAR_IDS;
  protected readonly AV = AVATARS;
  protected readonly shown = computed(() => this.selected() ?? DEFAULT_AVATAR);
  protected readonly tint = computed(() => AVATARS[this.shown()].tint);
}
