import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavController } from '@ionic/angular';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KhayootaFailure, KhayootaService } from '../../core/ai/khayoota.service';
import type { ChatReplyV1, TranscriptV1 } from '../../core/ai/khayoota.types';
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

function fakeKhayoota(over: { ready?: boolean; needsConsent?: boolean; vision?: boolean; extract?: boolean } = {}) {
  const ready = over.ready ?? true;
  const needsConsent = signal(over.needsConsent ?? false);
  return {
    configured: true,
    status: signal({ v: 1, enabled: true, provider: 'workers-ai', features: { chat: true, vision: !!over.vision, extract: !!over.extract }, consent: { version: 1, accepted: !needsConsent() }, limits: { chat: 20, image: 5, extract: 3 }, remaining: { chat: 20, image: 5, extract: 3 }, available: true, resetAt: '' }),
    hosted: signal(ready),
    needsConsent,
    ready: signal(ready && !needsConsent()),
    features: signal({ chat: true, vision: !!over.vision, extract: !!over.extract }),
    demoProvider: signal(false),
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
        { provide: AuthService, useValue: { scope: signal('user:test'), signedIn: signal(true), guest: signal(false) } },
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
    await (page as unknown as { send(t: string, img: unknown, purpose: string): Promise<void> }).send('', { dataUrl: 'data:image/jpeg;base64,/9j/', image: { mime: 'image/jpeg', data: '/9j/4AAQ' } }, 'pattern');
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
});
