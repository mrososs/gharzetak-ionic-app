import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavController } from '@ionic/angular';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { SUPPORT_EMAIL, supportMailto } from '../../core/legal/support';
import { LegalConsentLineComponent } from '../../shared/ui/legal/legal-consent-line.component';
import { PrivacyAccountSectionComponent } from './privacy-account-section.component';

/** The generated environment is a plain object: tests set the legal base URL on it (restored after each test). */
const env = environment as { legalBaseUrl: string };
const ORIGINAL = env.legalBaseUrl;
afterEach(() => (env.legalBaseUrl = ORIGINAL));

describe('Settings → Privacy & account', () => {
  const signedIn = signal(true);
  const nav = { navigateForward: vi.fn() };

  function mount(lang: 'ar' | 'en') {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: { signedIn } }, { provide: NavController, useValue: nav }] });
    TestBed.inject(I18nService).lang.set(lang);
    const f = TestBed.createComponent(PrivacyAccountSectionComponent);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    localStorage.clear();
    signedIn.set(true);
    env.legalBaseUrl = 'https://legal.example.test';
    vi.clearAllMocks();
  });

  it.each([
    ['ar', 'https://legal.example.test/privacy/', 'https://legal.example.test/terms/', 'https://legal.example.test/delete-account/'],
    ['en', 'https://legal.example.test/en/privacy/', 'https://legal.example.test/en/terms/', 'https://legal.example.test/en/delete-account/'],
  ] as const)('(%s) the three legal rows open the matching public page in a new tab', (lang, privacy, terms, del) => {
    const el = mount(lang);
    const a = (id: string) => el.querySelector<HTMLAnchorElement>(`[data-testid="legal-${id}"]`)!;
    expect(a('privacy').href).toBe(privacy);
    expect(a('terms').href).toBe(terms);
    expect(a('delete-account').href).toBe(del);
    for (const id of ['privacy', 'terms', 'delete-account']) {
      expect(a(id).target).toBe('_blank');
      expect(a(id).rel).toContain('noopener');
    }
  });

  it('shows the official support address and a working mailto link (subject only, no body) in both languages', () => {
    for (const lang of ['ar', 'en'] as const) {
      const el = mount(lang);
      expect(el.querySelector('[data-testid="support-address"]')!.textContent).toBe(SUPPORT_EMAIL);
      const href = el.querySelector<HTMLAnchorElement>('[data-testid="support-mail"]')!.getAttribute('href')!;
      expect(href).toBe(supportMailto('support', lang));
      expect(href.startsWith('mailto:gharzetak.support@gmail.com?subject=')).toBe(true);
      expect(href).not.toContain('body=');
    }
  });

  it('without a configured legal base URL the rows are disabled and say "not published yet" instead of linking anywhere', () => {
    env.legalBaseUrl = '';
    const el = mount('en');
    for (const id of ['privacy', 'terms', 'delete-account']) {
      const b = el.querySelector<HTMLButtonElement>(`[data-testid="legal-${id}"]`)!;
      expect(b.tagName).toBe('BUTTON');
      expect(b.disabled).toBe(true);
      expect(b.textContent).toContain('Not published yet');
    }
    expect(el.querySelector('[data-testid="support-mail"]')).not.toBeNull(); // support never depends on the legal pages
  });

  it('a signed-in user gets Delete account (opens the in-app flow); a guest gets no delete action', () => {
    const el = mount('en');
    el.querySelector<HTMLButtonElement>('[data-testid="settings-delete-account"]')!.click();
    expect(nav.navigateForward).toHaveBeenCalledWith('/tabs/home/settings/delete-account');
    signedIn.set(false);
    expect(mount('ar').querySelector('[data-testid="settings-delete-account"]')).toBeNull();
  });
});

describe('sign-up legal consent line', () => {
  function mount(lang: 'ar' | 'en') {
    TestBed.resetTestingModule();
    TestBed.inject(I18nService).lang.set(lang);
    const f = TestBed.createComponent(LegalConsentLineComponent);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }
  beforeEach(() => {
    localStorage.clear();
    env.legalBaseUrl = 'https://legal.example.test';
  });

  it.each([
    ['ar', 'https://legal.example.test/terms/', 'https://legal.example.test/privacy/'],
    ['en', 'https://legal.example.test/en/terms/', 'https://legal.example.test/en/privacy/'],
  ] as const)('(%s) links the Terms and the Privacy Policy', (lang, terms, privacy) => {
    const el = mount(lang);
    expect(el.querySelector<HTMLAnchorElement>('[data-testid="legal-consent-terms"]')!.href).toBe(terms);
    expect(el.querySelector<HTMLAnchorElement>('[data-testid="legal-consent-privacy"]')!.href).toBe(privacy);
  });

  it('renders nothing when the legal pages are not configured (no sentence pointing at pages that do not exist)', () => {
    env.legalBaseUrl = '';
    expect(mount('en').querySelector('[data-testid="legal-consent"]')).toBeNull();
  });
});

describe('support contact', () => {
  it('uses exactly the official address, per-topic subjects in both languages, and no body', () => {
    expect(SUPPORT_EMAIL).toBe('gharzetak.support@gmail.com');
    expect(decodeURIComponent(supportMailto('deletion', 'en'))).toBe('mailto:gharzetak.support@gmail.com?subject=Gharzetak account deletion request');
    expect(decodeURIComponent(supportMailto('deletion', 'ar'))).toContain('طلب حذف حساب غرزتك');
    expect(supportMailto('support', 'ar')).not.toContain('body');
  });
});
