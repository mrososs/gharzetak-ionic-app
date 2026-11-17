import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { IonContent, IonHeader, NavController } from '@ionic/angular';
import { AchievementsService } from '../../core/joy/achievements.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { ShareLauncher } from '../../core/joy/share-launcher.service';
import { AppStore } from '../../core/state/app.store';
import { AvatarReactionComponent } from '../../shared/ui/avatar/avatar-reaction.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';

/**
 * Personal achievements: eight gentle milestones, no leaderboard, no streaks, nothing to lose.
 * They are stored on THIS device (per account / guest) and are not synced — the screen says so.
 */
@Component({
  selector: 'gz-achievements',
  imports: [IonHeader, IonContent, IconComponent, AvatarReactionComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top">
        <button type="button" class="gz-icb" (click)="nav.back()" [attr.aria-label]="i18n.t().back"><svg gzIcon="arrowl" [flip]="true" /></button>
        <h1 class="gz-ttl gz-hd">{{ i18n.q('إنجازاتي', 'My achievements') }}</h1>
        <span style="width: 46px"></span>
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      <div class="gz-pad">
        <div class="gz-card soft summary">
          <gz-avatar-reaction [id]="store.avatar()" [mood]="svc.count() ? 'proud' : 'happy'" [size]="64" />
          <div class="txt">
            <div class="gz-hd" style="font-size: 18px"><span class="gz-ltr">{{ svc.count() }}/{{ total }}</span> {{ i18n.q('إنجاز', 'earned') }}</div>
            <div class="gz-sm gz-mute">
              @if (svc.count()) {
                {{ i18n.q('كل خطوة صغيرة بتتحسب 💗', 'Every small step counts 💗') }}
              } @else {
                {{ i18n.q('إنجازاتك هتظهر هنا أول ما تبدئي تعدّي 💗', 'Your achievements will show up here once you start counting 💗') }}
              }
            </div>
          </div>
        </div>

        <ul class="grid" role="list">
          @for (a of items(); track a.id) {
            <li class="tile" [class.locked]="!a.unlocked" [attr.aria-label]="a.label">
              <span class="emoji" aria-hidden="true">{{ a.unlocked ? a.emoji : '🔒' }}</span>
              <span class="gz-b name">{{ a.name }}</span>
              <span class="gz-xs gz-mute hint">{{ a.unlocked ? a.date : a.hint }}</span>
              @if (a.earlier) {
                <span class="gz-xs earlier">{{ i18n.q('من مشاريعك السابقة', 'From your earlier projects') }}</span>
              }
              @if (a.unlocked) {
                <button type="button" class="gz-btn-text share" (click)="share(a.id)"><svg gzIcon="send" size="s" />{{ i18n.q('شاركي', 'Share') }}</button>
              }
            </li>
          }
        </ul>

        @if (!svc.count()) {
          <button type="button" class="gz-btn3 w mt-3" (click)="nav.navigateRoot('/tabs/projects/new')"><svg gzIcon="plus" size="s" />{{ i18n.q('ابدئي مشروع', 'Start a project') }}</button>
        }

        <div class="gz-note lav mt-3.5">
          <svg gzIcon="info" size="s" />
          <span>{{ i18n.q(
            'الإنجازات محفوظة على الموبايل ده بس ومش بتتنقل لموبايل تاني دلوقتي. الأدوار بتتحسب من وقت ما بدأتي تعدّي بغرزتك.',
            'Achievements are kept on this phone only and do not move to another phone yet. Rounds count from when you started counting with Gharzetak.'
          ) }}</span>
        </div>
      </div>
    </ion-content>
  `,
  styles: `
    .summary { display: flex; align-items: center; gap: 14px; }
    .grid { list-style: none; margin: 14px 0 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    @media (min-width: 600px) { .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    .tile { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; padding: 14px 8px; border-radius: 20px; background: var(--gz-surface); border: 1px solid var(--gz-border); box-shadow: var(--gz-shadow-card); }
    .tile.locked { background: var(--gz-surface-elevated); box-shadow: none; opacity: 0.9; }
    .emoji { font-size: 34px; line-height: 1.1; }
    .tile.locked .emoji { filter: grayscale(1); opacity: 0.55; }
    .name { font-size: 14px; overflow-wrap: anywhere; }
    .hint { overflow-wrap: anywhere; }
    .earlier { color: var(--gz-primary); font-weight: 700; }
    .share { min-height: 44px; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AchievementsPage {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(AppStore);
  protected readonly nav = inject(NavController);
  protected readonly svc = inject(AchievementsService);

  protected readonly total = 8;
  private readonly launcher = inject(ShareLauncher);

  protected share(id: string): void {
    this.launcher.achievement(id);
  }

  protected readonly items = computed(() => {
    const lang = this.i18n.lang();
    return this.svc.list().map(({ def, row }) => {
      const date = row ? new Date(row.at).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      return {
        id: def.id,
        emoji: def.emoji,
        name: def.name[lang],
        hint: def.hint[lang],
        unlocked: !!row,
        date,
        // credited silently from durable data (an older project), not from a live action
        earlier: row?.source === 'backfill',
        label: row ? `${def.name[lang]} — ${date}` : `${def.name[lang]} — ${def.hint[lang]}`,
      };
    });
  });
}
