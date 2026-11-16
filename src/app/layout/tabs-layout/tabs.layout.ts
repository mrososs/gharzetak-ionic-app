import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { IonTabBar, IonTabButton, IonTabs } from '@ionic/angular';
import { filter, map } from 'rxjs';
import { I18nService } from '../../core/i18n/i18n.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { TABS, isBarHiddenFor, tabIdFromUrl } from './tabs.config';

/**
 * Main shell: Ionic tabs (one navigation stack per tab). The bar is compact; the regular tabs share one
 * organic selection shape that slides to the active tab, and the Tracker is a floating pink action.
 * Styles live in theme/ionic-overrides.scss (Ionic shadow parts), not here.
 */
@Component({
  selector: 'gz-tabs-layout',
  imports: [IonTabs, IonTabBar, IonTabButton, IconComponent],
  template: `
    <ion-tabs>
      <ion-tab-bar
        slot="bottom"
        class="gz-tabbar"
        [hidden]="hideBar()"
        [attr.aria-label]="i18n.t().mainNav"
        [style.--gz-tab-i]="activeIndex()"
        [style.--gz-tab-n]="tabs.length"
      >
        <span class="gz-tab-blob" [class.is-off]="!blobVisible()" aria-hidden="true"><span class="gz-tab-blob-body"></span></span>
        @for (tab of tabs; track tab.id) {
          <ion-tab-button [tab]="tab.id" [class.gz-mid]="tab.mid" [class.gz-active]="tab.id === activeId()">
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

  protected readonly tabs = TABS;

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** Active tab id, derived from the URL so nested pages (e.g. a project's detail) keep their tab highlighted. */
  protected readonly activeId = computed(() => tabIdFromUrl(this.url()));
  /** Slot index of the active tab (first slot for non-tab URLs, where the shape is hidden anyway). */
  protected readonly activeIndex = computed(() => Math.max(0, this.tabs.findIndex((t) => t.id === this.activeId())));
  protected readonly blobVisible = computed(() => {
    const tab = this.tabs.find((t) => t.id === this.activeId());
    return !!tab && !tab.mid;
  });

  /** The design hides the bar on full-screen forms (new project / add pattern). */
  protected readonly hideBar = computed(() => isBarHiddenFor(this.url()));
}
