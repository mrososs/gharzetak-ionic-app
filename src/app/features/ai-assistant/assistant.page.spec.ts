import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavController } from '@ionic/angular';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KhayootaFailure, KhayootaService } from '../../core/ai/khayoota.service';
import type { ChatReplyV1, QuotaV1, TranscriptV1 } from '../../core/ai/khayoota.types';
import { I18nService } from '../../core/i18n/i18n.service';
import { AuthService } from '../../core/auth/auth.service';
import { AppStore } from '../../core/state/app.store';
import { createProject } from '../../core/state/factories';
import { TrackerNavigator } from '../../core/services/tracker-navigator.service';
import { LocalDb } from '../../core/storage/local-db';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { ImportDraftService } from '../patterns/import-draft.service';
import { AssistantPage } from './assistant.page';

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 10));
};

const quotaOf = (chatLeft: number | null, imageLeft: number | null, resetAt: string | null = new Date(Date.now() + 5 * 3600_000 + 12 * 60_000).toISOString()): QuotaV1 =>
  chatLeft === null
    ? { unlimited: true, timezone: 'Africa/Cairo', chat: { used: 0, limit: null, remaining: null }, image: { used: 0, limit: null, remaining: null }, resetAt: null }
    : { unlimited: false, timezone: 'Africa/Cairo', chat: { used: 10 - chatLeft, limit: 10, remaining: chatLeft }, image: { used: 5 - (imageLeft ?? 5), limit: 5, remaining: imageLeft ?? 5 }, resetAt };

function fakeKhayoota(over: { ready?: boolean; needsConsent?: boolean; vision?: boolean; extract?: boolean; restricted?: boolean; quota?: QuotaV1 } = {}) {
  const ready = over.ready ?? true;
  const needsConsent = signal(over.needsConsent ?? false);
  return {
    configured: true,
    status: signal({ v: 1, enabled: true, provider: 'workers-ai', features: { chat: true, vision: !!over.vision, extract: !!over.extract }, consent: { version: 1, accepted: !needsConsent() }, limits: { chat: 10, image: 5, extract: 5 }, remaining: { chat: 10, image: 5, extract: 5 }, ...(over.quota ? { quota: over.quota } : {}), available: true, resetAt: '' }),
    hosted: signal(ready),
    needsConsent,
    ready: signal(ready && !needsConsent()),
    features: signal({ chat: true, vision: !!over.vision, extract: !!over.extract }),
    demoProvider: signal(false),
    restricted: signal(!!over.restricted),
    refreshStatus: vi.fn(async () => null),
    chat: vi.fn(),
    extract: vi.fn(),
    acceptConsent: vi.fn(async () => undefined),
    withdrawConsent: vi.fn(async () => undefined),
  };
}

type Page = {
  send(text: string): Promise<void>;
  messages(): { role: string; text: string; source?: string; actions?: unknown[]; error?: string; previewId?: string }[];
  sheet(): string | null;
  acceptConsent(): Promise<void>;
  declineConsent(): Promise<void>;
  previews(): Record<string, { counts: { rounds: number }; target: string }>;
  addDraft(pv: unknown): Promise<void>;
  answerPattern(): Promise<void>;
};

