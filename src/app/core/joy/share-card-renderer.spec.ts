import { describe, expect, it } from 'vitest';
import { DEFAULT_SHARE_PREFS } from './joy.models';
import { ShareSource, buildShareModel } from './share-card';
import { CARD_H, CARD_W, Ctx2D, DrawableImage, coverRect, drawShareCard, ellipsize, fitFontSize, layoutChips, wrapLines } from './share-card-renderer';

/** A canvas context that records what is drawn. Text width is a deterministic function of the font size (0.55 em per character). */
class Rec implements Ctx2D {
  font = '700 10px x';
  fillStyle: string | { addColorStop(o: number, c: string): void } = '#000';
  strokeStyle: string | { addColorStop(o: number, c: string): void } = '#000';
  lineWidth = 1;
  lineCap: 'butt' | 'round' | 'square' = 'butt';
  textAlign: 'left' | 'right' | 'center' | 'start' | 'end' = 'start';
  textBaseline: 'alphabetic' | 'middle' | 'top' | 'bottom' = 'alphabetic';
  direction: 'ltr' | 'rtl' | 'inherit' = 'inherit';
  globalAlpha = 1;
  shadowColor = '';
  shadowBlur = 0;
  shadowOffsetY = 0;
  texts: { text: string; x: number; y: number; px: number; dir: string; maxWidth?: number }[] = [];
  images: { img: unknown; args: number[] }[] = [];
  paths = 0;
  dirsSeen = new Set<string>();
  save() {}
  restore() {}
  beginPath() { this.paths++; }
  closePath() {}
  moveTo() {}
  lineTo() {}
  arcTo() {}
  arc() {}
  bezierCurveTo() {}
  fill() {}
  stroke() {}
  clip() {}
  fillRect() {}
  fillText(text: string, x: number, y: number, maxWidth?: number) {
    this.texts.push({ text, x, y, px: this.px(), dir: this.direction, maxWidth });
    this.dirsSeen.add(this.direction);
  }
  measureText(text: string) { return { width: text.length * this.px() * 0.55 }; }
  createLinearGradient() { return { addColorStop() {} }; }
  drawImage(img: unknown, ...a: number[]) { this.images.push({ img, args: a }); }
  px(): number { return Number(/(\d+)px/.exec(this.font)?.[1] ?? 10); }
}

const src = (over: Partial<ShareSource> = {}): ShareSource => ({
  kind: 'project', lang: 'en', avatarId: 'bunny', headline: 'Finished a new project! 🏆', projectName: 'Bunny', photoUrl: 'data:x', pct: null,
  detail: '42 rounds counted', timeText: '3 hours 20 minutes', pieces: { done: 3, total: 3 }, badge: null, ...over,
});
const img = (w = 1600, h = 1200): DrawableImage => ({ width: w, height: h });
const draw = (s: ShareSource, toggles = DEFAULT_SHARE_PREFS, images: Parameters<typeof drawShareCard>[2] = { photo: img(), avatar: img(160, 160), mark: img(64, 64) }) => {
  const ctx = new Rec();
  drawShareCard(ctx, buildShareModel(s, toggles), images);
  return ctx;
};
const textsOf = (c: Rec) => c.texts.map((t) => t.text);

