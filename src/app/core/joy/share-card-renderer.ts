/**
 * Draws a share card onto a canvas 2D context. Pure drawing code against a MINIMAL context interface, so the layout, the text fitting and
 * the right-to-left ordering are unit-testable without a browser canvas. All decisions about WHAT is drawn are made earlier by
 * `buildShareModel` — this file only lays out what the model contains.
 */
import { ShareCardModel } from './share-card';

export const CARD_W = 1080;
export const CARD_H = 1350;

/** Brand palette (canvas cannot read CSS variables). Values mirror src/theme/tokens.css. */
export const PALETTE = {
  bg: '#FFF9F5', pink: '#f56fa8', pink100: '#ffe3ef', pink200: '#fdc2db', lavender: '#c5a4f4', lav100: '#f1e8fd', peach: '#ffccaa',
  peach100: '#ffeadb', mint: '#a6dcc9', primary: '#813db5', text: '#35253e', text2: '#5b4866', white: '#ffffff',
} as const;

export const FONT_STACK = '"Playpen Sans Arabic Variable", "Playpen Sans Variable", "Playpen Sans Arabic", "Playpen Sans", "Noto Sans Arabic", system-ui, sans-serif';

type CanvasDir = 'ltr' | 'rtl' | 'inherit';
interface Gradient {
  addColorStop(offset: number, color: string): void;
}
/** The subset of CanvasRenderingContext2D this renderer uses. */
export interface Ctx2D {
  font: string;
  fillStyle: string | Gradient;
  strokeStyle: string | Gradient;
  lineWidth: number;
  lineCap: 'butt' | 'round' | 'square';
  textAlign: 'left' | 'right' | 'center' | 'start' | 'end';
  textBaseline: 'alphabetic' | 'middle' | 'top' | 'bottom';
  direction: CanvasDir;
  globalAlpha: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetY: number;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void;
  fill(): void;
  stroke(): void;
  clip(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { width: number };
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): Gradient;
  drawImage(img: unknown, dx: number, dy: number, dw: number, dh: number): void;
  drawImage(img: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
}

export interface CardImages {
  readonly photo?: DrawableImage | null;
  readonly avatar?: DrawableImage | null;
  readonly mark?: DrawableImage | null;
}
export interface DrawableImage {
  readonly width: number;
  readonly height: number;
}

const font = (px: number, weight = 700): string => `${weight} ${Math.round(px)}px ${FONT_STACK}`;

/** The largest font size (≤ start, ≥ min) at which `text` fits `maxWidth` on one line. */
export function fitFontSize(ctx: Ctx2D, text: string, maxWidth: number, startPx: number, minPx: number, weight = 700): number {
  let px = startPx;
  while (px > minPx) {
    ctx.font = font(px, weight);
    if (ctx.measureText(text).width <= maxWidth) return px;
    px -= 2;
  }
  return minPx;
}

/** Greedy word wrap into at most `maxLines` lines; the last line is ellipsized when the text still does not fit. Works for Arabic and Latin. */
export function wrapLines(ctx: Ctx2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i];
    if (ctx.measureText(next).width <= maxWidth || !cur) {
      cur = next;
      continue;
    }
    lines.push(cur);
    cur = words[i];
    if (lines.length === maxLines - 1) {
      cur = words.slice(i).join(' ');
      break;
    }
  }
  if (cur) lines.push(cur);
  const out = lines.slice(0, maxLines);
  const last = out.length - 1;
  if (last >= 0 && ctx.measureText(out[last]).width > maxWidth) out[last] = ellipsize(ctx, out[last], maxWidth);
  return out;
}

export function ellipsize(ctx: Ctx2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
  return s + '…';
}

/** Rounded-rectangle path built from arcTo (works in every WebView; `roundRect()` is newer). */
export function roundRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Cover-crop: the source rectangle that fills a destination of the given aspect without distorting. */
export function coverRect(srcW: number, srcH: number, dstW: number, dstH: number): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const sw = dstW / scale;
  const sh = dstH / scale;
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh };
}

/** Pill row layout: wraps to as many rows as needed and returns each pill's left edge, row by row, mirrored for right-to-left. */
export function layoutChips(ctx: Ctx2D, chips: readonly string[], maxWidth: number, px: number, rtl: boolean): { text: string; x: number; w: number; row: number }[] {
  ctx.font = font(px, 700);
  const pad = 26;
  const gap = 16;
  const sized = chips.map((t) => ({ text: ellipsize(ctx, t, maxWidth - pad * 2), w: 0 }));
  for (const c of sized) c.w = ctx.measureText(c.text).width + pad * 2;
  const rows: { text: string; w: number }[][] = [[]];
  let rowW = 0;
  for (const c of sized) {
    if (rows[rows.length - 1].length && rowW + gap + c.w > maxWidth) {
      rows.push([]);
      rowW = 0;
    }
    rows[rows.length - 1].push(c);
    rowW += (rows[rows.length - 1].length > 1 ? gap : 0) + c.w;
  }
  const placed: { text: string; x: number; w: number; row: number }[] = [];
  rows.forEach((row, ri) => {
    const total = row.reduce((a, c) => a + c.w, 0) + gap * Math.max(0, row.length - 1);
    const ordered = rtl ? [...row].reverse() : row; // the first pill sits on the reading-start side
    let x = (CARD_W - total) / 2;
    for (const c of ordered) {
      placed.push({ text: c.text, x, w: c.w, row: ri });
      x += c.w + gap;
    }
  });
  return placed;
}

