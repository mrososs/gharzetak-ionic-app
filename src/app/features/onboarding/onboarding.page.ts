import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { IonContent, IonHeader, NavController } from '@ionic/angular';
import { Tone } from '../../core/data/catalog';
import { photo } from '../../core/data/photos';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { BrandMarkComponent } from '../../shared/ui/brand/brand-mark.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PhotoComponent } from '../../shared/ui/images/photo.component';

const SLIDES = ['welcome', 'learn', 'track', 'assistant'] as const;

/** GZ-S01…S04 — onboarding slides (/onboarding/welcome|learn|track|assistant). */
@Component({
  selector: 'gz-onboarding',
  imports: [IonHeader, IonContent, IconComponent, PhotoComponent, BrandMarkComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top" style="justify-content: space-between">
        <button type="button" class="gz-chip sm" (click)="i18n.toggle()" [attr.aria-label]="t().langAria">
          <svg gzIcon="globe" size="s" />{{ t().langBtn }}
        </button>
        @if (step() < 3) {
          <button type="button" class="gz-lnk" (click)="goLogin()">{{ t().skip }}</button>
        }
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      <div class="gz-pad flex min-h-full flex-col gap-4 pt-1">
        <gz-photo class="flex-none" [tone]="slide().tone" [alt]="slide().alt" [src]="slide().img" iconSize="xl" height="316px" extraClass="r28" />
        <div class="flex flex-col gap-2">
          @if (step() === 0) {
            <div class="flex items-center gap-2.5">
              <gz-brand-mark [size]="46" [label]="t().brand" />
              <div class="flex flex-col">
                <span class="gz-hd" style="font-size: 20px; color: var(--gz-primary)">{{ t().brand }}</span>
                <span class="gz-xs gz-mute" style="line-height: 1.4">{{ t().tagline }}</span>
              </div>
            </div>
          }
          <h1 class="gz-h1 gz-hd">{{ slide().title }}</h1>
          <p class="gz-mute m-0" style="font-size: 16px">{{ slide().body }}</p>
        </div>
        <div class="gz-dots" aria-hidden="true">
          @for (s of slides; track s; let i = $index) {
            <span [class.on]="i === step()"></span>
          }
        </div>
        <div class="mt-auto flex flex-col gap-2.5 pb-2">
          <button type="button" class="gz-btn" (click)="next()">{{ slide().cta }}<svg gzIcon="arrow" [flip]="true" /></button>
          @if (step() === 0 || step() === 3) {
            <button type="button" class="gz-btn2" (click)="goLogin()">{{ t().haveAcc }}</button>
          }
        </div>
      </div>
    </ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnboardingPage {
  protected readonly i18n = inject(I18nService);
  private readonly nav = inject(NavController);
  private readonly auth = inject(AuthService);
  readonly slideKey = input<string>('welcome', { alias: 'slide' });

  protected readonly t = this.i18n.t;
  protected readonly slides = SLIDES;
  protected readonly step = computed(() => Math.max(0, SLIDES.indexOf(this.slideKey() as (typeof SLIDES)[number])));
  protected readonly slide = computed(() => {
    const q = (a: string, e: string) => this.i18n.q(a, e);
    const all: { tone: Tone; img: string; alt: string; title: string; body: string; cta: string }[] = [
      { tone: 'lav', img: photo('ob0'), alt: q('صورة: دمية أرنب كروشيه وسلة خيوط', 'Photo: crochet bunny with a basket of yarn'), title: q('مرحبًا بيكي في غرزتك', 'Welcome to Gharzetak'), body: q('رفيقتك الذكية لتعلّم الكروشيه، متابعة الغرز، وتنظيم مشاريعك خطوة بخطوة.', 'Your friendly companion to learn crochet, track stitches and organise projects step by step.'), cta: q('ابدئي الآن', 'Get started') },
      { tone: 'blush', img: photo('ob1'), alt: q('صورة: إيدين بتشتغل كروشيه', 'Photo: hands crocheting'), title: q('اتعلّمي الكروشيه خطوة بخطوة', 'Learn crochet step by step'), body: q('شروحات مبسّطة من الغرزة الأولى لحد أول أميجورومي ليكي.', 'Simple lessons from your very first stitch to your first amigurumi.'), cta: q('التالي', 'Next') },
      { tone: 'sage', img: photo('ob2'), alt: q('صورة: مربّع جراني قيد التنفيذ', 'Photo: granny square in progress'), title: q('تابعي غرزك وماتفقديش مكانك', 'Track stitches, never lose your place'), body: q('عدّاد ذكي بيحسب الغرز والأدوار والزيادة والتنقيص، وبيحفظ تقدّمك تلقائيًا.', 'A smart counter tracks stitches, rounds, increases and decreases, and saves your progress automatically.'), cta: q('التالي', 'Next') },
      { tone: 'peach', img: photo('ob3'), alt: q('صورة: دمية أميجورومي مكتملة', 'Photo: finished amigurumi doll'), title: q('اسألي مساعدك الذكي', 'Ask your AI crochet assistant'), body: q('اسألي عن أي غرزة أو دور وانتي شغالة — والرد بيستخدم مشروعك الحالي. (نسخة تجريبية)', 'Ask about any stitch or round while you work — replies use your current project. (demo build)'), cta: q('هيا نبدأ', "Let's go") },
    ];
    return all[this.step()];
  });

  protected next(): void {
    const i = this.step();
    if (i < 3) void this.nav.navigateForward(['/onboarding', SLIDES[i + 1]], { queryParamsHandling: 'preserve' });
    else if (this.auth.canEnterApp()) void this.nav.navigateRoot('/tabs/home');
    else void this.nav.navigateForward('/auth/signup');
  }

  protected goLogin(): void {
    if (this.auth.canEnterApp()) return void this.nav.navigateRoot('/tabs/home');
    void this.nav.navigateForward('/auth/login');
  }
}
