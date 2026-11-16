import { ChangeDetectionStrategy, Component, afterNextRender, computed, inject, input } from '@angular/core';
import { IonContent, IonHeader, NavController } from '@ionic/angular';
import { AssistantService } from '../../core/ai/assistant.service';
import { AuthService } from '../../core/auth/auth.service';
import { ONBOARDING_SLIDES } from '../../core/data/flows';
import { I18nService } from '../../core/i18n/i18n.service';
import { BrandMarkComponent } from '../../shared/ui/brand/brand-mark.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';

const SLIDES = ONBOARDING_SLIDES;
type SlideKey = (typeof SLIDES)[number];

/** Original crochet artwork (transparent WebP, trimmed + optimised — see public/assets/onboarding). */
const ART: Record<SlideKey, string> = {
  welcome: 'assets/onboarding/welcome-bunny.webp',
  learn: 'assets/onboarding/learn-basket.webp',
  track: 'assets/onboarding/track-yarn-heart.webp',
  assistant: 'assets/onboarding/assistant-flower.webp',
};

/**
 * GZ-S01…S04 — onboarding slides (/onboarding/welcome|learn|track|assistant).
 * Each slide is one illustrated scene: soft pastel blobs + a stitched thread sit BEHIND the artwork, the artwork
 * overlaps a curved cream panel (depth), and all decoration is pure CSS (transform/opacity only, off under reduced motion).
 */
