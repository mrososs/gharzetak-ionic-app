import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { IonModal, NavController } from '@ionic/angular';
import { achievementDef } from '../../../core/joy/achievements';
import { I18nService } from '../../../core/i18n/i18n.service';
import { joyPrefsOf } from '../../../core/joy/joy.models';
import { JoyPresenter } from '../../../core/joy/joy-presenter.service';
import { ReminderService } from '../../../core/reminders/reminder.service';
import { ShareLauncher } from '../../../core/joy/share-launcher.service';
import { ShareSource } from '../../../core/joy/share-card';
import { AppStore } from '../../../core/state/app.store';
import { AvatarReactionComponent } from '../avatar/avatar-reaction.component';
import { IconComponent } from '../icon/icon.component';

const COLORS = ['var(--gz-pink)', 'var(--gz-lavender)', 'var(--gz-peach)', 'var(--gz-mint)', 'var(--gz-primary)'];

/** Deterministic confetti: 24 dots flying out from the middle once (no randomness, so it renders identically every time and is testable). */
const CONFETTI = Array.from({ length: 24 }, (_, i) => {
  const angle = (i / 24) * Math.PI * 2 + (i % 3) * 0.12;
  const dist = 90 + (i % 5) * 28;
  return { dx: Math.round(Math.cos(angle) * dist), dy: Math.round(Math.sin(angle) * dist * 0.8 - 40), delay: (i % 6) * 40, color: COLORS[i % COLORS.length], size: 6 + (i % 3) * 2 };
});

/**
 * Level-4 premium completion experience: shown only after the user EXPLICITLY marked a project finished (and only once per project —
 * the ledger guarantees it). A full-screen Ionic modal: Android Back closes it, safe areas are respected, and it scrolls on small phones.
 * Mounted once at the app root.
 */
