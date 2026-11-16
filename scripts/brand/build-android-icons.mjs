/**
 * Generates the Android launcher icons + splash from the Gharzetak brand mark (public/assets/brand/mark.svg).
 *   npm i --no-save sharp && node scripts/brand/build-android-icons.mjs
 * (set SHARP_PATH to a sharp entry file URL to use a copy outside node_modules)
 *
 * Writes into android/app/src/main/res:
 *   mipmap-<density>/ic_launcher.png, ic_launcher_round.png  (legacy, < API 26)
 *   mipmap-<density>/ic_launcher_foreground.png              (adaptive foreground; content kept inside the 66/108 dp safe zone)
 *   values/ic_launcher_background.xml                (adaptive background = brand purple)
 *   drawable<variants>/splash.png                             (cream background + centred logo tile)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sharp = (await import(process.env.SHARP_PATH ?? 'sharp')).default;
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const res = join(root, 'android', 'app', 'src', 'main', 'res');
const PURPLE = '#813DB5';
const CREAM = '#FFF9F5';

const mark = readFileSync(join(root, 'public', 'assets', 'brand', 'mark.svg'), 'utf8');
// Everything except the rounded tile: the yarn ball, stitches, hook and tail.
const art = mark.replace(/^[\s\S]*?<rect[^>]*\/>/, '').replace('</svg>', '');

/** The artwork centred on a `box`-sized canvas, `fill` = how much of the box the artwork's ~36-unit width should cover. */
const artSvg = (box, fill, background = null, round = false) => {
  const s = (box * fill) / 36; // artwork spans ≈ x 9–44 → 35–36 units
  const bg = background ? (round ? `<circle cx="${box / 2}" cy="${box / 2}" r="${box / 2}" fill="${background}"/>` : `<rect width="${box}" height="${box}" fill="${background}"/>`) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" width="${box}" height="${box}">${bg}<g transform="translate(${box / 2} ${box / 2}) scale(${s}) translate(-26.5 -24.5)">${art}</g></svg>`;
};
const png = (svg, size) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

for (const [d, size] of Object.entries(LEGACY)) {
  writeFileSync(join(res, `mipmap-${d}`, 'ic_launcher.png'), await sharp(Buffer.from(mark), { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer());
  writeFileSync(join(res, `mipmap-${d}`, 'ic_launcher_round.png'), await png(artSvg(108, 0.62, PURPLE, true), size));
}
// Adaptive foreground: 108 dp canvas, content ≤ ~58 % wide so launcher masks (circle/squircle/teardrop) never clip it.
for (const [d, size] of Object.entries(FOREGROUND)) writeFileSync(join(res, `mipmap-${d}`, 'ic_launcher_foreground.png'), await png(artSvg(108, 0.56), size));
writeFileSync(join(res, 'values', 'ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${PURPLE}</color>\n</resources>\n`);

const SPLASH = {
  drawable: [480, 320], 'drawable-land-mdpi': [480, 320], 'drawable-land-hdpi': [800, 480], 'drawable-land-xhdpi': [1280, 720], 'drawable-land-xxhdpi': [1600, 960], 'drawable-land-xxxhdpi': [1920, 1280],
  'drawable-port-mdpi': [320, 480], 'drawable-port-hdpi': [480, 800], 'drawable-port-xhdpi': [720, 1280], 'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920],
};
for (const [dir, [w, h]] of Object.entries(SPLASH)) {
  const tile = Math.round(Math.min(w, h) * 0.3);
  const logo = await sharp(Buffer.from(mark), { density: 384 }).resize(tile, tile).png().toBuffer();
  writeFileSync(join(res, dir, 'splash.png'), await sharp({ create: { width: w, height: h, channels: 4, background: CREAM } }).composite([{ input: logo, gravity: 'center' }]).png({ compressionLevel: 9 }).toBuffer());
}
console.log('icons + splash written to', res);