/** Draws the complete card. Deterministic: the same model + images always produce the same drawing. */
export function drawShareCard(ctx: Ctx2D, m: ShareCardModel, images: CardImages = {}): void {
  // The MODEL decides what is shown: a bitmap the caller happens to have loaded is ignored when its switch is off.
  const img: CardImages = { photo: m.photoUrl ? images.photo : null, avatar: m.avatarId ? images.avatar : null, mark: images.mark };
  const dir: CanvasDir = m.rtl ? 'rtl' : 'ltr';
  ctx.direction = dir;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  drawBackground(ctx);

  // the white card
  const cx = 60;
  const cy = 70;
  const cw = CARD_W - 120;
  const ch = CARD_H - 140;
  ctx.save();
  ctx.shadowColor = 'rgba(53, 37, 62, 0.18)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = PALETTE.white;
  roundRectPath(ctx, cx, cy, cw, ch, 56);
  ctx.fill();
  ctx.restore();

  const innerW = cw - 120; // 840
  const left = (CARD_W - innerW) / 2;
  const footerY = cy + ch - 56;
  let y = cy + 56;

  // ---- 1. the visual: the user's photo, or the avatar on a soft disc ----
  const hasPhoto = !!m.photoUrl && !!img.photo;
  const hasProgress = m.pct !== null;
  const textBudget = 150 /* headline */ + (m.projectName ? 70 : 0) + (hasProgress ? 64 : 0) + (m.detail ? 60 : 0) + (m.chips.length ? 76 * Math.ceil(m.chips.length / 2) : 0) + 70 /* quote */ + 110 /* footer */;
  const visualH = Math.max(300, Math.min(540, cy + ch - y - textBudget));
  drawVisual(ctx, m, img, left, y, innerW, visualH, hasPhoto);
  y += visualH + 62;

  // ---- 2. headline (≤ 2 lines, shrinks to fit) ----
  ctx.fillStyle = PALETTE.text;
  // big enough to read, small enough that the longest single word still fits; the sentence then wraps to at most two lines
  const hPx = fitFontSize(ctx, longestWord(m.headline), innerW, 70, 44);
  ctx.font = font(hPx);
  const hLines = wrapLines(ctx, m.headline, innerW, 2);
  for (const line of hLines) {
    ctx.fillText(line, CARD_W / 2, y + hPx * 0.85, innerW);
    y += hPx * 1.18;
  }
  y += 14;

  // ---- 3. the project name (only if the user kept it on) ----
  if (m.projectName) {
    const nPx = fitFontSize(ctx, m.projectName, innerW, 46, 30);
    ctx.font = font(nPx, 700);
    ctx.fillStyle = PALETTE.primary;
    ctx.fillText(ellipsize(ctx, m.projectName, innerW), CARD_W / 2, y + nPx * 0.85, innerW);
    y += nPx * 1.35;
  }

  // ---- 4. progress bar + detail ----
  if (hasProgress) {
    const bw = 760;
    const bx = (CARD_W - bw) / 2;
    ctx.fillStyle = PALETTE.pink200;
    roundRectPath(ctx, bx, y + 10, bw, 26, 13);
    ctx.fill();
    ctx.fillStyle = PALETTE.primary;
    const frac = Math.max(0, Math.min(1, (m.pct ?? 0) / 100));
    if (frac > 0) {
      roundRectPath(ctx, m.rtl ? bx + bw - Math.max(26, bw * frac) : bx, y + 10, Math.max(26, bw * frac), 26, 13);
      ctx.fill();
    }
    y += 64;
  }
  if (m.detail) {
    ctx.font = font(38, 600);
    ctx.fillStyle = PALETTE.text2;
    ctx.fillText(ellipsize(ctx, m.detail, innerW), CARD_W / 2, y + 34, innerW);
    y += 60;
  }

  // ---- 5. chips ----
  if (m.chips.length) {
    const placed = layoutChips(ctx, m.chips, innerW, 34, m.rtl);
    for (const p of placed) {
      const py = y + p.row * 76;
      ctx.fillStyle = PALETTE.lav100;
      roundRectPath(ctx, p.x, py, p.w, 60, 30);
      ctx.fill();
      ctx.fillStyle = PALETTE.primary;
      ctx.font = font(34, 700);
      ctx.fillText(p.text, p.x + p.w / 2, py + 42, p.w - 20);
    }
    y += 76 * (Math.max(...placed.map((p) => p.row)) + 1);
  }

  // ---- 6. quote ----
  // one line: shrink the sentence to fit (an ellipsis is the last resort, not the first)
  const qPx = fitFontSize(ctx, m.quote, innerW, 38, 26, 500);
  ctx.font = font(qPx, 500);
  ctx.fillStyle = PALETTE.text2;
  const q = ellipsize(ctx, m.quote, innerW);
  ctx.globalAlpha = 0.9;
  ctx.fillText(q, CARD_W / 2, Math.min(footerY - 74, y + 54), innerW);
  ctx.globalAlpha = 1;

  // ---- 7. brand footer ----
  ctx.font = font(34, 700);
  const bw2 = ctx.measureText(m.brand).width;
  const markSize = 54;
  const total = bw2 + (img.mark ? markSize + 16 : 0);
  let bxx = (CARD_W - total) / 2;
  if (img.mark) {
    ctx.drawImage(img.mark, bxx, footerY - markSize + 8, markSize, markSize);
    bxx += markSize + 16;
  }
  ctx.fillStyle = PALETTE.primary;
  ctx.textAlign = 'left';
  ctx.direction = 'ltr'; // the brand mark is always read the same way
  ctx.fillText(m.brand, bxx, footerY, bw2 + 8);
  ctx.textAlign = 'center';
  ctx.direction = dir;
}

