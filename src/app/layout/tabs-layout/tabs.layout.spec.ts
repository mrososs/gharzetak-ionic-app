import { CUSTOM_ELEMENTS_SCHEMA, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, expect, it, beforeEach } from 'vitest';
import { I18nService } from '../../core/i18n/i18n.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { TabsLayout } from './tabs.layout';

@Component({ template: '', selector: 'gz-stub-page' })
class StubPage {}

/** The Ionic web components are not defined in unit tests, so the layout runs with plain custom elements:
 *  these tests cover the Angular logic (active tab, selection shape, a11y, bar visibility), not Ionic's DOM. */
describe('TabsLayout', () => {
  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', component: StubPage }])] });
    TestBed.overrideComponent(TabsLayout, { set: { imports: [IconComponent], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
  });

  async function setup(url: string) {
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    const fixture = TestBed.createComponent(TabsLayout);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const bar = () => el.querySelector<HTMLElement>('ion-tab-bar')!;
    const blob = () => el.querySelector<HTMLElement>('.gz-tab-blob')!;
    const buttons = () => [...el.querySelectorAll<HTMLElement>('ion-tab-button')];
    const go = async (u: string) => {
      await router.navigateByUrl(u);
      fixture.detectChanges();
    };
    return { fixture, bar, blob, buttons, go };
  }

  it('renders the five tabs in order, each wired to its route', async () => {
    const { buttons } = await setup('/tabs/home');
    expect(buttons().map((b) => (b as unknown as { tab: string }).tab)).toEqual(['home', 'projects', 'tracker', 'learn', 'assistant']);
  });

  it('keeps the Tracker as the single floating (mid) button', async () => {
    const { buttons } = await setup('/tabs/home');
    const mids = buttons().filter((b) => b.classList.contains('gz-mid'));
    expect(mids).toHaveLength(1);
    expect(buttons()[2]).toBe(mids[0]);
  });

  it('shows labels in Arabic by default and switches to English', async () => {
    const { fixture, buttons } = await setup('/tabs/home');
    const i18n = TestBed.inject(I18nService);
    i18n.lang.set('ar');
    fixture.detectChanges();
    expect(buttons().map((b) => b.querySelector('.gz-nv-label')?.textContent?.trim())).toEqual(['الرئيسية', 'مشاريعي', 'العداد', 'تعلّمي', 'المساعد الذكي']);
    i18n.lang.set('en');
    fixture.detectChanges();
    expect(buttons().map((b) => b.querySelector('.gz-nv-label')?.textContent?.trim())).toEqual(['Home', 'Projects', 'Tracker', 'Learn', 'AI Assistant']);
  });

  it('has an accessible tab-bar landmark label', async () => {
    const { bar } = await setup('/tabs/home');
    expect(bar().getAttribute('aria-label')).toBeTruthy();
  });

  it('moves the single selection shape to the active regular tab', async () => {
    const { blob, bar, buttons, go } = await setup('/tabs/home');
    expect(bar().style.getPropertyValue('--gz-tab-i')).toBe('0');
    expect(blob().classList.contains('is-off')).toBe(false);
    expect(document.querySelectorAll('.gz-tab-blob').length).toBe(1);

    await go('/tabs/learn');
    expect(bar().style.getPropertyValue('--gz-tab-i')).toBe('3');
    expect(buttons().filter((b) => b.classList.contains('gz-active')).map((b) => (b as unknown as { tab: string }).tab)).toEqual(['learn']);

    await go('/tabs/projects/12');
    expect(bar().style.getPropertyValue('--gz-tab-i')).toBe('1');
    expect(blob().classList.contains('is-off')).toBe(false);
  });

  it('keeps a tab active on its nested pages', async () => {
    const { buttons, go } = await setup('/tabs/home');
    await go('/tabs/home/settings');
    expect(buttons()[0].classList.contains('gz-active')).toBe(true);
  });

  it('hides the selection shape while the Tracker is active (it has its own treatment)', async () => {
    const { blob, buttons, go } = await setup('/tabs/projects');
    await go('/tabs/tracker');
    expect(blob().classList.contains('is-off')).toBe(true);
    expect(buttons()[2].classList.contains('gz-active')).toBe(true);
    await go('/tabs/assistant');
    expect(blob().classList.contains('is-off')).toBe(false);
  });

  it('hides the whole bar on the full-screen creation forms', async () => {
    const { bar, go } = await setup('/tabs/projects');
    expect(bar().hidden).toBe(false);
    await go('/tabs/projects/new');
    expect(bar().hidden).toBe(true);
    await go('/tabs/home/patterns/new');
    expect(bar().hidden).toBe(true);
    await go('/tabs/projects');
    expect(bar().hidden).toBe(false);
  });
});
