import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_TIMEOUT_MS, loadImage } from './share-card.service';

/** A controllable stand-in for the browser's Image. */
class FakeImage {
  static last: FakeImage | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  src = '';
  constructor() {
    FakeImage.last = this;
  }
  /** What the browser would do some time after `src` was set. */
  load(w: number) {
    this.naturalWidth = w;
    this.onload?.();
  }
  fail() {
    this.onerror?.();
  }
}

describe('loadImage — never hangs, never throws', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('Image', FakeImage);
    FakeImage.last = null;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('resolves with the image as soon as it has loaded (it does not wait for decode(), which can stay pending forever)', async () => {
    const p = loadImage('data:image/jpeg;base64,AAAA');
    expect(FakeImage.last!.src).toBe('data:image/jpeg;base64,AAAA');
    FakeImage.last!.load(1600);
    await expect(p).resolves.toBe(FakeImage.last);
  });

  it('resolves null for a broken image', async () => {
    const p = loadImage('data:broken');
    FakeImage.last!.fail();
    await expect(p).resolves.toBeNull();
  });

  it('resolves null for an image that "loads" with no size', async () => {
    const p = loadImage('data:empty');
    FakeImage.last!.load(0);
    await expect(p).resolves.toBeNull();
  });

  it('resolves null when the image never finishes, so the card is drawn without it', async () => {
    const p = loadImage('data:stuck');
    await vi.advanceTimersByTimeAsync(IMAGE_TIMEOUT_MS + 10);
    await expect(p).resolves.toBeNull();
  });

  it('settles exactly once: a late load after the timeout changes nothing and leaves no handlers behind', async () => {
    const p = loadImage('data:late', 100);
    await vi.advanceTimersByTimeAsync(150);
    expect(await p).toBeNull();
    FakeImage.last!.load(500); // too late
    expect(FakeImage.last!.onload).toBeNull();
    expect(FakeImage.last!.onerror).toBeNull();
  });
});
