import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { IonContent, IonHeader, NavController } from '@ionic/angular';
import { IconName } from '../../core/data/icons';
import { TERMS, TERM_AR_NAME, Tone } from '../../core/data/catalog';
import { ConvertDirection, convertText } from '../../core/domain/terminology';
import { I18nService } from '../../core/i18n/i18n.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';

/** GZ-S22 dictionary · GZ-S23 converter (?tab=conv). */
@Component({
  selector: 'gz-terminology',
  imports: [IonHeader, IonContent, IconComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top">
        <button type="button" class="gz-icb" (click)="nav.back()" [attr.aria-label]="t().back"><svg gzIcon="arrowl" [flip]="true" /></button>
        <h1 class="gz-ttl gz-hd">{{ t().terminology }}</h1>
        <span style="width: 46px"></span>
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      <div class="gz-pad">
        <div class="gz-seg" style="margin: 4px 0 12px" role="tablist">
          <button type="button" role="tab" [class.on]="mode() === 'dict'" [attr.aria-selected]="mode() === 'dict'" (click)="mode.set('dict')">{{ t().dictionary }}</button>
          <button type="button" role="tab" [class.on]="mode() === 'conv'" [attr.aria-selected]="mode() === 'conv'" (click)="mode.set('conv')">{{ t().converter }}</button>
        </div>

        @if (mode() === 'dict') {
          <div class="gz-card" style="padding: 14px">
            <div class="mb-2 flex items-center justify-between gap-2"><span class="gz-b gz-hd" style="font-size: 15px">{{ t().usVsUk }}</span><span class="gz-badge peach">{{ t().sameAbbr }}</span></div>
            <div class="grid grid-cols-3 gap-1.5 text-center">
              <span class="gz-xs gz-mute gz-b">{{ t().usHead }}</span><span></span><span class="gz-xs gz-mute gz-b">{{ t().ukHead }}</span>
              @for (m of map; track m[0]) {
                <span class="gz-pill cur w-full">{{ m[0] }}</span>
                <span class="flex items-center justify-center" style="color: var(--gz-primary)"><svg gzIcon="arrow" size="s" [flip]="true" /></span>
                <span class="gz-pill w-full" style="background: var(--gz-pink-200); border-color: var(--gz-pink-200); color: var(--gz-pink-ink)">{{ m[1] }}</span>
              }
            </div>
          </div>
          <div class="gz-in mt-3.5"><svg gzIcon="search" /><input type="search" [value]="q()" (input)="q.set($any($event.target).value)" [placeholder]="t().searchStitch" [attr.aria-label]="t().searchStitch" /></div>
          <div class="mt-3 flex flex-col gap-2.5">
            @for (e of items(); track e.abbr) {
              <div class="gz-card soft" style="padding: 12px 14px">
                <div class="flex items-start gap-2.5">
                  <div class="gz-hd gz-ltr gz-tile t-{{ e.tone }}" style="min-width: 56px; height: 46px; padding: 0 8px; font-size: 15px">{{ e.abbr }}</div>
                  <div class="flex flex-1 flex-col gap-0.5"><div class="gz-b" style="font-size: 15px">{{ e.name }}</div><div class="gz-xs gz-mute">{{ e.line }}</div></div>
                </div>
                <p class="gz-sm" style="margin: 8px 0 4px">{{ e.desc }}</p>
                <div class="gz-xs gz-b" style="color: var(--gz-primary)">{{ t().example }}: <span class="gz-code" style="font-size: 13px">{{ e.ex }}</span> = {{ e.exText }}</div>
              </div>
            }
          </div>
          @if (!items().length) {
            <div class="gz-note lav mt-2.5"><span>{{ t().noStitch }}</span></div>
          }
          <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ t().beginnerCards }}</h2></div>
          <div class="flex flex-col gap-2.5">
            @for (c of cards(); track c.title) {
              <div class="gz-rcard">
                <div class="flex items-start gap-2.5">
                  <div class="gz-tile t-{{ c.tone }}" style="width: 42px; height: 42px"><svg [gzIcon]="c.icon" /></div>
                  <div class="flex-1"><div class="gz-b">{{ c.title }}</div><p class="gz-sm gz-mute" style="margin: 2px 0 0; line-height: 1.65">{{ c.body }}</p></div>
                </div>
              </div>
            }
          </div>
        } @else {
          <div class="gz-seg">
            <button type="button" [class.on]="dir() === 'us2uk'" (click)="dir.set('us2uk')">{{ t().us2uk }}</button>
            <button type="button" [class.on]="dir() === 'uk2us'" (click)="dir.set('uk2us')">{{ t().uk2us }}</button>
          </div>
          <label class="gz-lbl" for="cv-in">{{ t().convInput }}</label>
          <textarea id="cv-in" class="gz-ta gz-ltr" dir="ltr" style="min-height: 104px" [value]="text()" (input)="text.set($any($event.target).value)" placeholder="R3: (sc, inc) × 6 [18]" maxlength="20000"></textarea>
          <div class="gz-chips mt-2">
            @for (x of examples; track x) {
              <button type="button" class="gz-chip sm" (click)="text.set(x)"><span class="gz-ltr">{{ x }}</span></button>
            }
          </div>
          <span class="gz-lbl">{{ t().convOutput }}</span>
          <div class="gz-card focus">
            <div class="gz-code" style="min-height: 44px; white-space: pre-wrap; font-size: 16px" aria-live="polite">{{ conv().out || '—' }}</div>
            <div class="mt-2 flex"><span class="gz-badge sage">{{ i18n.q('تم تحويل ' + conv().n + ' اختصار', conv().n + ' abbreviation(s) converted') }}</span></div>
          </div>
          <div class="gz-note lav mt-3"><svg gzIcon="info" size="s" /><span>{{ t().convNote }}</span></div>
        }
      </div>
    </ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TerminologyPage {
  protected readonly i18n = inject(I18nService);
  protected readonly nav = inject(NavController);
  readonly tab = input<string>();

  protected readonly t = this.i18n.t;
  protected readonly mode = linkedSignal<'dict' | 'conv'>(() => (this.tab() === 'conv' ? 'conv' : 'dict'));
  protected readonly q = signal('');
  protected readonly dir = signal<ConvertDirection>('us2uk');
  protected readonly text = signal('R3: (sc, inc) × 6 [18]');
  protected readonly map = [['sc', 'dc'], ['hdc', 'htr'], ['dc', 'tr'], ['tr', 'dtr'], ['dtr', 'trtr']] as const;
  protected readonly examples = ['R3: (sc, inc) × 6 [18]', '12hdc, 6dc, ch 3', 'sl st, 4tr, dtr'];
  protected readonly conv = computed(() => convertText(this.text(), this.dir()));

  protected readonly items = computed(() => {
    const ql = this.q().trim().toLowerCase();
    const ar = this.i18n.isAr();
    return TERMS.filter((e) => !ql || `${e.us} ${e.uk} ${e.usN} ${e.ukN} ${TERM_AR_NAME[e.k]} ${e.ar} ${e.en}`.toLowerCase().includes(ql)).map((e) => ({
      abbr: e.us === e.uk ? e.us : `${e.us} · ${e.uk}`,
      tone: e.tone,
      name: ar ? TERM_AR_NAME[e.k] : e.usN,
      line: e.us === e.uk ? `US = UK: ${e.usN}` : `US: ${e.usN} (${e.us})  ·  UK: ${e.ukN} (${e.uk})`,
      desc: ar ? e.ar : e.en,
      ex: e.ex,
      exText: ar ? e.exAr : e.exEn,
    }));
  });

  protected readonly cards = computed<{ icon: IconName; tone: Tone; title: string; body: string }[]>(() => {
    const q = (a: string, e: string) => this.i18n.q(a, e);
    return [
      { icon: 'info', tone: 'lav', title: q('أنهي نظام أستخدم؟', 'Which system am I using?'), body: q('الباترن الأمريكي بيقول sc للغرزة القصيرة، والبريطاني بيقول dc لنفس الغرزة. لو الباترن فيه sc وفيه hdc غالبًا هو أمريكي.', 'American patterns say sc for the short stitch; British patterns say dc for the same stitch. If a pattern uses sc and hdc it is most likely American.') },
      { icon: 'sprout', tone: 'sage', title: q('الزيادة مقابل التنقيص', 'Increase vs decrease'), body: q('inc بياخد غرزة وبيطلّع اتنين. dec بياخد اتنين وبيطلّع واحدة. دول اللي بيخلّوا الشكل يتكوّر ويتقفل.', 'inc takes one stitch and makes two. dec takes two and makes one. They shape and close a form.') },
      { icon: 'list', tone: 'peach', title: q('إزاي أقرأ الأقواس', 'How to read the brackets'), body: q('(sc, inc) × 6 يعني: غرزة وزيادة، وكرري 6 مرات. الرقم بين [ ] هو عدد الغرز بعد الدور.', '(sc, inc) × 6 means: a stitch then an increase, six times. The number in [ ] is the stitch count after the round.') },
    ];
  });
}
