import { Injectable, inject } from '@angular/core';
import { avatarSrc } from '../data/avatars';
import { isNativePlatform } from '../utils/platform';
import { CARD_H, CARD_W, Ctx2D, drawShareCard } from './share-card-renderer';
import { ShareCardModel, captionFor } from './share-card';

/** What happened when the user pressed Share. */
export type ShareOutcome =
  /** The system share sheet took the image (some apps ignore the caption — the card carries everything). */
  | 'shared'
  /** The user closed the share sheet: NOT an error, nothing is shown. */
  | 'cancelled'
  /** The image could not be shared here (no share target, or an error): the caption was shared as text instead. */
  | 'text'
  | 'failed';

/** Temporary share files older than this are deleted the next time a card is shared. */
export const TEMP_MAX_AGE_MS = 10 * 60 * 1000;
/** Above this a PNG is re-encoded as JPEG so an unusually busy photo never produces a huge file. */
export const PNG_MAX_BYTES = 2.5 * 1024 * 1024;

/** Renders a model to an image file. Everything runs on the device: nothing is uploaded anywhere. */
@Injectable({ providedIn: 'root', useFactory: () => inject(CanvasCardRenderer) })
export abstract class CardRenderer {
  abstract render(model: ShareCardModel): Promise<Blob>;
}

/** The platform bridge. The default implementation uses the official Capacitor plugins (native) or the Web Share API (browser). */
@Injectable({ providedIn: 'root', useFactory: () => inject(CapacitorShareTransport) })
export abstract class ShareTransport {
  abstract readonly native: boolean;
  /** Writes the file to the app's temporary cache and returns a URI the share sheet can read (Android FileProvider-backed cache path). */
  abstract writeTemp(blob: Blob, name: string): Promise<string>;
  abstract canShare(): Promise<boolean>;
  abstract shareFile(o: { uri: string; blob: Blob; name: string; text: string; title: string; dialogTitle: string }): Promise<void>;
  abstract shareText(o: { text: string; title: string; dialogTitle: string }): Promise<void>;
  abstract cleanup(maxAgeMs: number): Promise<void>;
}

export const isShareCancel = (e: unknown): boolean => {
  const x = e as { name?: string; message?: string } | null;
  return !!x && (x.name === 'AbortError' || /cancel/i.test(String(x.message ?? '')));
};

/**
 * Builds the card image and hands it to the OS share sheet. Sharing is only ever started by the user's own tap (the caller);
 * nothing here runs in the background and nothing leaves the device except through the share target the user picks.
 */
@Injectable({ providedIn: 'root' })
export class ShareCardService {
  private readonly renderer = inject(CardRenderer);
  private readonly transport = inject(ShareTransport);

  render(model: ShareCardModel): Promise<Blob> {
    return this.renderer.render(model);
  }

  /**
   * Image + caption through the share sheet. Fallbacks, in order: no share target / any share error → the caption as plain text.
   * A cancelled share sheet is reported as `cancelled` (never an error). Old temporary files are cleaned first.
   */
  async share(model: ShareCardModel, blob?: Blob): Promise<ShareOutcome> {
    const text = captionFor(model);
    const title = model.brand;
    const dialogTitle = model.lang === 'ar' ? 'شاركي إنجازك' : 'Share your progress';
    try {
      await this.transport.cleanup(TEMP_MAX_AGE_MS).catch(() => undefined);
      if (await this.transport.canShare()) {
        const png = blob ?? (await this.renderer.render(model));
        const name = `gz-card-${Date.now()}.${png.type === 'image/jpeg' ? 'jpg' : 'png'}`;
        const uri = await this.transport.writeTemp(png, name);
        await this.transport.shareFile({ uri, blob: png, name, text, title, dialogTitle });
        return 'shared';
      }
    } catch (e) {
      if (isShareCancel(e)) return 'cancelled';
      // anything else (rendering, file write, a share target that rejects the file) falls through to the text-only share
    }
    return this.shareText(model, 'text');
  }

  /** The caption only (no image): the always-available fallback and an explicit choice in the sheet. */
  async shareText(model: ShareCardModel, ok: ShareOutcome = 'shared'): Promise<ShareOutcome> {
    try {
      await this.transport.shareText({ text: captionFor(model), title: model.brand, dialogTitle: model.lang === 'ar' ? 'شاركي إنجازك' : 'Share your progress' });
      return ok;
    } catch (e) {
      return isShareCancel(e) ? 'cancelled' : 'failed';
    }
  }
}

/* ------------------------------------------------------------------ */
/* default implementations                                             */
/* ------------------------------------------------------------------ */

