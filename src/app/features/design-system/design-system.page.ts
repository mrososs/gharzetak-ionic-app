import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { IonContent, IonHeader, IonSelect, IonSelectOption, NavController } from '@ionic/angular';
import { AuthService } from '../../core/auth/auth.service';
import { ICONS, IconName } from '../../core/data/icons';
import { I18nService } from '../../core/i18n/i18n.service';
import { AppStore } from '../../core/state/app.store';
import { loadDemoProjects } from '../../core/state/demo-data';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { BrandMarkComponent } from '../../shared/ui/brand/brand-mark.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PhotoComponent } from '../../shared/ui/images/photo.component';
import { StepperComponent } from '../../shared/ui/inputs/stepper.component';
import { GZ_SELECT_CHEVRON } from '../../shared/ui/inputs/select-icon';
import { RingComponent } from '../../shared/ui/progress/ring.component';

/** Internal Design System preview — validates tokens and components against the approved design. */
@Component({
  selector: 'gz-design-system',
  imports: [IonHeader, IonContent, IonSelect, IonSelectOption, IconComponent, PhotoComponent, RingComponent, StepperComponent, BrandMarkComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top">
        <button type="button" class="gz-icb" (click)="nav.back()" [attr.aria-label]="i18n.t().back"><svg gzIcon="arrowl" [flip]="true" /></button>
        <h1 class="gz-ttl gz-hd">{{ i18n.t().designSystem }}</h1>
        <button type="button" class="gz-chip sm" (click)="i18n.toggle()">{{ i18n.t().langBtn }}</button>
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      <div class="gz-pad">
        <div class="flex items-center gap-3"><gz-brand-mark [size]="64" /><div><div class="gz-h2 gz-hd" style="color: var(--gz-primary)">غرزتك · Gharzetak</div><div class="gz-xs gz-mute">{{ i18n.t().tagline }}</div></div></div>

        <h2 class="gz-h2 gz-hd mt-6">Colour</h2>
        <div class="mt-2 grid grid-cols-4 gap-2">
          @for (c of colors; track c[0]) {
            <div class="overflow-hidden rounded-sm border border-line bg-surface">
              <div style="height: 48px" [style.background]="'var(' + c[1] + ')'"></div>
              <div class="p-1.5 text-[10px] leading-tight"><b>{{ c[0] }}</b><br /><span class="gz-ltr">{{ c[2] }}</span></div>
            </div>
          }
        </div>

        <h2 class="gz-h2 gz-hd mt-6">Typography</h2>
        <div class="gz-card soft mt-2 flex flex-col gap-1">
          <span class="gz-h1 gz-hd">H1 24 · عنوان رئيسي</span>
          <span class="gz-h2 gz-hd">H2 20 · عنوان قسم</span>
          <span class="gz-title gz-hd">Title 18 · عنوان</span>
          <span class="gz-body">Body 15 · نص عادي بخط Playpen Sans Arabic</span>
          <span class="gz-sm">Small 13 · نص صغير</span>
          <span class="gz-xs">Caption 12 · تعليق</span>
          <span class="gz-num" style="font-size: 68px">30</span>
          <span class="gz-code">R5: (3sc, inc) × 6 [30]</span>
        </div>

        <h2 class="gz-h2 gz-hd mt-6">Buttons</h2>
        <div class="mt-2 flex flex-col gap-2">
          <button type="button" class="gz-btn"><svg gzIcon="plus" />Primary</button>
          <button type="button" class="gz-btn" disabled>Disabled</button>
          <button type="button" class="gz-btn2">Secondary</button>
          <div class="flex gap-2"><button type="button" class="gz-btn3">Tonal</button><button type="button" class="gz-btn3 rose">Rose</button><button type="button" class="gz-btn3 sage">Sage</button></div>
          <button type="button" class="gz-btn danger">Destructive</button>
          <div class="flex gap-3"><button type="button" class="gz-icb"><svg gzIcon="bell" /><span class="gz-dot"></span></button><button type="button" class="gz-icb flat"><svg gzIcon="camera" /></button><button type="button" class="gz-icb pur"><svg gzIcon="send" /></button></div>
          <button type="button" class="gz-bigbtn"><svg gzIcon="plus" size="l" />+5</button>
          <button type="button" class="gz-bigbtn done"><svg gzIcon="check" size="l" />Done</button>
        </div>

        <h2 class="gz-h2 gz-hd mt-6">Chips · badges · pills</h2>
        <div class="gz-chips mt-2"><button type="button" class="gz-chip">Chip</button><button type="button" class="gz-chip on">Selected</button><button type="button" class="gz-chip sm">Small</button></div>
        <div class="gz-chips mt-2"><span class="gz-badge">Lavender</span><span class="gz-badge rose">Rose</span><span class="gz-badge sage">Sage</span><span class="gz-badge peach">Peach</span><span class="gz-badge dark">Dark</span><span class="gz-badge pur">Purple</span></div>
        <div class="gz-chips mt-2"><span class="gz-pill dn">R1</span><span class="gz-pill dn">R2</span><span class="gz-pill cur">R3</span><span class="gz-pill">R4</span></div>

        <h2 class="gz-h2 gz-hd mt-6">Inputs</h2>
        <div class="gz-seg mt-2"><button type="button" class="on">Segment A</button><button type="button">Segment B</button></div>
        <div class="gz-in mt-2"><svg gzIcon="mail" /><input type="email" placeholder="name@example.com" dir="ltr" aria-label="email" /></div>
        <textarea class="gz-ta mt-2" placeholder="Textarea" aria-label="textarea"></textarea>
        <label class="gz-lbl" for="ds-select">Dropdown (native)</label>
        <select id="ds-select" class="gz-select"><option>3.0 mm</option><option>3.5 mm</option><option>4.0 mm</option></select>
        <span class="gz-lbl">Dropdown (ion-select · popover)</span>
        <ion-select class="gz-select" fill="outline" [toggleIcon]="chevron" [expandedIcon]="chevron" [cancelText]="i18n.t().cancel" [okText]="i18n.t().done" interface="popover" placeholder="اختاري الخيط" aria-label="yarn">
          <ion-select-option value="cotton">قطن · Cotton</ion-select-option>
          <ion-select-option value="acrylic">أكريليك · Acrylic</ion-select-option>
          <ion-select-option value="wool">صوف · Wool</ion-select-option>
        </ion-select>
        <span class="gz-lbl">Dropdown (ion-select · action sheet)</span>
        <ion-select class="gz-select" fill="outline" [toggleIcon]="chevron" [expandedIcon]="chevron" [cancelText]="i18n.t().cancel" [okText]="i18n.t().done" interface="action-sheet" value="beginner" aria-label="level">
          <ion-select-option value="beginner">مبتدئة</ion-select-option>
          <ion-select-option value="intermediate">متوسطة</ion-select-option>
          <ion-select-option value="advanced">متقدمة</ion-select-option>
        </ion-select>
        <div class="gz-in invalid mt-2"><svg gzIcon="lock" /><input type="text" value="Invalid state" aria-label="invalid" /></div>
        <div class="gz-in mt-2"><svg gzIcon="user" /><input type="text" value="Disabled" disabled aria-label="disabled" /></div>
        <div class="mt-2 flex justify-between"><span>Stepper</span><gz-stepper [display]="step()" label="demo" (inc)="step.set(step() + 1)" (dec)="step.set(step() - 1)" /></div>

        <h2 class="gz-h2 gz-hd mt-6">Notes</h2>
        <div class="mt-2 flex flex-col gap-2">
          <div class="gz-note"><svg gzIcon="info" size="s" /><span>Peach note (demo / honesty)</span></div>
          <div class="gz-note lav"><svg gzIcon="info" size="s" /><span>Lavender info note</span></div>
          <div class="gz-note sage"><svg gzIcon="check" size="s" /><span>Success note</span></div>
          <div class="gz-note err"><svg gzIcon="info" size="s" /><span>Error note</span></div>
        </div>

        <h2 class="gz-h2 gz-hd mt-6">Progress</h2>
        <div class="mt-2 flex items-center gap-4">
          <gz-ring [fraction]="0.6" [size]="148" [stroke]="20"><span class="gz-num" style="font-size: 36px">18</span><span class="gz-xs gz-mute">/ 30</span></gz-ring>
          <gz-ring [fraction]="1" [done]="true" [size]="148" [stroke]="20"><span class="gz-num" style="font-size: 36px">30</span></gz-ring>
        </div>
        <div class="gz-bar mt-3"><i style="width: 60%"></i></div>

        <h2 class="gz-h2 gz-hd mt-6">Photo slots</h2>
        <div class="mt-2 grid grid-cols-3 gap-2">
          @for (tone of tones; track tone) {
            <gz-photo [tone]="tone" alt="Placeholder" height="90px" extraClass="r16" />
          }
        </div>

        <h2 class="gz-h2 gz-hd mt-6">Icons ({{ iconNames.length }})</h2>
        <div class="mt-2 grid grid-cols-6 gap-2">
          @for (n of iconNames; track n) {
            <div class="flex flex-col items-center gap-1 rounded-sm bg-surface p-2 text-[9px]"><svg [gzIcon]="n" /><span class="gz-ltr">{{ n }}</span></div>
          }
        </div>

        @if (!auth.signedIn()) {
          <h2 class="gz-h2 gz-hd mt-6">QA</h2>
          <button type="button" class="gz-btn3 w mt-2" (click)="demo()">Load demo projects (guest device only)</button>
        }
      </div>
    </ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DesignSystemPage {
  protected readonly i18n = inject(I18nService);
  protected readonly nav = inject(NavController);
  protected readonly auth = inject(AuthService);
  private readonly store = inject(AppStore);
  private readonly ui = inject(UiFeedback);
  protected readonly step = signal(30);
  protected readonly chevron = GZ_SELECT_CHEVRON;
  protected readonly tones = ['lav', 'blush', 'sage', 'peach', 'cream', 'plum'] as const;
  protected readonly iconNames = Object.keys(ICONS) as IconName[];
  protected readonly colors: [string, string, string][] = [
    ['Primary', '--gz-primary', '#813DB5'], ['Pink', '--gz-pink', '#F56FA8'], ['Lavender', '--gz-lavender', '#C5A4F4'], ['Peach', '--gz-peach', '#FFCCAA'],
    ['Mint', '--gz-mint', '#A6DCC9'], ['Cream', '--gz-bg', '#FFF9F5'], ['Blush', '--gz-surface-elevated', '#FFF1F7'], ['Plum', '--gz-text', '#35253E'],
    ['Tint', '--gz-primary-tint', '#F3E8FB'], ['Lav 200', '--gz-lavender-200', '#E2D0FA'], ['Pink 200', '--gz-pink-200', '#FDC2DB'], ['Pink ink', '--gz-pink-ink', '#A81F5E'],
    ['Mint 200', '--gz-mint-200', '#C6EBDD'], ['Mint ink', '--gz-mint-ink', '#17594A'], ['Peach ink', '--gz-peach-ink', '#8A3F12'], ['Border', '--gz-border', '#EBDDEA'],
  ];

  protected async demo(): Promise<void> {
    const n = await loadDemoProjects(this.store);
    await this.ui.toast(`${n} demo projects added`);
  }
}
