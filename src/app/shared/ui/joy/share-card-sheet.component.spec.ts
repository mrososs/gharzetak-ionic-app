import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../core/auth/auth.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { sharePrefsOf } from '../../../core/joy/joy.models';
import { ShareCardModel, ShareSource } from '../../../core/joy/share-card';
import { CardRenderer, ShareTransport } from '../../../core/joy/share-card.service';
import { ShareLauncher } from '../../../core/joy/share-launcher.service';
import { AppStore } from '../../../core/state/app.store';
import { LocalDb } from '../../../core/storage/local-db';
import { RENDER_TIMEOUT_MS, ShareCardSheetComponent } from './share-card-sheet.component';

const source = (over: Partial<ShareSource> = {}): ShareSource => ({
  kind: 'project', lang: 'en', avatarId: 'bunny', headline: 'Finished a new project! 🏆', projectName: 'Bunny', photoUrl: 'data:image/jpeg;base64,AAAA', pct: null, detail: null,
  timeText: '2 hours', pieces: { done: 2, total: 2 }, badge: null, ...over,
});

class FakeRenderer extends CardRenderer {
  models: ShareCardModel[] = [];
  fail = false;
  async render(m: ShareCardModel): Promise<Blob> {
    this.models.push(m);
    if (this.fail) throw new Error('canvas unavailable');
    return new Blob(['png'], { type: 'image/png' });
  }
}
class FakeTransport extends ShareTransport {
  native = true;
  fileError: Error | null = null;
  canShareResult = true;
  textError: Error | null = null;
  files = 0;
  texts = 0;
  async writeTemp() { return 'file:///x.png'; }
  async canShare() { return this.canShareResult; }
  async shareFile() { this.files++; if (this.fileError) throw this.fileError; }
  async shareText() { this.texts++; if (this.textError) throw this.textError; }
  async cleanup() {}
}

