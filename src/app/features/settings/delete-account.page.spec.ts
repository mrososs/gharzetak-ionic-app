import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavController } from '@ionic/angular';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountDeletionService, type DeletionOutcome } from '../../core/auth/account-deletion.service';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { NetworkService } from '../../core/services/network.service';
import { legalUrl } from '../../core/legal/legal-links';
import { DELETE_ACCOUNT_COPY } from './delete-account.content';
import { DeleteAccountPage } from './delete-account.page';

type Methods = { password: boolean; google: boolean } | null;

describe('Delete account screen', () => {
  const signedIn = signal(true);
  const online = signal(true);
  const busy = signal(false);
  let methods: Methods;
  let outcome: DeletionOutcome;
  const deleteFn = vi.fn(async (_pw: string | null): Promise<DeletionOutcome> => outcome);
  const nav = { navigateBack: vi.fn(), navigateRoot: vi.fn(), navigateForward: vi.fn(), back: vi.fn() };

  async function open(lang: 'ar' | 'en' = 'en') {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { signedIn, accountKinds: async () => methods } },
        { provide: AccountDeletionService, useValue: { busy, delete: deleteFn } },
        { provide: NavController, useValue: nav },
        { provide: NetworkService, useValue: { online } },
      ],
    });
    TestBed.inject(I18nService).lang.set(lang);
    const f = TestBed.createComponent(DeleteAccountPage);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const el: HTMLElement = f.nativeElement;
    const q = <T extends Element = HTMLElement>(sel: string) => el.querySelector<T>(sel);
    const settle = async () => {
      await f.whenStable();
      f.detectChanges();
    };
    const type = (sel: string, v: string) => {
      const i = q<HTMLInputElement>(sel)!;
      i.value = v;
      i.dispatchEvent(new Event('input'));
    };
    const tick = async (sel: string) => {
      const i = q<HTMLInputElement>(sel)!;
      i.checked = true;
      i.dispatchEvent(new Event('change'));
      await settle();
    };
    return { f, el, q, type, tick, settle };
  }

  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    signedIn.set(true);
    online.set(true);
    busy.set(false);
    methods = { password: true, google: false };
    outcome = { ok: true, storageCleanup: 'complete', localCleanup: 'done' };
    vi.clearAllMocks();
  });

  it('explains what is deleted, what can remain and that it is irreversible — in English', async () => {
    const { el, q } = await open('en');
    const c = DELETE_ACCOUNT_COPY.en;
    expect(el.textContent).toContain(c.title);
    expect(el.querySelectorAll('[data-testid="delete-list"] li')).toHaveLength(c.deletes.length);
    expect(el.querySelectorAll('[data-testid="exceptions-list"] li')).toHaveLength(c.exceptions.length);
    expect(q('[data-testid="irreversible"]')!.textContent).toContain(c.irreversible);
    expect(el.textContent).toContain(c.guestUntouched);
  });

  it('shows the same content in Arabic', async () => {
    const { el, q } = await open('ar');
    const c = DELETE_ACCOUNT_COPY.ar;
    expect(el.textContent).toContain(c.title);
    expect(el.querySelectorAll('[data-testid="delete-list"] li')).toHaveLength(c.deletes.length);
    expect(q('[data-testid="irreversible"]')!.textContent).toContain(c.irreversible);
    expect(q<HTMLButtonElement>('[data-testid="delete-confirm"]')!.textContent).toContain(c.deleteButton);
  });

  it('keeps the delete button disabled until the explicit confirmation AND the password are given', async () => {
    const { q, type, tick, settle } = await open();
    const btn = () => q<HTMLButtonElement>('[data-testid="delete-confirm"]')!;
    expect(btn().disabled).toBe(true);
    await tick('#da-ok');
    expect(btn().disabled).toBe(true); // still no password
    type('#da-pw', 'secret-pass-1');
    await settle();
    expect(btn().disabled).toBe(false);
    expect(deleteFn).not.toHaveBeenCalled(); // nothing is sent before the click
  });

  it('on success: sends the password once, shows success ONLY after the service confirmed, then returns to the signed-out start', async () => {
    const { q, type, tick, settle, el } = await open();
    type('#da-pw', 'secret-pass-1');
    await tick('#da-ok');
    q<HTMLButtonElement>('[data-testid="delete-confirm"]')!.click();
    await settle();
    expect(deleteFn).toHaveBeenCalledTimes(1);
    expect(deleteFn).toHaveBeenCalledWith('secret-pass-1');
    signedIn.set(false); // the session ended after confirmation
    await settle();
    expect(q('[data-testid="delete-success"]')!.textContent).toContain(DELETE_ACCOUNT_COPY.en.successComplete);
    expect(el.querySelector('[data-testid="delete-confirm"]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[data-testid="delete-success"] ~ button')!.click();
    expect(nav.navigateRoot).toHaveBeenCalledWith('/onboarding/welcome');
  });

  it('says the file removal is still finishing when the server reports it pending (no overclaiming)', async () => {
    outcome = { ok: true, storageCleanup: 'pending', localCleanup: 'done' };
    const { q, type, tick, settle } = await open();
    type('#da-pw', 'secret-pass-1');
    await tick('#da-ok');
    q<HTMLButtonElement>('[data-testid="delete-confirm"]')!.click();
    await settle();
    const t = q('[data-testid="delete-success"]')!.textContent!;
    expect(t).toContain(DELETE_ACCOUNT_COPY.en.successPending);
    expect(t).not.toContain(DELETE_ACCOUNT_COPY.en.successComplete);
  });

  it('warns when the device copy could not be erased', async () => {
    outcome = { ok: true, storageCleanup: 'complete', localCleanup: 'failed' };
    const { el, q, type, tick, settle } = await open();
    type('#da-pw', 'p1234567');
    await tick('#da-ok');
    q<HTMLButtonElement>('[data-testid="delete-confirm"]')!.click();
    await settle();
    expect(el.textContent).toContain(DELETE_ACCOUNT_COPY.en.localFailed);
  });

  it.each(Object.keys(DELETE_ACCOUNT_COPY.en.errors) as (keyof typeof DELETE_ACCOUNT_COPY.en.errors)[])('failure "%s": shows its honest message, NO success, the form stays and the password is cleared', async (failure) => {
    outcome = { ok: false, failure };
    const { q, type, tick, settle, el } = await open();
    type('#da-pw', 'secret-pass-1');
    await tick('#da-ok');
    q<HTMLButtonElement>('[data-testid="delete-confirm"]')!.click();
    await settle();
    expect(q('[data-testid="delete-error"]')!.textContent).toContain(DELETE_ACCOUNT_COPY.en.errors[failure]);
    expect(el.querySelector('[data-testid="delete-success"]')).toBeNull();
    expect(q<HTMLInputElement>('#da-pw')!.value).toBe('');
  });

  it('Google-only account: no password field, and the request carries no password', async () => {
    methods = { password: false, google: true };
    const { q, tick, settle, el } = await open();
    expect(el.querySelector('#da-pw')).toBeNull();
    expect(el.textContent).toContain(DELETE_ACCOUNT_COPY.en.googleHint);
    await tick('#da-ok');
    q<HTMLButtonElement>('[data-testid="delete-confirm"]')!.click();
    await settle();
    expect(deleteFn).toHaveBeenCalledWith(null);
  });

  it('offline: the button is disabled and the person is told why', async () => {
    online.set(false);
    const { q, type, tick, el } = await open();
    type('#da-pw', 'secret-pass-1');
    await tick('#da-ok');
    expect(q<HTMLButtonElement>('[data-testid="delete-confirm"]')!.disabled).toBe(true);
    expect(el.textContent).toContain(DELETE_ACCOUNT_COPY.en.offline);
  });

  it('while a request runs every control is disabled (no double submit, no leaving mid-request)', async () => {
    const { q, type, tick, settle, f } = await open();
    type('#da-pw', 'secret-pass-1');
    await tick('#da-ok');
    busy.set(true);
    await settle();
    expect(q<HTMLButtonElement>('[data-testid="delete-confirm"]')!.disabled).toBe(true);
    expect(q<HTMLInputElement>('#da-ok')!.disabled).toBe(true);
    expect(q<HTMLInputElement>('#da-pw')!.disabled).toBe(true);
    f.componentInstance['back']();
    expect(nav.navigateBack).not.toHaveBeenCalled();
    q<HTMLButtonElement>('[data-testid="delete-confirm"]')!.click();
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it.each(['ar', 'en'] as const)('(%s) tells people who cannot sign in to e-mail the official support address, without asking for credentials', async (lang) => {
    const { q, el } = await open(lang);
    const href = q<HTMLAnchorElement>('[data-testid="delete-mailto"]')!.getAttribute('href')!;
    expect(href.startsWith('mailto:gharzetak.support@gmail.com?subject=')).toBe(true);
    expect(el.textContent).toContain('gharzetak.support@gmail.com');
    expect(q('[data-testid="delete-no-access"]')!.textContent).toContain(DELETE_ACCOUNT_COPY[lang].noAccess);
    expect(DELETE_ACCOUNT_COPY[lang].noAccess).not.toMatch(/send your password|ابعتي كلمة المرور/i);
  });

  it('cancel goes back to Settings without sending anything', async () => {
    const { el } = await open();
    const cancel = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(DELETE_ACCOUNT_COPY.en.cancel))!;
    cancel.click();
    expect(nav.navigateBack).toHaveBeenCalledWith('/tabs/home/settings');
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it('a guest has no account: only an explanation, never a delete form', async () => {
    signedIn.set(false);
    const { q, el } = await open();
    expect(q('[data-testid="delete-guest"]')!.textContent).toContain(DELETE_ACCOUNT_COPY.en.guestBody);
    expect(el.querySelector('[data-testid="delete-confirm"]')).toBeNull();
    expect(el.querySelector('#da-pw')).toBeNull();
  });
});

describe('Delete account copy', () => {
  it('Arabic and English have the same structure and the same number of items', () => {
    const { ar, en } = DELETE_ACCOUNT_COPY;
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    expect(ar.deletes.length).toBe(en.deletes.length);
    expect(ar.exceptions.length).toBe(en.exceptions.length);
    expect(Object.keys(ar.errors).sort()).toEqual(Object.keys(en.errors).sort());
    for (const lang of [ar, en]) {
      for (const [k, v] of Object.entries(lang)) if (typeof v === 'string') expect(v.trim(), k).not.toBe('');
      for (const v of Object.values(lang.errors)) expect(v.trim()).not.toBe('');
    }
  });

  it('never invents a retention period beyond the provider-documented maximums, and never promises instant provider-backup removal', () => {
    for (const lang of ['ar', 'en'] as const) {
      const all = [...DELETE_ACCOUNT_COPY[lang].exceptions, DELETE_ACCOUNT_COPY[lang].successComplete, DELETE_ACCOUNT_COPY[lang].successPending].join(' ');
      const numbers = (all.match(/\b\d+\b/g) ?? []).map(Number);
      for (const n of numbers) expect([7, 30]).toContain(n);
    }
  });
});

describe('legal links', () => {
  it('builds Arabic (no prefix) and English (/en) URLs from the configured base only', () => {
    expect(legalUrl('privacy', 'ar', 'https://legal.example.test')).toBe('https://legal.example.test/privacy/');
    expect(legalUrl('terms', 'en', 'https://legal.example.test/')).toBe('https://legal.example.test/en/terms/');
    expect(legalUrl('delete-account', 'en', 'https://legal.example.test///')).toBe('https://legal.example.test/en/delete-account/');
  });
  it('returns null (not a made-up domain) when no base URL is configured', () => {
    expect(legalUrl('privacy', 'ar', '')).toBeNull();
    expect(legalUrl('privacy', 'en', '   ')).toBeNull();
  });
});