describe('Khayoota page', () => {
  let store: AppStore;
  let kh: ReturnType<typeof fakeKhayoota>;
  let nav: { navigateForward: ReturnType<typeof vi.fn>; navigateRoot: ReturnType<typeof vi.fn>; navigateBack: ReturnType<typeof vi.fn> };
  let drafts: ImportDraftService;
  let host: HTMLElement;
  let detect: () => void;

  async function setup(k = fakeKhayoota()) {
    kh = k;
    nav = { navigateForward: vi.fn(), navigateRoot: vi.fn(), navigateBack: vi.fn() };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AppStore,
        LocalDb,
        ImportDraftService,
        { provide: KhayootaService, useValue: kh },
        { provide: AuthService, useValue: { scope: signal('user:test'), signedIn: signal(true), guest: signal(false), ready: signal(true), locked: signal(false), deleting: signal(false), expire: vi.fn(async () => undefined) } },
        { provide: NavController, useValue: nav },
        { provide: TrackerNavigator, useValue: { open: vi.fn(async () => 'opened') } },
        { provide: UiFeedback, useValue: { say: vi.fn(), toast: vi.fn(), confirm: vi.fn() } },
      ],
    });
    store = TestBed.inject(AppStore);
    drafts = TestBed.inject(ImportDraftService);
    TestBed.tick();
    await store.whenScopeLoaded('user:test');
    const fixture = TestBed.createComponent(AssistantPage);
    fixture.detectChanges();
    host = fixture.nativeElement as HTMLElement;
    detect = () => fixture.detectChanges();
    return fixture.componentInstance as unknown as Page;
  }

  beforeEach(() => vi.restoreAllMocks());

  it('hosted: sends the question with the project context and calculator facts; renders the validated reply', async () => {
    const page = await setup();
    const p = createProject({ name: 'Bunny', category: 'amigurumi', hook: '3.0', yarn: 'cotton', target: 12, coverLocalUrl: null, patternId: null, totalRounds: 0 });
    await store.addProject(p);
    await store.setCurrentProject(p.id);
    const reply: ChatReplyV1 = { v: 1, lang: 'ar', text: 'هتطلّعي 24 غرزة.', actions: [{ id: 'tracker.openCurrentRound', v: 1, payload: { projectId: p.id } }], degraded: false };
    kh.chat.mockResolvedValue({ requestId: 'r', reply, usage: { remaining: { chat: 19, image: 5, extract: 3 }, resetAt: '' } });
    await page.send('يعني إيه (2sc, inc) x 6؟');
    await flush();
    const req = kh.chat.mock.calls[0][0];
    expect(req.context.project).toMatchObject({ id: p.id, name: 'Bunny' });
    expect(req.calc[0]).toMatchObject({ produced: 24, consumed: 18 });
    expect(req.images).toBeUndefined();
    const last = page.messages().at(-1)!;
    expect(last).toMatchObject({ role: 'bot', text: 'هتطلّعي 24 غرزة.', source: 'ai' });
    expect(last.actions).toHaveLength(1);
  });

  it('consent first: nothing is sent until the user agrees', async () => {
    const page = await setup(fakeKhayoota({ needsConsent: true }));
    kh.chat.mockResolvedValue({ requestId: 'r', reply: { v: 1, lang: 'ar', text: 'ok', actions: [], degraded: false }, usage: { remaining: { chat: 19, image: 5, extract: 3 }, resetAt: '' } });
    await page.send('سؤال');
    expect(page.sheet()).toBe('consent');
    expect(kh.chat).not.toHaveBeenCalled();
    kh.acceptConsent.mockImplementation(async () => {
      kh.needsConsent.set(false);
      kh.ready.set(true);
    });
    await page.acceptConsent();
    await flush();
    expect(kh.chat).toHaveBeenCalledTimes(1);
  });

  it('declining consent answers the SAME question (even one tapped from a chip) with the offline helper and sends nothing', async () => {
    const page = await setup(fakeKhayoota({ needsConsent: true }));
    await page.send('How do I know my stitch count is right?'); // chip-style: the text box is empty
    expect(page.sheet()).toBe('consent');
    await page.declineConsent();
    await flush();
    const msgs = page.messages();
    expect(msgs.at(-2)).toMatchObject({ role: 'user', text: 'How do I know my stitch count is right?' });
    expect(msgs.at(-1)).toMatchObject({ role: 'bot', source: 'offline' });
    expect(kh.chat).not.toHaveBeenCalled();
    expect(kh.acceptConsent).not.toHaveBeenCalled();
  });

  it('a failed hosted request shows a friendly error and still answers with the offline helper', async () => {
    const page = await setup();
    kh.chat.mockRejectedValue(new KhayootaFailure('ai_timeout'));
    await page.send('What is the difference between increase and decrease?');
    await flush();
    const last = page.messages().at(-1)!;
    expect(last).toMatchObject({ role: 'bot', error: 'ai_timeout', source: 'offline' });
    expect(last.text.length).toBeGreaterThan(0);
  });

  it('not hosted (offline / guest / no backend): answers with the labelled offline helper and calls nothing', async () => {
    const page = await setup(fakeKhayoota({ ready: false }));
    await page.send('How do I know my stitch count is right?');
    await flush();
    expect(kh.chat).not.toHaveBeenCalled();
    expect(page.messages().at(-1)).toMatchObject({ role: 'bot', source: 'offline' });
  });

  it('a non-tester account (access restricted) sees "coming soon", and its questions never reach hosted AI', async () => {
    const page = await setup(fakeKhayoota({ ready: false, restricted: true }));
    await page.send('خيوطة، إيه الفرق بين sc و hdc؟');
    await flush();
    expect(kh.chat).not.toHaveBeenCalled();
    expect(kh.extract).not.toHaveBeenCalled();
    expect(page.messages().at(-1)).toMatchObject({ role: 'bot', source: 'offline' });
    expect((page as unknown as { mode(): string }).mode()).toBe('soon');
    expect((page as unknown as { statusDetail(): string }).statusDetail()).toContain('مرحلة التجربة');
  });

  it('composer layout: one flexible field between two fixed round buttons; chips hide while typing; empty drafts never send', async () => {
    const page = await setup();
    const row = host.querySelector('.kh-composer')!;
    expect([...row.children].filter((c) => !c.classList.contains('gz-sr')).map((c) => c.className.split(' ')[0])).toEqual(['gz-icb', 'kh-field', 'gz-icb']);
    expect(host.querySelector('.kh-field textarea')).not.toBeNull();
    expect(host.querySelectorAll('.kh-rail .kh-chip').length).toBeGreaterThan(0);
    const send = host.querySelector<HTMLButtonElement>('.kh-composer .gz-icb.pur')!;
    expect(send.disabled).toBe(true); // empty draft
    (page as unknown as { input: { set(v: string): void } }).input.set('   ');
    detect();
    expect(send.disabled).toBe(true);
    const ta = host.querySelector('textarea')!;
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(kh.chat).not.toHaveBeenCalled();
    (page as unknown as { input: { set(v: string): void } }).input.set('long question '.repeat(30));
    detect();
    expect(host.querySelector('.kh-rail')).toBeNull(); // suggestions step aside while typing
    expect(send.disabled).toBe(false);
    const shift = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
    ta.dispatchEvent(shift);
    expect(shift.defaultPrevented).toBe(false); // Shift+Enter = new line
    expect(kh.chat).not.toHaveBeenCalled();
  });

  it('the project card collapses to one slim row (remembered) and opens again', async () => {
    localStorage.removeItem('gz.khayoota.ctxOpen');
    await setup();
    expect(host.querySelector('.kh-ctx')).not.toBeNull();
    host.querySelector<HTMLButtonElement>('.kh-ctx-close')!.click();
    detect();
    expect(host.querySelector('.kh-ctx')).toBeNull();
    const mini = host.querySelector<HTMLButtonElement>('.kh-ctx-mini')!;
    expect(mini.getAttribute('aria-expanded')).toBe('false');
    expect(localStorage.getItem('gz.khayoota.ctxOpen')).toBe('0');
    await setup(); // a new visit keeps it collapsed
    expect(host.querySelector('.kh-ctx-mini')).not.toBeNull();
    host.querySelector<HTMLButtonElement>('.kh-ctx-mini')!.click();
    detect();
    expect(host.querySelector('.kh-ctx')).not.toBeNull();
    localStorage.removeItem('gz.khayoota.ctxOpen');
  });

  it('status line reflects the real state and never says "offline" while only consent is missing', async () => {
    const cases: [ReturnType<typeof fakeKhayoota>, string][] = [
      [fakeKhayoota(), 'متصلة'],
      [fakeKhayoota({ needsConsent: true }), 'موافقتك'],
      [fakeKhayoota({ ready: false, restricted: true }), 'مرحلة التجربة'],
      [fakeKhayoota({ ready: false }), 'غير متاحة'],
    ];
    for (const [k, expected] of cases) {
      await setup(k);
      const line = host.querySelector('.kh-status')!.textContent!;
      expect(line).toContain(expected);
      expect(line).not.toContain('بدون اتصال');
    }
  });

  it('multi-image: the tray keeps order (reorder/remove), sends ONE request with all photos, and the preview knows the source photo of every line', async () => {
    const page = await setup(fakeKhayoota({ extract: true, vision: true }));
    const P = page as unknown as { tray: { set(v: unknown[]): void; (): { id: string }[] }; trayPurpose: { set(v: string): void }; moveShot(i: number, d: number): void; removeShot(id: string): void; sendDraft(): Promise<void> };
    const shot = (id: string) => ({ id, dataUrl: `data:image/jpeg;base64,${id}`, image: { mime: 'image/jpeg', data: `/9j/${id}` } });
    P.tray.set([shot('a'), shot('b'), shot('c')]);
    P.trayPurpose.set('pattern');
    P.moveShot(2, -1); // c before b
    P.removeShot('a');
    expect(P.tray().map((s) => s.id)).toEqual(['c', 'b']);
    const t: TranscriptV1 = { schema: 'gz.pattern-transcript', v: 1, sourceClass: 'written', title: 'Chick', language: 'en', terms: 'us', warnings: [], lines: [
      { page: 1, text: 'Head', kind: 'part-heading', legibility: 'clear', uncertain: [] },
      { page: 1, text: 'R1: 6 sc in MR (6)', kind: 'round', legibility: 'clear', uncertain: [] },
      { page: 2, text: 'R2: inc x 6 (12)', kind: 'round', legibility: 'clear', uncertain: [] },
    ] };
    kh.extract.mockResolvedValue({ requestId: 'r', transcript: t, usage: { remaining: { chat: 20, image: 5, extract: 2 }, resetAt: '' } });
    await P.sendDraft();
    await flush();
    expect(kh.extract).toHaveBeenCalledTimes(1);
    expect(kh.extract.mock.calls[0][0].images.map((i: { data: string }) => i.data)).toEqual(['/9j/c', '/9j/b']); // the user's order
    expect(P.tray()).toEqual([]);
    const user = page.messages().find((m) => m.role === 'user' && (m as unknown as { imgs?: string[] }).imgs)!;
    expect((user as unknown as { imgs: string[] }).imgs).toHaveLength(2);
    const msg = page.messages().at(-1)!;
    expect(msg.text).toContain('2 صور');
    const pv = page.previews()[msg.previewId!] as unknown as { images: number; parts: { rounds: { page: number | null }[] }[] };
    expect(pv.images).toBe(2);
    expect(pv.parts.flatMap((p) => p.rounds.map((r) => r.page))).toEqual([1, 2]);
  });

  it('image → pattern: preview from the deterministic parser, then the REAL editor opens with an unsaved draft', async () => {
    const page = await setup(fakeKhayoota({ extract: true, vision: true }));
    const t: TranscriptV1 = {
      schema: 'gz.pattern-transcript', v: 1, sourceClass: 'written', title: 'كرة', language: 'ar', terms: 'us', warnings: [],
      lines: [
        { page: 1, text: 'الدور ١: ٦ غرز قصيرة في الحلقة السحرية (٦)', kind: 'round', legibility: 'clear', uncertain: [] },
        { page: 1, text: 'الدور ٢: زيادة × ٦ (١٢)', kind: 'round', legibility: 'uncertain', uncertain: ['١٢'] },
      ],
    };
    kh.extract.mockResolvedValue({ requestId: 'r', transcript: t, usage: { remaining: { chat: 20, image: 5, extract: 2 }, resetAt: '' } });
    const before = store.patterns().length;
    await (page as unknown as { send(t: string, shots: unknown[], purpose: string): Promise<void> }).send('', [{ id: 's1', dataUrl: 'data:image/jpeg;base64,/9j/', image: { mime: 'image/jpeg', data: '/9j/4AAQ' } }], 'pattern');
    await flush();
    const msg = page.messages().at(-1)!;
    expect(msg.text).toContain('2');
    const pv = page.previews()[msg.previewId!];
    expect(pv.counts).toEqual({ rounds: 2, validated: 1, needsReview: 1, unsupported: 0 });
    await page.addDraft(pv);
    expect(nav.navigateForward).toHaveBeenCalledWith('/tabs/home/patterns/new');
    const d = drafts.take('pattern')!;
    expect(d.parts[0].text).toBe('R1: 6sc in MR [6]\nR2: (inc) x 6 [12]');
    expect(d.sourceText).toContain('الحلقة السحرية');
    expect(store.patterns().length).toBe(before); // nothing saved until the editor's Save
  });

  describe('daily allowance (10 messages + 5 images; one unlimited account)', () => {
    const text = () => host.querySelector('.kh-quota')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    // The language is persisted (gz.lang): pin it per test so a switch to English can never leak into the next one.
    beforeEach(() => localStorage.setItem('gz.lang', 'ar'));
    afterEach(() => localStorage.setItem('gz.lang', 'ar'));

    it('shows the SERVER numbers in Arabic and in English, and updates after a reply from the server', async () => {
      await setup(fakeKhayoota({ vision: true }));
      expect(text()).toContain('الرسائل المتبقية اليوم: 10 من 10');
      expect(text()).toContain('الصور المتبقية اليوم: 5 من 5');
      TestBed.inject(I18nService).lang.set('en');
      detect();
      expect(text()).toContain('Messages remaining today: 10 of 10');
      expect(text()).toContain('Images remaining today: 5 of 5');
      kh.status.update((st) => ({ ...st, quota: quotaOf(9, 3) }));
      detect();
      expect(text()).toContain('Messages remaining today: 9 of 10');
      expect(text()).toContain('Images remaining today: 3 of 5');
      TestBed.inject(I18nService).lang.set('ar');
    });

    it('the unlimited account sees "Unlimited usage" and never a countdown or a limit', async () => {
      await setup(fakeKhayoota({ quota: quotaOf(null, null) }));
      expect(text()).toBe('استخدام غير محدود');
      TestBed.inject(I18nService).lang.set('en');
      detect();
      expect(text()).toBe('Unlimited usage');
      expect(host.querySelector('.kh-quota-reset')).toBeNull();
      TestBed.inject(I18nService).lang.set('ar');
    });

    it('one user action = ONE idempotency key: a retry of the same message reuses it', async () => {
      const page = (await setup()) as Page & { retry(): Promise<void> };
      kh.chat.mockRejectedValueOnce(new KhayootaFailure('ai_timeout')).mockResolvedValue({ requestId: 'r', reply: { v: 1, lang: 'en', text: 'ok', actions: [], degraded: false }, usage: { remaining: { chat: 9, image: 5, extract: 5 }, resetAt: '' } });
      await page.send('How do I magic ring?');
      await flush();
      await page.retry();
      await flush();
      const keys = kh.chat.mock.calls.map((c) => c[0].clientRequestId);
      expect(keys).toHaveLength(2);
      expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
      expect(keys[1]).toBe(keys[0]);
      await page.send('A different question');
      await flush();
      expect(kh.chat.mock.calls[2][0].clientRequestId).not.toBe(keys[0]); // a new action gets a new key
    });

    it('messages used up: the server is NOT called, the reason and the reset are shown, the labelled offline helper still answers', async () => {
      const page = await setup(fakeKhayoota({ quota: quotaOf(0, 5) }));
      await page.send('What is the difference between increase and decrease?');
      await flush();
      expect(kh.chat).not.toHaveBeenCalled();
      const last = page.messages().at(-1)!;
      expect(last).toMatchObject({ role: 'bot', error: 'ai_quota_exceeded', source: 'offline' });
      const note = (page as unknown as { errorText(c: string): string }).errorText('ai_quota_exceeded');
      expect(note).toContain('خلّصتي رسائل النهارده (10)');
      expect(note).toContain('منتصف الليل بتوقيت القاهرة');
      TestBed.inject(I18nService).lang.set('en');
      expect((page as unknown as { errorText(c: string): string }).errorText('ai_quota_exceeded')).toContain("You've used all 10 messages for today");
      TestBed.inject(I18nService).lang.set('ar');
    });

    it('3 photos with 2 images left: refused BEFORE sending, the draft and the tray stay, nothing is asked of the server', async () => {
      const page = await setup(fakeKhayoota({ vision: true, extract: true, quota: quotaOf(8, 2) }));
      const P = page as unknown as { tray: { set(v: unknown[]): void; (): unknown[] }; input: { set(v: string): void; (): string }; sendDraft(): Promise<void> };
      const shot = (id: string) => ({ id, dataUrl: `data:image/jpeg;base64,${id}`, image: { mime: 'image/jpeg', data: `/9j/${id}` } });
      P.tray.set([shot('a'), shot('b'), shot('c')]);
      P.input.set('look at this');
      const say = TestBed.inject(UiFeedback).say as unknown as ReturnType<typeof vi.fn>;
      await P.sendDraft();
      await flush();
      expect(kh.chat).not.toHaveBeenCalled();
      expect(kh.extract).not.toHaveBeenCalled();
      expect(P.tray()).toHaveLength(3);
      expect(P.input()).toBe('look at this');
      expect(say).toHaveBeenCalledTimes(1);
      expect(say.mock.calls[0][0]).toContain('اخترتي 3 صور بس الباقي النهارده 2');
      expect(say.mock.calls[0][1]).toContain('You selected 3 photos but only 2 remain today');
      // two fit: the request goes out and carries both photos
      P.tray.set([shot('a'), shot('b')]);
      kh.chat.mockResolvedValue({ requestId: 'r', reply: { v: 1, lang: 'en', text: 'ok', actions: [], degraded: false }, usage: { remaining: { chat: 7, image: 0, extract: 0 }, resetAt: '' } });
      await P.sendDraft();
      await flush();
      expect(kh.chat.mock.calls[0][0].images).toHaveLength(2);
    });

    it('the tray never offers more photos than today\'s remaining images', async () => {
      const page = await setup(fakeKhayoota({ vision: true, quota: quotaOf(8, 2) }));
      expect((page as unknown as { trayCap(): number }).trayCap()).toBe(2);
      await setup(fakeKhayoota({ vision: true, quota: quotaOf(null, null) }));
      expect((TestBed.createComponent(AssistantPage).componentInstance as unknown as { trayCap(): number }).trayCap()).toBe(4);
    });

    it('a server refusal updates the displayed numbers from the server and explains it, without inventing a reply', async () => {
      const page = await setup(fakeKhayoota({ vision: true }));
      kh.chat.mockImplementation(async () => {
        kh.status.update((st) => ({ ...st, quota: quotaOf(0, 5) }));
        throw new KhayootaFailure('ai_quota_exceeded', { scope: 'user', kind: 'chat', resetAt: new Date(Date.now() + 3600_000).toISOString() });
      });
      await page.send('one more question please');
      await flush();
      const last = page.messages().at(-1)!;
      expect(last.error).toBe('ai_quota_exceeded');
      expect(last.source).toBe('offline'); // labelled: it is NOT an AI reply
      expect(text()).toContain('الرسائل المتبقية اليوم: 0 من 10');
    });
  });

});
