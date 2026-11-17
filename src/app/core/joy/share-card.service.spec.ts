import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SHARE_PREFS } from './joy.models';
import { ShareSource, buildShareModel, captionFor } from './share-card';
import { CardRenderer, PNG_MAX_BYTES, ShareCardService, ShareTransport, TEMP_MAX_AGE_MS, isShareCancel } from './share-card.service';

const src = (over: Partial<ShareSource> = {}): ShareSource => ({
  kind: 'project', lang: 'en', avatarId: 'bunny', headline: 'Finished a new project! 🏆', projectName: 'Bunny', photoUrl: null, pct: null, detail: null, timeText: null, pieces: null, badge: null, ...over,
});
const model = (over: Partial<ShareSource> = {}) => buildShareModel(src(over), DEFAULT_SHARE_PREFS);

class FakeRenderer extends CardRenderer {
  rendered: unknown[] = [];
  fail: Error | null = null;
  blob = new Blob(['png'], { type: 'image/png' });
  async render(m: unknown): Promise<Blob> {
    this.rendered.push(m);
    if (this.fail) throw this.fail;
    return this.blob;
  }
}

class FakeTransport extends ShareTransport {
  native = true;
  log: string[] = [];
  canShareResult: boolean | Error = true;
  writeError: Error | null = null;
  fileError: Error | null = null;
  textError: Error | null = null;
  cleanupError: Error | null = null;
  shared: { uri: string; text: string; name: string; title: string; dialogTitle: string }[] = [];
  texts: { text: string }[] = [];
  async writeTemp(_b: Blob, name: string) {
    this.log.push('write:' + name);
    if (this.writeError) throw this.writeError;
    return 'file:///cache/share/' + name;
  }
  async canShare() {
    this.log.push('canShare');
    if (this.canShareResult instanceof Error) throw this.canShareResult;
    return this.canShareResult;
  }
  async shareFile(o: { uri: string; blob: Blob; name: string; text: string; title: string; dialogTitle: string }) {
    this.log.push('shareFile');
    if (this.fileError) throw this.fileError;
    this.shared.push(o);
  }
  async shareText(o: { text: string }) {
    this.log.push('shareText');
    if (this.textError) throw this.textError;
    this.texts.push(o);
  }
  async cleanup(maxAge: number) {
    this.log.push('cleanup:' + maxAge);
    if (this.cleanupError) throw this.cleanupError;
  }
}

describe('ShareCardService', () => {
  let svc: ShareCardService;
  let renderer: FakeRenderer;
  let tr: FakeTransport;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    renderer = new FakeRenderer();
    tr = new FakeTransport();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: CardRenderer, useValue: renderer }, { provide: ShareTransport, useValue: tr }] });
    svc = TestBed.inject(ShareCardService);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('cleans old temporary files FIRST, writes the card, then opens the system share sheet with the image and the caption', async () => {
    const m = model();
    expect(await svc.share(m)).toBe('shared');
    expect(tr.log[0]).toBe('cleanup:' + TEMP_MAX_AGE_MS);
    expect(tr.log.slice(1, 4)).toEqual(['canShare', expect.stringMatching(/^write:gz-card-\d+\.png$/), 'shareFile']);
    const s = tr.shared[0];
    expect(s.uri).toMatch(/^file:\/\/\/cache\/share\/gz-card-\d+\.png$/);
    expect(s.text).toBe(captionFor(m));
    expect(s.title).toBe('غرزتك · Gharzetak');
    expect(s.dialogTitle).toBe('Share your progress');
  });

  it('reuses the image the preview already drew (no second render) and renders when none was given', async () => {
    const preview = new Blob(['preview'], { type: 'image/png' });
    await svc.share(model(), preview);
    expect(renderer.rendered).toHaveLength(0);
    await svc.share(model());
    expect(renderer.rendered).toHaveLength(1);
  });

  it('a cancelled share sheet is NOT an error and does NOT fall back to text', async () => {
    tr.fileError = new Error('Share canceled');
    expect(await svc.share(model())).toBe('cancelled');
    expect(tr.texts).toHaveLength(0);
    expect(tr.log).not.toContain('shareText');
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    tr.fileError = abort;
    expect(await svc.share(model())).toBe('cancelled');
  });

  it('with no share target the caption is shared as text instead', async () => {
    tr.canShareResult = false;
    expect(await svc.share(model())).toBe('text');
    expect(tr.texts[0].text).toBe(captionFor(model()));
    expect(tr.log).not.toContain('shareFile');
    expect(renderer.rendered).toHaveLength(0); // no point drawing an image nobody can receive
  });

  it.each([
    ['the file cannot be written', (t: FakeTransport) => void (t.writeError = new Error('disk full'))],
    ['the share target rejects the file', (t: FakeTransport) => void (t.fileError = new Error('target refused'))],
    ['the capability check fails', (t: FakeTransport) => void (t.canShareResult = new Error('plugin missing'))],
  ])('falls back to text when %s', async (_n, setup) => {
    setup(tr);
    expect(await svc.share(model())).toBe('text');
    expect(tr.texts).toHaveLength(1);
  });

  it('falls back to text when the image cannot be drawn', async () => {
    renderer.fail = new Error('canvas unavailable');
    expect(await svc.share(model())).toBe('text');
    expect(tr.texts).toHaveLength(1);
  });

  it('reports `failed` only when even the text cannot be shared, and `cancelled` if the user backs out of that sheet', async () => {
    tr.canShareResult = false;
    tr.textError = new Error('no apps');
    expect(await svc.share(model())).toBe('failed');
    tr.textError = new Error('User cancelled');
    expect(await svc.share(model())).toBe('cancelled');
  });

  it('a failing cleanup never blocks sharing', async () => {
    tr.cleanupError = new Error('no folder yet');
    expect(await svc.share(model())).toBe('shared');
  });

  it('"Share text only" sends just the caption (no image is drawn or written)', async () => {
    expect(await svc.shareText(model())).toBe('shared');
    expect(tr.log).toEqual(['shareText']);
    expect(renderer.rendered).toHaveLength(0);
  });

  it('works without a project photo, and in Arabic', async () => {
    const m = buildShareModel(src({ lang: 'ar', photoUrl: null }), DEFAULT_SHARE_PREFS);
    expect(await svc.share(m)).toBe('shared');
    expect(tr.shared[0].dialogTitle).toBe('شاركي إنجازك');
    expect(tr.shared[0].text).toContain('غرزتك');
  });

  it('names a re-encoded (JPEG) card with the right extension', async () => {
    renderer.blob = new Blob(['jpg'], { type: 'image/jpeg' });
    await svc.share(model());
    expect(tr.shared[0].name).toMatch(/\.jpg$/);
    expect(PNG_MAX_BYTES).toBeGreaterThan(1_000_000);
  });

  it('is fully offline: sharing never makes a network request', async () => {
    await svc.share(model());
    await svc.shareText(model());
    tr.canShareResult = false;
    await svc.share(model());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('recognises cancellation messages from the plugins and the browser', () => {
    expect(isShareCancel(new Error('Share canceled'))).toBe(true);
    expect(isShareCancel(new Error('User cancelled the operation'))).toBe(true);
    expect(isShareCancel({ name: 'AbortError' })).toBe(true);
    expect(isShareCancel(new Error('disk full'))).toBe(false);
    expect(isShareCancel(null)).toBe(false);
  });
});