@Injectable({ providedIn: 'root' })
export class CanvasCardRenderer extends CardRenderer {
  async render(model: ShareCardModel): Promise<Blob> {
    await ensureFonts();
    const [photo, avatar, mark] = await Promise.all([
      model.photoUrl ? loadImage(model.photoUrl) : Promise.resolve(null),
      model.avatarId ? loadImage(avatarSrc(model.avatarId)) : Promise.resolve(null),
      loadImage('assets/brand/mark.svg'),
    ]);
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    try {
      drawShareCard(ctx as unknown as Ctx2D, model, { photo, avatar, mark });
      let blob = await toBlob(canvas, 'image/png');
      if (blob.size > PNG_MAX_BYTES) blob = await toBlob(canvas, 'image/jpeg', 0.9);
      return blob;
    } finally {
      canvas.width = canvas.height = 0; // release the ~5.8 MB bitmap right away
    }
  }
}

@Injectable({ providedIn: 'root' })
export class CapacitorShareTransport extends ShareTransport {
  readonly native = isNativePlatform();

  async writeTemp(blob: Blob, name: string): Promise<string> {
    if (!this.native) return URL.createObjectURL(blob);
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const res = await Filesystem.writeFile({ path: `share/${name}`, data: await blobToBase64(blob), directory: Directory.Cache, recursive: true });
    return res.uri;
  }

  async canShare(): Promise<boolean> {
    if (this.native) {
      const { Share } = await import('@capacitor/share');
      return (await Share.canShare()).value;
    }
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  }

  async shareFile(o: { uri: string; blob: Blob; name: string; text: string; title: string; dialogTitle: string }): Promise<void> {
    if (this.native) {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title: o.title, text: o.text, files: [o.uri], dialogTitle: o.dialogTitle });
      return;
    }
    const file = new File([o.blob], o.name, { type: o.blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: o.text, title: o.title });
      return;
    }
    // A browser that cannot share files: offer the image as a download instead.
    const a = document.createElement('a');
    a.href = o.uri;
    a.download = o.name;
    a.click();
  }

  async shareText(o: { text: string; title: string; dialogTitle: string }): Promise<void> {
    if (this.native) {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title: o.title, text: o.text, dialogTitle: o.dialogTitle });
      return;
    }
    if (typeof navigator.share === 'function') await navigator.share({ title: o.title, text: o.text });
    else await navigator.clipboard.writeText(o.text);
  }

  async cleanup(maxAgeMs: number): Promise<void> {
    if (!this.native) return;
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const { files } = await Filesystem.readdir({ path: 'share', directory: Directory.Cache });
      const cutoff = Date.now() - maxAgeMs;
      for (const f of files) {
        if (f.type === 'file' && (f.mtime ?? 0) < cutoff) await Filesystem.deleteFile({ path: `share/${f.name}`, directory: Directory.Cache }).catch(() => undefined);
      }
    } catch {
      /* the folder does not exist yet, or cleanup is not possible: nothing to do */
    }
  }
}

/* ---- helpers ---- */

/** Time allowed for one image before the card is drawn without it. */
export const IMAGE_TIMEOUT_MS = 5000;
/** Time allowed for encoding the finished bitmap. */
export const ENCODE_TIMEOUT_MS = 20000;

/**
 * Loads an image with onload/onerror (NOT `img.decode()`: that promise can stay pending forever when the page is not being painted,
 * e.g. a hidden or backgrounded WebView, and `drawImage` decodes synchronously anyway). A stuck, broken or empty image resolves to null,
 * so the card is simply drawn without it instead of hanging.
 */
export function loadImage(url: string, timeoutMs = IMAGE_TIMEOUT_MS): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (v: HTMLImageElement | null): void => {
      clearTimeout(timer);
      img.onload = img.onerror = null;
      resolve(v);
    };
    timer = setTimeout(() => finish(null), timeoutMs);
    img.onload = () => finish(img.naturalWidth > 0 ? img : null);
    img.onerror = () => finish(null);
    img.src = url;
  });
}

/** Makes sure the brand fonts are ready for the canvas (it never waits for them: the stack falls back to a system font). */
async function ensureFonts(): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts?.load) return;
  const loads = ['500', '600', '700'].flatMap((w) => [fonts.load(`${w} 48px "Playpen Sans Arabic Variable"`, 'غرزتك'), fonts.load(`${w} 48px "Playpen Sans Variable"`, 'Gharzetak')]);
  await Promise.race([Promise.allSettled(loads), new Promise((r) => setTimeout(r, 1500))]);
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('export timed out')), ENCODE_TIMEOUT_MS);
    canvas.toBlob(
      (b) => {
        clearTimeout(timer);
        if (b) resolve(b);
        else reject(new Error('export failed'));
      },
      type,
      quality,
    );
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