@Component({
  selector: 'gz-joy-finale',
  imports: [IonModal, AvatarReactionComponent, IconComponent],
  template: `
    <ion-modal class="gz-finale" [isOpen]="!!presenter.finale()" [canDismiss]="true" (didDismiss)="presenter.dismissFinale()">
      <ng-template>
        @if (presenter.finale(); as v) {
          <div class="fin" role="dialog" aria-modal="true" [attr.aria-labelledby]="'fin-t'">
            @if (!still()) {
              <div class="confetti" aria-hidden="true">
                @for (c of confetti; track $index) {
                  <i [style.--dx.px]="c.dx" [style.--dy.px]="c.dy" [style.--delay.ms]="c.delay" [style.--sz.px]="c.size" [style.background]="c.color"></i>
                }
              </div>
            }
            <button type="button" class="close" (click)="presenter.dismissFinale()" [attr.aria-label]="i18n.t().close"><svg gzIcon="x" /></button>

            @if (v.photoUrl) {
              <img class="photo" [src]="v.photoUrl" [alt]="v.name" decoding="async" />
            } @else {
              <div class="photo empty"><gz-avatar-reaction [id]="store.avatar()" mood="proud" [size]="132" [run]="v.id" /></div>
            }
            @if (v.photoUrl) {
              <div class="av"><gz-avatar-reaction [id]="store.avatar()" [mood]="v.mood" [size]="68" [run]="v.id" /></div>
            }
            <h1 id="fin-t" class="gz-h2 gz-hd title">{{ v.title }}</h1>

            <div class="gz-chips stats">
              @if (v.timeText) {
                <span class="gz-badge"><svg gzIcon="clock" size="s" /> {{ i18n.q('الوقت المسجّل: ', 'Recorded time: ') }}{{ v.timeText }}</span>
              }
              @if (v.pieces; as p) {
                <span class="gz-badge sage"><svg gzIcon="check" size="s" /> <span class="gz-ltr">{{ p.done }}/{{ p.total }}</span> {{ i18n.q('قطعة', 'pieces') }}</span>
              }
              @if (v.rounds > 0) {
                <span class="gz-badge peach"><svg gzIcon="counter" size="s" /> <span class="gz-ltr">{{ v.rounds }}</span> {{ i18n.q('دور معدود', 'rounds counted') }}</span>
              }
            </div>

            @if (v.badges.length) {
              <div class="badges">
                <span class="gz-xs gz-mute">{{ i18n.q('إنجازات جديدة', 'New achievements') }}</span>
                <div class="gz-chips" style="justify-content: center">
                  @for (b of v.badges; track b) {
                    @if (def(b); as d) {
                      <span class="gz-badge pur">{{ d.emoji }} {{ d.name[i18n.lang()] }}</span>
                    }
                  }
                </div>
              </div>
            }

            <div class="actions">
              @if (v.share) {
                <button type="button" class="gz-btn3" (click)="shareCard(v.share)"><svg gzIcon="send" size="s" />{{ i18n.q('اعملي كارت مشاركة', 'Create a share card') }}</button>
              }
              @if (!v.photoUrl) {
                <button type="button" class="gz-btn2" (click)="addPhoto(v.projectId)"><svg gzIcon="camera" size="s" />{{ i18n.q('ضيفي صورة لتحفتك', 'Add a photo of your creation') }}</button>
              }
              <button type="button" class="gz-btn" (click)="close()"><svg gzIcon="check" size="s" />{{ i18n.q('تمام', 'Done') }}</button>
            </div>
          </div>
        }
      </ng-template>
    </ion-modal>
  `,
  styles: `
    .fin { position: relative; min-height: 100%; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; gap: 14px; overflow: hidden auto;
      padding: calc(28px + var(--gz-safe-top)) var(--gz-screen-pad) calc(24px + var(--gz-safe-bottom)); background: radial-gradient(120% 70% at 50% 0%, var(--gz-pink-100), var(--gz-bg) 70%); text-align: center; }
    .close { position: absolute; inset-block-start: calc(10px + var(--gz-safe-top)); inset-inline-end: 10px; width: 44px; height: 44px; border: 0; border-radius: 50%; background: var(--gz-surface); color: var(--gz-text-2); display: grid; place-items: center; box-shadow: var(--gz-shadow-card); z-index: 3; }
    .photo { width: min(100%, 320px); aspect-ratio: 4 / 3; object-fit: cover; border-radius: 26px; box-shadow: var(--gz-shadow-card); background: var(--gz-pink-100); }
    .photo.empty { display: grid; place-items: center; border: 2px dashed var(--gz-pink-200); box-shadow: none; }
    .av { margin-top: -46px; filter: drop-shadow(0 4px 10px rgba(53, 37, 62, 0.2)); }
    .title { margin: 0; max-width: 22ch; overflow-wrap: anywhere; }
    .stats { justify-content: center; }
    .badges { display: flex; flex-direction: column; gap: 6px; align-items: center; }
    .actions { width: 100%; max-width: 360px; display: flex; flex-direction: column; gap: 10px; margin-top: auto; padding-top: 8px; }
    .confetti { position: absolute; inset-inline: 0; top: 34%; height: 0; pointer-events: none; z-index: 2; }
    .confetti i { position: absolute; inset-inline-start: 50%; top: 0; width: var(--sz); height: var(--sz); border-radius: 50%; opacity: 0; animation: gzConfetti 1400ms ease-out var(--delay) 1 both; }
    @keyframes gzConfetti { 0% { opacity: 0; transform: translate(0, 0) scale(0.4); } 15% { opacity: 1; } 100% { opacity: 0; transform: translate(var(--dx), calc(var(--dy) + 90px)) scale(1); } }
    @media (prefers-reduced-motion: reduce) { .confetti { display: none; } }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JoyFinaleComponent {
  protected readonly presenter = inject(JoyPresenter);
  protected readonly store = inject(AppStore);
  protected readonly i18n = inject(I18nService);
  private readonly nav = inject(NavController);
  protected readonly confetti = CONFETTI;
  protected readonly def = achievementDef;
  protected readonly still = computed(() => joyPrefsOf(this.store.prefs()).motion === 'reduced');

  private readonly launcher = inject(ShareLauncher);
  private readonly reminders = inject(ReminderService);

  /** Closing the celebration is a happy moment: the right time to (gently, rarely) offer reminders. */
  protected close(): void {
    this.presenter.dismissFinale();
    this.reminders.maybeSoftAsk();
  }

  protected shareCard(src: ShareSource): void {
    this.presenter.dismissFinale();
    this.launcher.open(src);
  }

  protected addPhoto(projectId: string): void {
    this.presenter.dismissFinale();
    void this.nav.navigateForward('/tabs/projects/' + projectId);
  }
}