describe('share-card renderer', () => {
  it('is a 1080 × 1350 card (4:5)', () => {
    expect(CARD_W).toBe(1080);
    expect(CARD_H).toBe(1350);
  });

  it('draws the headline, project name, detail, chips, quote and the Gharzetak brand — and nothing else', () => {
    const t = textsOf(draw(src()));
    expect(t).toEqual(expect.arrayContaining(['Bunny', '42 rounds counted', '⏱ 3 hours 20 minutes', '🧩 3/3', 'غرزتك · Gharzetak']));
    expect(t.join(' ')).toContain('Finished a new project! 🏆'); // the headline may wrap to two lines
    expect(t.join(' ')).toMatch(/a little masterpiece is born 💗/); // the quote is shrunk to fit, not cut
    expect(t.some((x) => x.endsWith('…'))).toBe(false);
    expect(t.join(' ')).not.toMatch(/https?:|www\.|qr/i); // no URL or QR: only the brand name
  });

  it('draws nothing for an item the user switched off', () => {
    const c = draw(src(), { photo: false, avatar: false, time: false, parts: false, name: false });
    expect(textsOf(c)).not.toContain('Bunny');
    expect(textsOf(c).some((x) => x.includes('3 hours'))).toBe(false);
    expect(textsOf(c).some((x) => x.includes('🧩'))).toBe(false);
    // no photo and no avatar bitmap: only the small brand mark is drawn as an image
    expect(c.images.map((i) => (i.img as DrawableImage).width)).toEqual([64]);
  });

  it('draws the photo cover-cropped, and the avatar only when its switch is on', () => {
    const on = draw(src());
    const photo = on.images.find((i) => (i.img as DrawableImage).width === 1600)!;
    expect(photo.args).toHaveLength(8); // source rect + destination rect: cropped, not stretched
    expect(on.images.some((i) => (i.img as DrawableImage).width === 160)).toBe(true);
    const noAvatar = draw(src(), { ...DEFAULT_SHARE_PREFS, avatar: false });
    expect(noAvatar.images.some((i) => (i.img as DrawableImage).width === 160)).toBe(false);
    const noPhotoLoaded = draw(src(), DEFAULT_SHARE_PREFS, { photo: null, avatar: img(160, 160), mark: img(64, 64) }); // the photo failed to load
    expect(noPhotoLoaded.images.some((i) => (i.img as DrawableImage).width === 1600)).toBe(false);
    expect(textsOf(noPhotoLoaded)).toContain('Bunny'); // the card still renders
  });

  it('works without any photo, avatar or brand mark (everything failed to load or is off)', () => {
    const c = draw(src({ photoUrl: null }), DEFAULT_SHARE_PREFS, {});
    expect(textsOf(c).join(' ')).toContain('Finished a new project! 🏆');
    expect(c.images).toHaveLength(0);
  });

  it('every text stays inside the card, whatever the content', () => {
    const long = 'اسم مشروع طويل جدًا جدًا لدمية أرنوبة صغيرة بتتعمل من خيط قطن حليبي ناعم '.repeat(4);
    const c = draw(src({ lang: 'ar', projectName: long, headline: 'عنوان طويل جدًا '.repeat(8), detail: 'تفاصيل '.repeat(30), timeText: 'ساعات '.repeat(20) }));
    for (const t of c.texts) {
      const w = t.text.length * t.px * 0.55;
      expect(t.x - 0 >= 0 && t.x <= CARD_W).toBe(true);
      expect(t.y > 0 && t.y < CARD_H).toBe(true);
      // centered text must fit inside the card's white area (60px margins) once truncated
      if (t.text !== 'غرزتك · Gharzetak') expect(w).toBeLessThanOrEqual(CARD_W - 120 + 1);
    }
  });

  it('an over-long project name is truncated with an ellipsis, never wrapped over other text', () => {
    const c = draw(src({ projectName: 'X'.repeat(400) }));
    const name = c.texts.find((t) => t.text.startsWith('XX'))!;
    expect(name.text.endsWith('…')).toBe(true);
    expect(name.text.length).toBeLessThan(400);
  });

  it('the vertical order is stable and nothing overlaps: visual → headline → name → detail → chips → quote → brand', () => {
    const c = draw(src());
    const ys = (needle: string) => c.texts.find((t) => t.text.includes(needle))!.y;
    expect(ys('Finished')).toBeLessThan(ys('Bunny'));
    expect(ys('Bunny')).toBeLessThan(ys('42 rounds'));
    expect(ys('42 rounds')).toBeLessThan(ys('3 hours'));
    expect(ys('3 hours')).toBeLessThan(ys('Gharzetak'));
    const quote = c.texts.find((t) => /Every stitch|Stitch by stitch|loving hands/.test(t.text))!;
    expect(quote.y).toBeLessThan(ys('Gharzetak'));
    expect(quote.y).toBeGreaterThan(ys('3 hours'));
  });

  it('Arabic cards are drawn right-to-left, English left-to-right; the brand is always read left-to-right', () => {
    const ar = draw(src({ lang: 'ar', headline: 'خلصت مشروع جديد! 🏆' }));
    expect(ar.texts.find((t) => t.text.includes('خلصت'))!.dir).toBe('rtl');
    expect(ar.texts.find((t) => t.text.includes('Gharzetak'))!.dir).toBe('ltr');
    const en = draw(src());
    expect(en.texts.find((t) => t.text.includes('Finished'))!.dir).toBe('ltr');
  });

  it('the progress bar and detail line appear only for a percentage card', () => {
    const noPct = draw(src({ pct: null }));
    const withPct = draw(src({ kind: 'progress', pct: 40, headline: '40% done 🧶' }));
    expect(withPct.paths).toBeGreaterThan(noPct.paths); // the extra rounded bar paths
  });

  it('an achievement card shows the badge emoji large, with no project details', () => {
    const c = draw(src({ kind: 'achievement', projectName: null, photoUrl: null, timeText: null, pieces: null, badge: { emoji: '🏆', name: 'First masterpiece' }, detail: 'Finish a whole project', headline: 'New achievement! 🏅' }));
    expect(textsOf(c)).toContain('🏆');
    const emoji = c.texts.find((t) => t.text === '🏆')!;
    expect(emoji.px).toBeGreaterThan(100);
    expect(c.texts.some((t) => t.text.includes('Bunny'))).toBe(false);
  });

  it('is deterministic: the same model and images always produce the same drawing', () => {
    const a = draw(src());
    const b = draw(src());
    expect(JSON.stringify(a.texts)).toBe(JSON.stringify(b.texts));
    expect(a.images.length).toBe(b.images.length);
  });
});