@Component({
  selector: 'gz-onboarding',
  imports: [IonHeader, IonContent, IconComponent, BrandMarkComponent],
  host: { '[attr.data-s]': 'slideName()' },
  template: `
    <ion-header class="gz-header ion-no-border ob-head">
      <div class="gz-top ob-top">
        <div class="ob-side">
          @if (step() > 0) {
            <button type="button" class="gz-icb flat" (click)="back()" [attr.aria-label]="t().back"><svg gzIcon="arrowl" [flip]="true" /></button>
          }
        </div>
        <button type="button" class="gz-chip sm" (click)="i18n.toggle()" [attr.aria-label]="t().langAria"><svg gzIcon="globe" size="s" />{{ t().langBtn }}</button>
        <div class="ob-side end">
          @if (step() < last) {
            <button type="button" class="gz-lnk" (click)="goLogin()">{{ t().skip }}</button>
          }
        </div>
      </div>
    </ion-header>

    <ion-content class="gz-scroll ob-content">
      @for (s of [slideName()]; track s) {
      <div class="scene">
        <!-- decoration: behind everything interactive -->
        <div class="bg" aria-hidden="true">
          <span class="blob b1"></span>
          <span class="blob b2"></span>
          <svg class="thread" viewBox="0 0 400 220" preserveAspectRatio="none"><path d="M-10 150 C 60 86, 126 196, 204 140 S 330 104, 412 156" /></svg>
          <svg class="deco fl f1" viewBox="0 0 24 24"><g fill="var(--fl-a)"><circle cx="12" cy="5.4" r="5"/><circle cx="18.3" cy="10" r="5"/><circle cx="15.9" cy="17.5" r="5"/><circle cx="8.1" cy="17.5" r="5"/><circle cx="5.7" cy="10" r="5"/></g><circle cx="12" cy="12" r="3.6" fill="var(--fl-b)"/></svg>
          <svg class="deco fl f2" viewBox="0 0 24 24"><g fill="var(--fl-b)"><circle cx="12" cy="5.4" r="5"/><circle cx="18.3" cy="10" r="5"/><circle cx="15.9" cy="17.5" r="5"/><circle cx="8.1" cy="17.5" r="5"/><circle cx="5.7" cy="10" r="5"/></g><circle cx="12" cy="12" r="3.6" fill="#ffd98a"/></svg>
          <svg class="deco sp s1" viewBox="0 0 24 24"><path d="M12 1C12.8 8 16 11.2 23 12 16 12.8 12.8 16 12 23 11.2 16 8 12.8 1 12 8 11.2 11.2 8 12 1Z" /></svg>
          <svg class="deco sp s2" viewBox="0 0 24 24"><path d="M12 1C12.8 8 16 11.2 23 12 16 12.8 12.8 16 12 23 11.2 16 8 12.8 1 12 8 11.2 11.2 8 12 1Z" /></svg>
          <svg class="deco ht h1" viewBox="0 0 24 24"><path d="M12 21C4 15 2 9.5 5.2 6.4 7.7 4 11 5 12 7.4 13 5 16.3 4 18.8 6.4 22 9.5 20 15 12 21Z" /></svg>
        </div>

        <div class="hero">
          <img class="art" [src]="art()" [alt]="alt()" width="760" height="760" decoding="async" fetchpriority="high" draggable="false" />
        </div>

        <section class="panel">
          @if (step() === 0) {
            <div class="brand rise" style="--d: 0ms">
              <gz-brand-mark [size]="40" [label]="t().brand" />
              <div class="flex flex-col">
                <span class="gz-hd bn">{{ t().brand }}</span>
                <span class="gz-xs gz-mute" style="line-height: 1.4">{{ t().tagline }}</span>
              </div>
            </div>
          }
          @if (step() === last && !ai.connected) {
            <span class="gz-badge rose rise" style="--d: 0ms; align-self: center">{{ t().demoBadge }}</span>
          }
          <h1 class="gz-hd title rise" style="--d: 60ms">{{ copy().title }}</h1>
          <p class="gz-mute sub rise" style="--d: 120ms">{{ copy().body }}</p>

          <div class="prog" role="progressbar" [attr.aria-valuemin]="1" [attr.aria-valuemax]="slides.length" [attr.aria-valuenow]="step() + 1" [attr.aria-label]="i18n.q('خطوة ' + (step() + 1) + ' من ' + slides.length, 'Step ' + (step() + 1) + ' of ' + slides.length)">
            @for (s of slides; track s; let i = $index) {
              <span [class.on]="i === step()" [class.past]="i < step()"></span>
            }
          </div>

          <div class="cta">
            <button type="button" class="gz-btn" (click)="next()">{{ copy().cta }}<svg gzIcon="arrow" [flip]="true" /></button>
            @if (step() === last) {
              <button type="button" class="gz-btn2" (click)="goLogin()">{{ t().haveAcc }}</button>
            }
          </div>
        </section>
      </div>
      }
    </ion-content>
  `,
  styles: `
    :host {
      --c1: var(--gz-pink-100); --c2: var(--gz-pink-200); --c3: var(--gz-lavender-100); --accent: var(--gz-pink); --fl-a: #fff; --fl-b: var(--gz-pink);
    }
    :host([data-s='learn']) { --c1: var(--gz-peach-100); --c2: var(--gz-peach); --c3: var(--gz-pink-100); --accent: #ee8f68; --fl-b: var(--gz-lavender); }
    :host([data-s='track']) { --c1: var(--gz-lavender-100); --c2: var(--gz-lavender-200); --c3: var(--gz-pink-100); --accent: #a468d8; --fl-b: var(--gz-pink); }
    :host([data-s='assistant']) { --c1: var(--gz-mint-100); --c2: var(--gz-mint-200); --c3: var(--gz-lavender-100); --accent: #4cae92; --fl-b: var(--gz-pink); }

    ion-header.ob-head { --background: var(--c1); background: var(--c1); }
    .ob-top { justify-content: space-between; }
    .ob-side { flex: 1 1 0; display: flex; align-items: center; min-width: 46px; }
    .ob-side.end { justify-content: flex-end; }
    ion-content.ob-content { --background: var(--gz-bg); }

    .scene { position: relative; min-height: 100%; display: flex; flex-direction: column; overflow: hidden; isolation: isolate; background: linear-gradient(180deg, var(--c1) 0%, var(--c1) 56%, var(--gz-bg) 100%); }

    /* ---- decoration layer (never intercepts touches, always behind content) ---- */
    .bg { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
    .blob { position: absolute; border-radius: 58% 42% 55% 45% / 48% 56% 44% 52%; will-change: transform; }
    .b1 { width: 118%; aspect-ratio: 1; top: -6%; inset-inline-start: -9%; background: radial-gradient(circle at 38% 34%, #fff 0%, var(--c2) 70%, var(--c2) 100%); opacity: 0.8; animation: obDrift 16s ease-in-out infinite alternate; }
    .b2 { width: 62%; aspect-ratio: 1; top: 34%; inset-inline-end: -16%; background: var(--c3); opacity: 0.85; animation: obDrift 19s ease-in-out -6s infinite alternate-reverse; }
    .thread { position: absolute; inset-inline: 0; top: 30%; width: 100%; height: 26%; overflow: visible; }
    .thread path { fill: none; stroke: var(--accent); stroke-width: 3; stroke-linecap: round; stroke-dasharray: 1 9; opacity: 0.55; vector-effect: non-scaling-stroke; }
    html[dir='rtl'] .thread, :host-context(html[dir='rtl']) .thread { transform: scaleX(-1); }
    .deco { position: absolute; will-change: transform; }
    .fl { width: 26px; height: 26px; animation: obFloat 7s ease-in-out infinite alternate; }
    .f1 { top: 20%; inset-inline-start: 9%; }
    .f2 { top: 47%; inset-inline-end: 8%; width: 20px; height: 20px; animation-delay: -3s; }
    .sp { fill: #ffcf5a; width: 16px; height: 16px; animation: obTwinkle 4.5s ease-in-out infinite; }
    .s1 { top: 14%; inset-inline-end: 14%; }
    .s2 { top: 42%; inset-inline-start: 6%; width: 11px; height: 11px; animation-delay: -2s; }
    .ht { fill: var(--gz-pink); width: 15px; height: 15px; opacity: 0.8; top: 31%; inset-inline-end: 22%; animation: obFloat 8s ease-in-out -2s infinite alternate; }

    /* ---- hero: artwork fills the free height, fully visible (object-fit: contain), never stretched ---- */
    .hero { position: relative; z-index: 2; flex: 1 1 0; min-height: clamp(190px, 30dvh, 340px); margin: 0 16px -30px; }
    .art {
      position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; object-position: center bottom; user-select: none;
      filter: drop-shadow(0 16px 14px rgba(129, 61, 181, 0.16)); animation: obArt 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
    }

    /* ---- panel: curved cream surface the artwork overlaps ---- */
    .panel {
      position: relative; z-index: 1; display: flex; flex-direction: column; gap: 8px; flex: none;
      background: var(--gz-bg); border-radius: 36px 36px 0 0; box-shadow: 0 -10px 28px rgba(129, 61, 181, 0.08);
      padding: 42px var(--gz-screen-pad) calc(16px + var(--gz-safe-bottom));
    }
    .brand { display: flex; align-items: center; gap: 10px; justify-content: center; }
    .bn { font-size: 19px; color: var(--gz-primary); }
    .title { margin: 0; text-align: center; font-size: clamp(22px, 7vw, 28px); line-height: 1.5; text-wrap: balance; color: var(--gz-text); }
    html[dir='ltr'] .title, :host-context(html[dir='ltr']) .title { line-height: 1.22; }
    .sub { margin: 0; text-align: center; font-size: 15.5px; line-height: 1.75; text-wrap: balance; }
    :host-context(html[dir='ltr']) .sub { line-height: 1.55; }
    .prog { display: flex; justify-content: center; gap: 8px; margin: 10px 0 6px; }
    .prog > span { display: block; height: 8px; width: 8px; border-radius: 8px; background: var(--gz-lavender-200); transition: width 0.35s cubic-bezier(0.34, 1.3, 0.5, 1), background-color 0.3s; }
    .prog > span.past { background: var(--gz-lavender); }
    .prog > span.on { width: 28px; background: var(--gz-primary); }
    .cta { display: flex; flex-direction: column; gap: 10px; }

    .rise { animation: obRise 0.55s cubic-bezier(0.22, 1, 0.36, 1) both; animation-delay: var(--d, 0ms); }

    /* short phones (320×568 class): tighten, keep everything reachable */
    @media (max-height: 640px) {
      .hero { min-height: 170px; margin-bottom: -22px; }
      .panel { padding-top: 32px; gap: 6px; }
      .sub { font-size: 14.5px; line-height: 1.6; }
      .prog { margin: 6px 0 2px; }
    }

    @keyframes obArt { from { opacity: 0; transform: translateY(18px) scale(0.93); } to { opacity: 1; transform: none; } }
    @keyframes obRise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
    @keyframes obFloat { from { transform: translate3d(0, 0, 0) rotate(-4deg); } to { transform: translate3d(0, -7px, 0) rotate(5deg); } }
    @keyframes obTwinkle { 0%, 100% { transform: scale(0.8); opacity: 0.55; } 50% { transform: scale(1.15); opacity: 1; } }
    @keyframes obDrift { from { transform: translate3d(0, 0, 0) rotate(0deg); } to { transform: translate3d(2%, 2%, 0) rotate(6deg); } }
    @media (prefers-reduced-motion: reduce) {
      .blob, .deco, .art, .rise { animation: none; }
      .prog > span { transition: none; }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnboardingPage {
  protected readonly i18n = inject(I18nService);
  protected readonly ai = inject(AssistantService);
  private readonly nav = inject(NavController);
  private readonly auth = inject(AuthService);
  readonly slideKey = input<string>('welcome', { alias: 'slide' });

  protected readonly t = this.i18n.t;
  protected readonly slides = SLIDES;
  protected readonly last = SLIDES.length - 1;
  protected readonly step = computed(() => Math.max(0, SLIDES.indexOf(this.slideKey() as SlideKey)));
  protected readonly slideName = computed<SlideKey>(() => SLIDES[this.step()]);
  protected readonly art = computed(() => ART[this.slideName()]);

  protected readonly alt = computed(() => {
    const q = (a: string, e: string) => this.i18n.q(a, e);
    return [
      q('أرنوب كروشيه لطيف مع كرة خيط بالألوان الباستيل', 'A cute crochet bunny with pastel yarn'),
      q('سلة كروشيه فيها كرات خيط وإبر ملونة', 'A crochet basket with yarn balls and hooks'),
      q('كرة خيط وإبرة كروشيه وقلب كروشيه مبتسم', 'A yarn ball, a crochet hook and a smiling crochet heart'),
      q('وردة كروشيه مبتسمة بتحضن كرة خيط', 'A smiling crochet flower hugging a ball of yarn'),
    ][this.step()];
  });

  /** One clear benefit per slide. Slide 4 stays honest: the assistant is a demo build (badge shown while no AI endpoint is connected). */
  protected readonly copy = computed(() => {
    const q = (a: string, e: string) => this.i18n.q(a, e);
    return [
      { title: q('كل غرزة ليها حكاية', 'Every stitch has a story'), body: q('غرزتك رفيقتك اللطيفة في رحلة الكروشيه، من أول خيط لآخر لمسة.', 'Gharzetak is your gentle companion on your crochet journey, from the first loop to the final touch.'), cta: q('يلا نبدأ', "Let's begin") },
      { title: q('اتعلّمي وابدعي بطريقتك', 'Learn and create your way'), body: q('اكتشفي الغرز والباترونات، وخلي كل مشروع فرصة تتعلمي حاجة جديدة.', 'Explore stitches and patterns, and turn every project into a chance to learn something new.'), cta: q('التالي', 'Next') },
      { title: q('ولا غرزة هتضيع منك', 'Never lose a single stitch'), body: q('عدّاد ذكي يحفظ الغرز والأدوار وتقدّمك، حتى وإنتي من غير إنترنت.', 'A smart counter saves your stitches, rounds and progress, even when you are offline.'), cta: q('التالي', 'Next') },
      { title: q('رفيقة معاكي في كل غرزة', 'A companion for every stitch'), body: q('اسألي عن الغرز والباترونات، ونظّمي رحلة الكروشيه بكل سهولة.', 'Ask about stitches and patterns, and organise your crochet journey with ease.'), cta: this.auth.canEnterApp() ? q('تمام', 'Done') : q('ابدئي رحلتك', 'Start your journey') },
    ][this.step()];
  });

  constructor() {
    // Warm the next scene's artwork so the slide transition never shows an empty hero.
    afterNextRender(() => {
      const nxt = SLIDES[this.step() + 1];
      if (nxt) new Image().src = ART[nxt];
    });
  }

  protected next(): void {
    const i = this.step();
    if (i < this.last) void this.nav.navigateForward(['/onboarding', SLIDES[i + 1]], { queryParamsHandling: 'preserve' });
    else if (this.auth.canEnterApp()) void this.nav.navigateRoot('/tabs/home');
    else void this.nav.navigateForward('/auth/signup');
  }

  protected back(): void {
    const i = this.step();
    if (i > 0) void this.nav.navigateBack(['/onboarding', SLIDES[i - 1]], { queryParamsHandling: 'preserve' });
  }

  protected goLogin(): void {
    if (this.auth.canEnterApp()) return void this.nav.navigateRoot('/tabs/home');
    void this.nav.navigateForward('/auth/login');
  }
}