describe('<gz-share-card-sheet>', () => {
  let renderer: FakeRenderer;
  let tr: FakeTransport;
  let launcher: ShareLauncher;
  let store: AppStore;
  let comp: {
    toggles(): ReturnType<typeof sharePrefsOf>;
    applicable(): string[];
    state(): string;
    previewUrl(): string | null;
    note(): string | null;
    busy(): boolean;
    toggle(t: string): void;
    share(): Promise<void>;
    shareText(): Promise<void>;
  };
  let fixture: ReturnType<typeof TestBed.createComponent<ShareCardSheetComponent>>;
  const urls = { created: 0, revoked: 0 };

  const settle = async (ms = 200) => {
    await vi.advanceTimersByTimeAsync(ms);
    fixture.detectChanges();
    TestBed.tick();
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    urls.created = urls.revoked = 0;
    URL.createObjectURL = vi.fn(() => `blob:preview-${++urls.created}`);
    URL.revokeObjectURL = vi.fn(() => void urls.revoked++);
    renderer = new FakeRenderer();
    tr = new FakeTransport();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [AppStore, ShareLauncher, LocalDb, I18nService, { provide: CardRenderer, useValue: renderer }, { provide: ShareTransport, useValue: tr }, { provide: AuthService, useValue: { scope: signal('user:a') } }],
    });
    store = TestBed.inject(AppStore);
    launcher = TestBed.inject(ShareLauncher);
    TestBed.inject(I18nService).lang.set('en');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(30);
    await store.whenScopeLoaded('user:a');
    fixture = TestBed.createComponent(ShareCardSheetComponent);
    comp = fixture.componentInstance as unknown as typeof comp;
    fixture.detectChanges();
  });

  afterEach(() => vi.useRealTimers());

  it('stays closed and draws nothing until the user opens it', async () => {
    await settle();
    expect(launcher.source()).toBeNull();
    expect(renderer.models).toHaveLength(0);
    expect(comp.state()).toBe('idle');
    expect(comp.previewUrl()).toBeNull();
  });

  it('opening draws the preview on the device once (debounced), with the user\'s saved switches', async () => {
    await store.updatePrefs({ share: { avatar: false } });
    launcher.open(source());
    fixture.detectChanges();
    TestBed.tick();
    expect(comp.state()).toBe('rendering');
    await settle();
    expect(renderer.models).toHaveLength(1);
    expect(renderer.models[0]).toMatchObject({ projectName: 'Bunny', avatarId: null }); // avatar switch was saved as off
    expect(comp.state()).toBe('ready');
    expect(comp.previewUrl()).toBe('blob:preview-1');
  });

  it('only offers switches for things on the card', async () => {
    launcher.open(source({ photoUrl: null, pieces: null }));
    fixture.detectChanges();
    TestBed.tick();
    expect(comp.applicable()).toEqual(['avatar', 'time', 'name']);
  });

  it('a switch is saved for next time and the preview is redrawn without that item; quick toggling is one redraw', async () => {
    launcher.open(source());
    fixture.detectChanges();
    TestBed.tick();
    await settle();
    expect(renderer.models).toHaveLength(1);

    comp.toggle('photo');
    await vi.advanceTimersByTimeAsync(10);
    comp.toggle('name');
    await vi.advanceTimersByTimeAsync(10);
    comp.toggle('time');
    fixture.detectChanges();
    TestBed.tick();
    await settle();
    expect(renderer.models).toHaveLength(2); // three quick toggles → a single redraw
    expect(renderer.models[1]).toMatchObject({ photoUrl: null, projectName: null, chips: ['🧩 2/2'] });
    expect(sharePrefsOf(store.prefs())).toEqual({ photo: false, avatar: true, time: false, parts: true, name: false });
    expect(urls.revoked).toBeGreaterThanOrEqual(1); // the old preview URL was released
  });

  describe('Share', () => {
    const open = async () => {
      launcher.open(source());
      fixture.detectChanges();
      TestBed.tick();
      await settle();
    };

    it('success closes the sheet', async () => {
      await open();
      await comp.share();
      expect(tr.files).toBe(1);
      expect(launcher.source()).toBeNull();
      expect(comp.note()).toBeNull();
    });

    it('a cancelled system share sheet is silent: the sheet stays open and no error is shown', async () => {
      await open();
      tr.fileError = new Error('Share canceled');
      await comp.share();
      expect(launcher.source()).not.toBeNull();
      expect(comp.note()).toBeNull();
      expect(comp.busy()).toBe(false);
    });

    it('when the image cannot be shared the text goes out and the user is told', async () => {
      await open();
      tr.canShareResult = false;
      await comp.share();
      expect(tr.texts).toBe(1);
      expect(comp.note()).toBe('text');
      expect(launcher.source()).not.toBeNull();
    });

    it('when nothing can be shared a retryable message is shown', async () => {
      await open();
      tr.canShareResult = false;
      tr.textError = new Error('no apps installed');
      await comp.share();
      expect(comp.note()).toBe('failed');
      expect(comp.busy()).toBe(false);
    });

    it('"Share text only" sends just the caption and closes', async () => {
      await open();
      await comp.shareText();
      expect(tr.texts).toBe(1);
      expect(tr.files).toBe(0);
      expect(launcher.source()).toBeNull();
    });

    it('a second press while busy is ignored', async () => {
      await open();
      const first = comp.share();
      const second = comp.share();
      await Promise.all([first, second]);
      expect(tr.files).toBe(1);
    });
  });

  it('a drawing error shows the retry/text state, and text sharing still works', async () => {
    renderer.fail = true;
    launcher.open(source());
    fixture.detectChanges();
    TestBed.tick();
    await settle();
    expect(comp.state()).toBe('error');
    expect(comp.previewUrl()).toBeNull();
    await comp.shareText();
    expect(tr.texts).toBe(1);
  });

  it('a render that never finishes ends in the "share the text instead" state — the preview never spins forever', async () => {
    renderer.render = () => new Promise<Blob>(() => undefined); // hangs
    launcher.open(source());
    fixture.detectChanges();
    TestBed.tick();
    await settle(200);
    expect(comp.state()).toBe('rendering');
    await settle(RENDER_TIMEOUT_MS + 100);
    expect(comp.state()).toBe('error');
    expect(comp.previewUrl()).toBeNull();
    await comp.shareText(); // text sharing is still available
    expect(tr.texts).toBe(1);
  });

  it('closing releases the preview image and cancels a pending redraw', async () => {
    launcher.open(source());
    fixture.detectChanges();
    TestBed.tick();
    await settle();
    expect(comp.previewUrl()).not.toBeNull();
    const created = urls.created;
    launcher.close();
    fixture.detectChanges();
    TestBed.tick();
    await settle();
    expect(comp.previewUrl()).toBeNull();
    expect(comp.state()).toBe('idle');
    expect(urls.revoked).toBeGreaterThanOrEqual(1);
    expect(urls.created).toBe(created); // nothing was drawn after closing
  });

  it('never talks to a server: no share path uses the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    launcher.open(source());
    fixture.detectChanges();
    TestBed.tick();
    await settle();
    await comp.share();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
