import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { achievementDef } from '../../../core/joy/achievements';
import { I18nService } from '../../../core/i18n/i18n.service';
import { JoyPresenter } from '../../../core/joy/joy-presenter.service';
import { ProjectFinishService } from '../../../core/joy/project-finish.service';
import { ShareLauncher } from '../../../core/joy/share-launcher.service';
import { ShareSource } from '../../../core/joy/share-card';
import { TimerService } from '../../../core/services/timer.service';
import { AppStore } from '../../../core/state/app.store';
import { AvatarReactionComponent } from '../avatar/avatar-reaction.component';
import { SheetComponent } from '../dialogs/sheet.component';
import { IconComponent } from '../icon/icon.component';

/**
 * Level-3 celebration: a physical piece is finished. Uses the one shared sheet (sticky one-row actions, Android Back closes it).
 * When every piece is done the user is OFFERED to mark the project finished — it is never completed silently.
 * Mounted once at the app root; it never appears on the video page (there the presenter shows one inline line instead).
 */
@Component({
  selector: 'gz-joy-part-sheet',
  imports: [SheetComponent, AvatarReactionComponent, IconComponent],
  template: `
    <gz-sheet [open]="!!presenter.part()" [title]="presenter.part()?.title ?? ''" (closed)="presenter.dismissPart()">
      @if (presenter.part(); as v) {
        <div class="hero">
          <gz-avatar-reaction [id]="store.avatar()" [mood]="v.mood" [size]="84" [run]="v.id" />
        </div>
        <div class="gz-chips" style="justify-content: center; margin-top: 10px">
          @if (v.timeText) {
            <span class="gz-badge"><svg gzIcon="clock" size="s" /> {{ i18n.q('وقت القطعة: ', 'Time on this piece: ') }}{{ v.timeText }}</span>
          }
          <span class="gz-badge sage"><svg gzIcon="check" size="s" /> <span class="gz-ltr">{{ v.done }}/{{ v.total }}</span> {{ i18n.q('قطعة', 'pieces') }}</span>
          @for (b of v.badges; track b) {
            @if (def(b); as d) {
              <span class="gz-badge pur">{{ d.emoji }} {{ d.name[i18n.lang()] }}</span>
            }
          }
        </div>
        @if (v.allDone) {
          <p class="gz-sm gz-mute" style="text-align: center; margin: 12px 4px 0">{{ i18n.q('لما تخلصي التجميع، اعتبري المشروع مكتمل وهنحتفل بيه سوا.', "When you've finished assembling, mark the project as finished and we'll celebrate it together.") }}</p>
        }
      }
      <ng-container gzActions>
        @if (presenter.part(); as v) {
          @if (v.share) {
            <button type="button" class="gz-btn-text" (click)="shareCard(v.share)"><svg gzIcon="send" size="s" />{{ i18n.q('شاركي', 'Share') }}</button>
          }
          @if (v.allDone) {
            <button type="button" class="gz-btn" [disabled]="busy()" (click)="markFinished(v.projectId)"><svg gzIcon="flag" size="s" />{{ i18n.q('اعتبري المشروع مكتمل', 'Mark project as finished') }}</button>
            <button type="button" class="gz-btn2" (click)="presenter.dismissPart()">{{ i18n.q('لسه هجمّع', "I'm still assembling") }}</button>
          } @else {
            @if (v.nextId) {
              <button type="button" class="gz-btn" [disabled]="busy()" (click)="nextPiece(v.projectId, v.nextId)"><svg gzIcon="arrow" size="s" [flip]="true" />{{ i18n.q('القطعة الجاية', 'Next piece') }}</button>
              <button type="button" class="gz-btn2" (click)="presenter.dismissPart()">{{ i18n.q('كمّلي هنا', 'Stay here') }}</button>
            } @else {
              <button type="button" class="gz-btn" (click)="presenter.dismissPart()"><svg gzIcon="check" size="s" />{{ i18n.q('تمام', 'Done') }}</button>
            }
          }
        }
      </ng-container>
    </gz-sheet>
  `,
  styles: `
    .hero { display: flex; justify-content: center; padding-top: 4px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JoyPartSheetComponent {
  protected readonly presenter = inject(JoyPresenter);
  protected readonly store = inject(AppStore);
  protected readonly i18n = inject(I18nService);
  private readonly timer = inject(TimerService);
  private readonly finishSvc = inject(ProjectFinishService);
  protected readonly def = achievementDef;
  protected readonly busy = signal(false);
  private readonly launcher = inject(ShareLauncher);

  protected shareCard(src: ShareSource): void {
    this.presenter.dismissPart();
    this.launcher.open(src);
  }

  /** Same hand-over as the counter's piece switcher: remember the piece, and move a running timer with it (no gap, no double counting). */
  protected async nextPiece(projectId: string, instanceId: string): Promise<void> {
    this.busy.set(true);
    try {
      await this.store.setActiveInstance(projectId, instanceId);
      await this.timer.switchInstance(projectId, instanceId);
    } finally {
      this.busy.set(false);
      this.presenter.dismissPart();
    }
  }

  protected async markFinished(projectId: string): Promise<void> {
    this.busy.set(true);
    try {
      this.presenter.dismissPart();
      await this.finishSvc.finish(projectId);
    } finally {
      this.busy.set(false);
    }
  }
}
