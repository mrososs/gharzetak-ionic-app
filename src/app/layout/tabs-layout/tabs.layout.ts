import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { IonTabBar, IonTabButton, IonTabs } from '@ionic/angular';
import { filter, map } from 'rxjs';
import { IconName } from '../../core/data/icons';
import { I18nService } from '../../core/i18n/i18n.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';

interface Tab {
  id: string;
  icon: IconName;
  ar: string;
  en: string;
  mid?: boolean;
  raise?: boolean;
  tone?: 'lav' | 'sage';
}

/** Main shell: Ionic tabs (one navigation stack per tab) with the design's raised tracker button. */
@Component({
  selector: 'gz-tabs-layout',
  imports: [IonTabs, IonTabBar, IonTabButton, IconComponent],
  template: `
    <ion-tabs>
      <ion-tab-bar slot="bottom" class="gz-tabbar" [hidden]="hideBar()" [attr.aria-label]="i18n.t().mainNav">
        @for (tab of tabs; track tab.id) {
          <ion-tab-button [tab]="tab.id" [class.gz-mid]="tab.mid" [class.gz-raise]="tab.raise" [attr.data-tone]="tab.tone">
            <span class="gz-nvi"><svg [gzIcon]="tab.icon" /></span>
            <span class="gz-nv-label">{{ i18n.isAr() ? tab.ar : tab.en }}</span>
          </ion-tab-button>
        }
      </ion-tab-bar>
    </ion-tabs>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabsLayout {
  protected readonly i18n = inject(I18nService);
  private readonly router = inject(Router);

  protected readonly tabs: Tab[] = [
    { id: 'home', icon: 'home', ar: 'الرئيسية', en: 'Home' },
    // Projects & Learn echo the raised tracker button (smaller, toned) — a stepped "wave" across the bar.
    { id: 'projects', icon: 'folder', ar: 'مشاريعي', en: 'Projects', raise: true, tone: 'lav' },
    { id: 'tracker', icon: 'counter', ar: 'العداد', en: 'Tracker', mid: true },
    { id: 'learn', icon: 'book', ar: 'تعلّمي', en: 'Learn', raise: true, tone: 'sage' },
    { id: 'assistant', icon: 'sparkles', ar: 'المساعد الذكي', en: 'AI Assistant' },
  ];

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** The design hides the bar on full-screen forms (new project / add pattern). */
  protected readonly hideBar = computed(() => /\/(projects|patterns)\/new(\?|$)/.test(this.url()));
}
