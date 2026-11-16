import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { IonContent, IonHeader, NavController } from '@ionic/angular';
import { AvatarId } from '../../core/data/avatars';
import { CAT, CAT_IDS, CategoryId, HOOKS, LVL, LVL_IDS, LevelId, YARN, YARN_IDS, YarnId } from '../../core/data/catalog';
import { photo } from '../../core/data/photos';
import { I18nService } from '../../core/i18n/i18n.service';
import { AppStore } from '../../core/state/app.store';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PhotoComponent } from '../../shared/ui/images/photo.component';
import { AvatarPickerComponent } from '../../shared/ui/avatar/avatar-picker.component';

const STEPS = ['avatar', 'experience', 'interests', 'tools'] as const;
const LAST = STEPS.length - 1;
const toggle = <T,>(arr: readonly T[], x: T): T[] => (arr.includes(x) ? arr.filter((y) => y !== x) : [...arr, x]);

/** GZ-S07…S09 — personalised setup (/setup/avatar|experience|interests|tools). The avatar step is optional and never blocks. */
@Component({
  selector: 'gz-setup',
  imports: [IonHeader, IonContent, IconComponent, PhotoComponent, AvatarPickerComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top" style="justify-content: space-between">
        <button type="button" class="gz-icb" (click)="back()" [attr.aria-label]="t().back"><svg gzIcon="arrowl" [flip]="true" /></button>
        <div class="gz-dots" aria-hidden="true">
          @for (s of steps; track s; let i = $index) {
            <span [class.on]="i === step()" [class.past]="i < step()"></span>
          }
        </div>
        <button type="button" class="gz-lnk" (click)="finish(false)">{{ t().skip }}</button>
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      <div class="gz-pad">
        <h1 class="gz-h1 gz-hd mt-1.5">{{ title() }}</h1>
        <p class="gz-mute gz-sm mt-0.5 mb-1">{{ sub() }}</p>

        @switch (step()) {
          @case (0) {
            <gz-avatar-picker [selected]="draftAvatar()" (picked)="draftAvatar.set($event)" />
          }
          @case (1) {
            <span class="gz-lbl">{{ t().expQ }}</span>
            <div class="flex flex-col gap-2.5">
              @for (id of levels; track id) {
                <button type="button" class="gz-rcard" [class.cur]="pf().level === id" [attr.aria-pressed]="pf().level === id" (click)="setLevel(id)">
                  <div class="flex items-center gap-3">
                    <div class="gz-tile t-{{ LVL[id].tone }}" style="width: 48px; height: 48px"><svg [gzIcon]="LVL[id].icon" /></div>
                    <div class="min-w-0 flex-1">
                      <div class="gz-b">{{ LVL[id][i18n.lang()] }}</div>
                      <div class="gz-xs gz-mute">{{ i18n.isAr() ? LVL[id].dAr : LVL[id].dEn }}</div>
                    </div>
                    @if (pf().level === id) {
                      <svg gzIcon="check" style="color: var(--gz-primary)" />
                    }
                  </div>
                </button>
              }
            </div>
            <span class="gz-lbl">{{ t().termQ }}</span>
            <div class="gz-seg">
              <button type="button" [class.on]="pf().terms === 'us'" (click)="store.updateProfile({ terms: 'us' })">{{ t().us }}</button>
              <button type="button" [class.on]="pf().terms === 'uk'" (click)="store.updateProfile({ terms: 'uk' })">{{ t().uk }}</button>
            </div>
            <p class="gz-xs gz-mute mx-0.5 mt-1.5">{{ t().termHint }}</p>
          }
          @case (2) {
            <div class="mt-3.5 grid grid-cols-2 gap-3">
              @for (id of cats; track id) {
                @let on = pf().interests.includes(id);
                <button
                  type="button"
                  class="gz-reset relative overflow-hidden rounded-md bg-surface shadow-card"
                  [style.border]="'2.5px solid ' + (on ? 'var(--gz-primary)' : 'transparent')"
                  [attr.aria-pressed]="on"
                  (click)="toggleInterest(id)"
                >
                  <gz-photo [tone]="CAT[id].tone" [icon]="CAT[id].icon" iconSize="l" [alt]="i18n.isAr() ? CAT[id].altAr : CAT[id].altEn" [src]="photoOf('cat_' + id)" height="104px" />
                  <div class="flex items-center justify-between px-3 py-2.5">
                    <span class="gz-b">{{ CAT[id][i18n.lang()] }}</span>
                    <span class="flex h-6 w-6 items-center justify-center rounded-full" [style.background]="on ? 'var(--gz-primary)' : '#fff'" style="color: #fff" [style.border]="'2px solid ' + (on ? 'var(--gz-primary)' : 'var(--gz-border)')">
                      @if (on) {
                        <svg gzIcon="check" size="s" style="width: 14px; height: 14px" />
                      }
                    </span>
                  </div>
                </button>
              }
            </div>
          }
          @case (3) {
            <span class="gz-lbl">{{ t().hookQ }}</span>
            <div class="gz-chips">
              @for (h of hooks; track h) {
                <button type="button" class="gz-chip" [class.on]="pf().hooks.includes(h)" [attr.aria-pressed]="pf().hooks.includes(h)" (click)="toggleHook(h)">
                  <span class="gz-ltr">{{ h }} mm</span>
                </button>
              }
            </div>
            <span class="gz-lbl">{{ t().yarnQ }}</span>
            <div class="gz-grid-3">
              @for (y of yarns; track y) {
                @let on = pf().yarns.includes(y);
                <button type="button" class="gz-rcard" style="padding: 8px; text-align: center" [style.border-color]="on ? 'var(--gz-primary)' : 'var(--gz-border)'" [attr.aria-pressed]="on" (click)="toggleYarn(y)">
                  <gz-photo [tone]="YARN[y].tone" icon="yarn" [showLabel]="false" [alt]="i18n.isAr() ? YARN[y].altAr : YARN[y].altEn" [src]="photoOf('yarn_' + y)" height="62px" extraClass="r16" />
                  <div class="gz-b gz-sm mt-1.5">{{ YARN[y][i18n.lang()] }}</div>
                  <div class="gz-xs" style="color: var(--gz-primary); min-height: 18px">{{ on ? i18n.q('✓ مختار', '✓ Selected') : '' }}</div>
                </button>
              }
            </div>
          }
        }

        <div style="height: 18px"></div>
        @if (step() === 0) {
          <button type="button" class="gz-btn" (click)="confirmAvatar()">{{ i18n.q('دي شخصيتي!', "That's my buddy!") }}<svg gzIcon="check" /></button>
          <button type="button" class="gz-btn2 mt-2.5" (click)="skipAvatar()">{{ i18n.q('هختار بعدين', "I'll choose later") }}</button>
        } @else {
          <button type="button" class="gz-btn" (click)="next()">{{ step() < last ? i18n.q('متابعة', 'Continue') : i18n.q('ابدئي الآن', 'Finish') }}<svg gzIcon="arrow" [flip]="true" /></button>
        }
      </div>
    </ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupPage {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(AppStore);
  private readonly nav = inject(NavController);
  private readonly ui = inject(UiFeedback);
  readonly stepKey = input<string>('experience', { alias: 'step' });

  protected readonly t = this.i18n.t;
  protected readonly pf = this.store.profile;
  protected readonly steps = STEPS;
  protected readonly last = LAST;
  /** The avatar being previewed; only written to the profile when the user confirms it. */
  protected readonly draftAvatar = signal<AvatarId | null>(this.store.profile().avatarId);
  protected readonly levels = LVL_IDS;
  protected readonly cats = CAT_IDS;
  protected readonly hooks = HOOKS;
  protected readonly yarns = YARN_IDS;
  protected readonly LVL = LVL;
  protected readonly CAT = CAT;
  protected readonly YARN = YARN;
  protected readonly photoOf = photo;

  protected readonly step = computed(() => Math.max(0, STEPS.indexOf(this.stepKey() as (typeof STEPS)[number])));
  protected readonly title = computed(() => [this.i18n.q('اختاري شخصيتك في غرزتك', 'Choose your crochet buddy'), this.i18n.q('عرّفينا بمستواكي', 'Tell us about your level'), this.i18n.q('إيه اللي بتحبي تعمليه؟', 'What type are you interested in?'), this.i18n.q('أضيفي أدواتك', 'Add your tools')][this.step()]);
  protected readonly sub = computed(() => [this.i18n.q('اختاري صاحبتك الصغيرة اللي هترافقك في كل مشروع كروشيه.', 'Pick the little friend who will join you in every crochet project.'), this.i18n.q('هنخصّص التجربة ليكي.', 'We will personalise your experience.'), this.i18n.q('اختاري واحد أو أكتر.', 'Choose one or more.'), this.i18n.q('ساعدينا نقترح عليكي الأنسب.', 'Help us suggest what fits you.')][this.step()]);

  protected setLevel(id: LevelId): void {
    void this.store.updateProfile({ level: id });
  }
  protected toggleInterest(id: CategoryId): void {
    void this.store.updateProfile({ interests: toggle(this.pf().interests, id) });
  }
  protected toggleHook(h: string): void {
    void this.store.updateProfile({ hooks: toggle(this.pf().hooks, h) });
  }
  protected toggleYarn(y: YarnId): void {
    void this.store.updateProfile({ yarns: toggle(this.pf().yarns, y) });
  }

  /** Saves the previewed avatar (the default preview counts as a choice once confirmed), then continues. */
  protected async confirmAvatar(): Promise<void> {
    const id = this.draftAvatar();
    await this.store.setAvatar(id ?? this.store.avatar());
    this.next();
  }

  /** Skips only the avatar: the default stays and Settings keeps the invitation. */
  protected skipAvatar(): void {
    this.next();
  }

  protected back(): void {
    const i = this.step();
    if (i > 0) void this.nav.navigateBack(['/setup', STEPS[i - 1]]);
    else void this.nav.navigateRoot('/tabs/home');
  }

  protected next(): void {
    const i = this.step();
    if (i < LAST) void this.nav.navigateForward(['/setup', STEPS[i + 1]]);
    else void this.finish(true);
  }

  protected async finish(saved: boolean): Promise<void> {
    await this.store.updateProfile({ onboarded: true }, true);
    await this.nav.navigateRoot('/tabs/home', { replaceUrl: true });
    if (saved) await this.ui.say('تم حفظ تفضيلاتك', 'Your preferences are saved');
  }
}
