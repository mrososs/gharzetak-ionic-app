import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { AvatarId } from '../../../core/data/avatars';
import { joyPrefsOf } from '../../../core/joy/joy.models';
import type { AvatarMood } from '../../../core/joy/joy-presenter.service';
import { AppStore } from '../../../core/state/app.store';
import { CrochetAvatarComponent } from './crochet-avatar.component';

/** Shared overlay per mood (the same four small SVGs for every avatar: no per-avatar artwork needed). */
const OVERLAY: Record<AvatarMood, string | null> = {
  happy: null,
  celebrate: 'assets/joy/overlay-hearts.svg',
  proud: 'assets/joy/overlay-sparkles.svg',
  relaxed: 'assets/joy/overlay-tea.svg',
};

/**
 * A crochet avatar that reacts: happy (a little hop), celebrate (wiggle + hearts), proud (soft glow + sparkles), relaxed (gentle sway + tea).
 * Existing avatar art + CSS transform/opacity only (compositor-friendly), every animation plays ONCE (never an infinite loop), and it stays
 * still when the OS asks for reduced motion or the in-app "reduce motion" preference is on. Purely decorative: the message text carries the meaning.
 * Change `run` to replay the reaction.
 */
@Component({
  selector: 'gz-avatar-reaction',
  imports: [CrochetAvatarComponent],
  template: `
    @for (k of key(); track k) {
      <span class="av" [class]="'mood-' + mood()" [class.still]="still()">
        <span class="face"><gz-crochet-avatar [id]="id()" [size]="size()" [decorative]="true" /></span>
        @if (overlay(); as o) {
          <img class="ov" [src]="o" alt="" aria-hidden="true" decoding="async" draggable="false" />
        }
      </span>
    }
  `,
  styles: `
    :host { display: inline-flex; flex: none; line-height: 0; }
    .av { position: relative; display: inline-flex; }
    .face { display: inline-flex; transform-origin: 50% 85%; will-change: transform; }
    .ov { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; pointer-events: none; user-select: none; }
    .mood-happy .face { animation: gzHop 280ms ease-out 2 both; }
    .mood-celebrate .face { animation: gzWiggle 360ms ease-in-out 2 both; }
    .mood-proud .face { animation: gzProud 900ms ease-out 1 both; }
    .mood-relaxed .face { animation: gzSway 1500ms ease-in-out 2 both; }
    .ov { animation: gzOverlay 900ms ease-out 1 both; }
    @keyframes gzHop { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    @keyframes gzWiggle { 0%, 100% { transform: rotate(0) translateY(0); } 25% { transform: rotate(-6deg) translateY(-3px); } 75% { transform: rotate(6deg) translateY(-3px); } }
    @keyframes gzProud { 0% { transform: scale(1); } 45% { transform: scale(1.07); } 100% { transform: scale(1.03); } }
    @keyframes gzSway { 0%, 100% { transform: rotate(0); } 50% { transform: rotate(2deg); } }
    @keyframes gzOverlay { 0% { opacity: 0; transform: translateY(8px) scale(0.92); } 30% { opacity: 1; } 100% { opacity: 0; transform: translateY(-10px) scale(1); } }
    /* In-app "reduce motion", and the OS setting: no movement at all; the overlay is simply shown. */
    .still .face, .still .ov { animation: none; }
    .still .ov { opacity: 1; }
    @media (prefers-reduced-motion: reduce) {
      .face, .ov { animation: none !important; }
      .ov { opacity: 1; }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AvatarReactionComponent {
  private readonly store = inject(AppStore);

  readonly id = input.required<AvatarId>();
  readonly mood = input<AvatarMood>('happy');
  readonly size = input(48);
  /** Change it to play the reaction again. */
  readonly run = input(0);

  protected readonly key = computed(() => [this.run()]);
  protected readonly overlay = computed(() => OVERLAY[this.mood()]);
  protected readonly still = computed(() => joyPrefsOf(this.store.prefs()).motion === 'reduced');
}