describe('layout helpers', () => {
  it('fitFontSize shrinks until the text fits, never below the minimum', () => {
    const c = new Rec();
    const px = fitFontSize(c, 'W'.repeat(30), 600, 70, 30);
    expect(px).toBeLessThan(70);
    expect(px).toBeGreaterThanOrEqual(30);
    c.font = `700 ${px}px x`;
    expect(c.measureText('W'.repeat(30)).width).toBeLessThanOrEqual(600);
    expect(fitFontSize(c, 'W'.repeat(500), 100, 70, 30)).toBe(30);
    expect(fitFontSize(c, 'ok', 600, 70, 30)).toBe(70);
  });

  it('wrapLines wraps to at most N lines and ellipsizes only what still does not fit', () => {
    const c = new Rec();
    c.font = '700 40px x';
    const lines = wrapLines(c, 'one two three four five six seven eight nine ten', 300, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
    for (const l of lines) expect(c.measureText(l).width).toBeLessThanOrEqual(300);
    expect(wrapLines(c, 'short', 300, 2)).toEqual(['short']);
    expect(wrapLines(c, 'Supercalifragilisticexpialidocious_one_long_unbreakable_word', 100, 2)[0].endsWith('…')).toBe(true);
    expect(wrapLines(c, '', 300, 2)).toEqual([]);
  });

  it('ellipsize keeps short text and shortens long text to fit', () => {
    const c = new Rec();
    c.font = '700 40px x';
    expect(ellipsize(c, 'abc', 500)).toBe('abc');
    const e = ellipsize(c, 'a'.repeat(100), 200);
    expect(e.endsWith('…')).toBe(true);
    expect(c.measureText(e).width).toBeLessThanOrEqual(200);
  });

  it('coverRect crops the longer side and never distorts', () => {
    // a wide photo into a 3:2 box: full height, cropped width
    const w = coverRect(2000, 1000, 840, 560);
    expect(w.sh).toBeCloseTo(1000, 6);
    expect(w.sw / w.sh).toBeCloseTo(840 / 560, 5);
    expect(w.sx).toBeCloseTo((2000 - w.sw) / 2, 5);
    // a tall photo: full width, cropped height
    const t = coverRect(1000, 2000, 840, 560);
    expect(t.sw).toBeCloseTo(1000, 6);
    expect(t.sh / t.sw).toBeCloseTo(560 / 840, 5);
    expect(t.sy).toBeGreaterThan(0);
    // a photo that already matches: no crop
    const same = coverRect(840, 560, 840, 560);
    expect([same.sx, same.sy, same.sw, same.sh].map((n) => Math.round(n * 1e6) / 1e6)).toEqual([0, 0, 840, 560]);
  });

  it('layoutChips centers each row, wraps when the row is full, and mirrors for right-to-left', () => {
    const c = new Rec();
    const ltr = layoutChips(c, ['⏱ 3 hours', '🧩 3/3'], 840, 34, false);
    expect(ltr[0].text).toBe('⏱ 3 hours');
    expect(ltr[0].x).toBeLessThan(ltr[1].x);
    const rtl = layoutChips(c, ['⏱ 3 hours', '🧩 3/3'], 840, 34, true);
    expect(rtl[0].text).toBe('🧩 3/3'); // the first chip sits on the reading-start (right) side
    expect(rtl[0].x).toBeLessThan(rtl[1].x);
    const left = Math.min(...ltr.map((p) => p.x));
    const right = Math.max(...ltr.map((p) => p.x + p.w));
    expect(left + right).toBeCloseTo(CARD_W, 3); // centered
    const many = layoutChips(c, Array.from({ length: 6 }, (_, i) => `chip number ${i}`), 500, 34, false);
    expect(Math.max(...many.map((p) => p.row))).toBeGreaterThan(0);
    for (const p of many) expect(p.x + p.w).toBeLessThanOrEqual(CARD_W);
  });
});
