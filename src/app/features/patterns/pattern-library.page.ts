import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { IonContent, IonHeader, NavController } from '@ionic/angular';
import { IconName } from '../../core/data/icons';
import { parsePattern } from '../../core/domain/pattern-parser';
import { I18nService } from '../../core/i18n/i18n.service';
import { AppStore } from '../../core/state/app.store';
import { IconComponent } from '../../shared/ui/icon/icon.component';

/** GZ-S16 — pattern library. */
@Component({
  selector: 'gz-pattern-library',
  imports: [IonHeader, IonContent, IconComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top">
        <button type="button" class="gz-icb" (click)="nav.back()" [attr.aria-label]="t().back"><svg gzIcon="arrowl" [flip]="true" /></button>
        <h1 class="gz-ttl gz-hd">{{ t().patternReader }}</h1>
        <button type="button" class="gz-icb pur" (click)="nav.navigateForward('/tabs/home/patterns/new')" [attr.aria-label]="t().addPattern"><svg gzIcon="plus" /></button>
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      <div class="gz-pad">
        <div class="gz-note lav" style="margin: 4px 0 14px"><svg gzIcon="info" size="s" /><span>{{ t().readerSupports }}</span></div>
        <div class="flex flex-col gap-3">
          @for (p of items(); track p.id) {
            <button type="button" class="gz-rcard" (click)="nav.navigateForward(['/tabs/home/patterns', p.id])" [attr.aria-label]="p.name">
              <div class="flex items-start gap-3">
                <div class="gz-tile t-{{ p.tone }}" style="width: 52px; height: 52px"><svg [gzIcon]="p.icon" /></div>
                <div class="flex min-w-0 flex-1 flex-col gap-1">
                  <div class="gz-b gz-hd" style="font-size: 16px">{{ p.name }}</div>
                  <div class="flex flex-wrap gap-1.5"><span class="gz-badge {{ p.srcCls }}">{{ p.srcName }}</span><span class="gz-badge">{{ p.lvlName }}</span><span class="gz-badge sage gz-ltr">{{ p.terms }}</span></div>
                  <div class="gz-xs gz-mute">{{ p.meta }}</div>
                  @if (p.attribution) {
                    <div class="gz-xs gz-mute">© {{ p.attribution }}</div>
                  }
                  @if (p.linked) {
                    <div class="gz-xs gz-b" style="color: var(--gz-primary)">{{ p.linked }}</div>
                  }
                </div>
              </div>
            </button>
          }
        </div>
        <button type="button" class="gz-btn mt-4" (click)="nav.navigateForward('/tabs/home/patterns/new')"><svg gzIcon="plus" />{{ t().addPattern }}</button>
      </div>
    </ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PatternLibraryPage {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(AppStore);
  protected readonly nav = inject(NavController);
  protected readonly t = this.i18n.t;

  protected readonly items = computed(() => {
    const q = (a: string, e: string) => this.i18n.q(a, e);
    const srcN: Record<string, string> = { sample: q('نموذج', 'Sample'), text: q('نص', 'Text'), pdf: 'PDF', image: q('صورة', 'Image'), youtube: 'YouTube' };
    const srcC: Record<string, string> = { sample: 'sage', text: '', pdf: 'rose', image: 'peach', youtube: 'rose' };
    const srcI: Record<string, IconName> = { sample: 'file', text: 'notes', pdf: 'file', image: 'image', youtube: 'film' };
    return this.store.patterns().map((pat) => {
      const pp = parsePattern(pat.text);
      const linked = this.store.projects().filter((x) => x.tracker.patternId === pat.id).map((x) => x.name);
      return {
        id: pat.id,
        name: this.store.patternName(pat),
        tone: pat.isSample ? 'blush' : 'lav',
        icon: srcI[pat.source] ?? 'file',
        srcName: srcN[pat.source] ?? srcN['text'],
        srcCls: srcC[pat.source] ?? '',
        lvlName: this.store.levelName(pat.level),
        terms: pat.terms.toUpperCase(),
        attribution: pat.isSample ? '' : pat.attribution,
        meta: pat.text
          ? `${pp.rounds.length} ${q('أدوار', 'rounds')}` + (pp.ok ? ` · ${pp.total} ${q('غرزة ناتجة', 'output stitches')}` : ` · ${pp.bad} ${q('غير مدعوم', 'unsupported')}`)
          : (pat.file?.name ?? ''),
        linked: linked.length ? q('مرتبط بـ: ', 'Linked to: ') + linked.join(this.i18n.isAr() ? '، ' : ', ') : '',
      };
    });
  });
}