function longestWord(text: string): string {
  return text.split(/\s+/).reduce((a, b) => (b.length > a.length ? b : a), '');
}

function drawBackground(ctx: Ctx2D): void {
  const g = ctx.createLinearGradient(0, 0, 0, CARD_H);
  g.addColorStop(0, PALETTE.pink100);
  g.addColorStop(0.55, PALETTE.lav100);
  g.addColorStop(1, PALETTE.peach100);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  // soft yarn-ball discs
  ctx.globalAlpha = 0.5;
  for (const [x, y, r, c] of [[110, 120, 190, PALETTE.pink200], [990, 300, 150, PALETTE.lavender], [940, 1230, 220, PALETTE.peach], [90, 1160, 140, PALETTE.mint]] as const) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // a loose strand of yarn
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = PALETTE.primary;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-20, 980);
  ctx.bezierCurveTo(180, 880, 260, 1090, 470, 1010);
  ctx.bezierCurveTo(640, 950, 720, 1130, 1100, 1040);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawVisual(ctx: Ctx2D, m: ShareCardModel, img: CardImages, x: number, y: number, w: number, h: number, hasPhoto: boolean): void {
  if (hasPhoto && img.photo) {
    ctx.save();
    roundRectPath(ctx, x, y, w, h, 40);
    ctx.clip();
    const c = coverRect(img.photo.width, img.photo.height, w, h);
    ctx.drawImage(img.photo, c.sx, c.sy, c.sw, c.sh, x, y, w, h);
    ctx.restore();
    if (img.avatar) {
      // the avatar sits on the reading-start corner of the photo
      const s = 170;
      const ax = m.rtl ? x + w - s - 24 : x + 24;
      ctx.save();
      ctx.fillStyle = PALETTE.white;
      ctx.beginPath();
      ctx.arc(ax + s / 2, y + h - s / 2 - 12, s / 2 + 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.drawImage(img.avatar, ax, y + h - s - 12, s, s);
      ctx.restore();
    }
    return;
  }
  // no photo: a soft disc with the avatar, a badge, or a plain yarn ball
  const r = Math.min(w, h) / 2 - 10;
  const mx = x + w / 2;
  const my = y + h / 2;
  const g = ctx.createLinearGradient(mx - r, my - r, mx + r, my + r);
  g.addColorStop(0, PALETTE.pink100);
  g.addColorStop(1, PALETTE.lav100);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(mx, my, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PALETTE.pink200;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(mx, my, r - 18, 0, Math.PI * 2);
  ctx.stroke();
  if (m.badge) {
    ctx.font = font(r * 0.9, 700);
    ctx.fillStyle = PALETTE.text;
    ctx.fillText(m.badge.emoji, mx, my + r * 0.3, r * 1.4);
  } else if (img.avatar) {
    const s = r * 1.5;
    ctx.drawImage(img.avatar, mx - s / 2, my - s / 2, s, s);
  } else {
    drawYarnBall(ctx, mx, my, r * 0.62);
  }
}

function drawYarnBall(ctx: Ctx2D, cx: number, cy: number, r: number): void {
  ctx.fillStyle = PALETTE.lavender;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PALETTE.white;
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  for (const k of [-0.5, 0, 0.5]) {
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.85, cy + r * k);
    ctx.bezierCurveTo(cx - r * 0.3, cy + r * (k - 0.35), cx + r * 0.3, cy + r * (k + 0.35), cx + r * 0.85, cy + r * k);
    ctx.stroke();
  }
}
