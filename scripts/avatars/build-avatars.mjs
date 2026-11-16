/**
 * Gharzetak crochet avatar collection — SVG source of truth.
 *   node scripts/avatars/build-avatars.mjs        → writes public/assets/avatars/<id>.svg
 *
 * Every avatar shares one framing system (160×160, soft pastel disc, head centred at ~(80,92)),
 * one stitch-texture recipe (tiled "V" stitches + soft top-left highlight) and one face language
 * (closed happy eyes with lashes, rosy cheeks, tiny smile) so they read as a single collectible set.
 * Stable ids (persisted in profiles.avatar_id): bunny, cat, bear, sheep, flower, yarn.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'assets', 'avatars');
mkdirSync(OUT, { recursive: true });

const INK = '#5a3a2e'; // face line colour (warm brown, as in the onboarding artwork)
const BLUSH = '#f7a3c0';

/** Tiled V-stitch overlay in a darker tone of the fill. */
const stitch = (id, color, op = 0.34) =>
  `<pattern id="${id}" width="7" height="6" patternUnits="userSpaceOnUse"><path d="M1 1.4 3.5 5 6 1.4" fill="none" stroke="${color}" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"/></pattern>`;

const defs = (extra = '') =>
  `<defs><radialGradient id="hl" cx=".32" cy=".26" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient>
<radialGradient id="sh" cx=".5" cy=".5" r=".5"><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#6b3d5f" stop-opacity=".22"/></radialGradient>${extra}</defs>`;

/** A crocheted shape: flat fill + V-stitch texture + volume highlight + soft edge shade. `tag` is any SVG shape element string with a %s placeholder for attributes. */
const crochet = (shape, fill, patId) => {
  const mk = (attrs) => shape.replace('%s', attrs);
  return `${mk(`fill="${fill}"`)}${mk(`fill="url(#${patId})"`)}${mk('fill="url(#sh)"')}${mk('fill="url(#hl)"')}`;
};

const eyes = (cx, cy, s = 1) => {
  const e = (dx) =>
    `<path d="M${cx + dx - 6.5 * s} ${cy} Q${cx + dx} ${cy - 8 * s} ${cx + dx + 6.5 * s} ${cy}" fill="none" stroke="${INK}" stroke-width="${2.6 * s}" stroke-linecap="round"/>` +
    `<path d="M${cx + dx + 7.4 * s * Math.sign(dx)} ${cy - 3.2 * s} l${2.6 * s * Math.sign(dx)} ${-2.4 * s}" stroke="${INK}" stroke-width="${1.7 * s}" stroke-linecap="round"/>`;
  return e(-15 * s) + e(15 * s);
};
const cheeks = (cx, cy, s = 1) =>
  `<ellipse cx="${cx - 25 * s}" cy="${cy + 6 * s}" rx="${6.6 * s}" ry="${4.6 * s}" fill="${BLUSH}" opacity=".85"/><ellipse cx="${cx + 25 * s}" cy="${cy + 6 * s}" rx="${6.6 * s}" ry="${4.6 * s}" fill="${BLUSH}" opacity=".85"/>`;
const smile = (cx, cy, s = 1) => `<path d="M${cx - 5 * s} ${cy} Q${cx} ${cy + 5.5 * s} ${cx + 5 * s} ${cy}" fill="none" stroke="${INK}" stroke-width="${2.3 * s}" stroke-linecap="round"/>`;
const face = (cx, cy, s = 1) => eyes(cx, cy, s) + cheeks(cx, cy, s) + smile(cx, cy + 9 * s, s);

/** Five-petal crochet flower (used as a hair/ear accessory). */
const mini = (cx, cy, r, petal, mid, patId) => {
  let o = '';
  for (let i = 0; i < 5; i++) {
    const a = (i * 72 - 90) * (Math.PI / 180);
    o += crochet(`<circle cx="${(cx + Math.cos(a) * r * 1.05).toFixed(1)}" cy="${(cy + Math.sin(a) * r * 1.05).toFixed(1)}" r="${r}" %s/>`, petal, patId);
  }
  return o + crochet(`<circle cx="${cx}" cy="${cy}" r="${r * 0.82}" %s/>`, mid, patId);
};

const heart = (cx, cy, s, fill) =>
  `<path transform="translate(${cx} ${cy}) scale(${s})" d="M0 7 C-9 0 -7 -8 0 -4 C7 -8 9 0 0 7Z" fill="${fill}"/>`;

const disc = (fill, ring) => `<circle cx="80" cy="80" r="76" fill="${fill}"/><circle cx="80" cy="80" r="74.5" fill="none" stroke="${ring}" stroke-width="2" stroke-dasharray="1 5" stroke-linecap="round" opacity=".9"/>`;

const svg = (title, body, extraDefs) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160" role="img"><title>${title}</title>${defs(extraDefs)}${body}</svg>`;

const AVATARS = {
  /* ------------------------------------------------------------------ bunny: pink & cream */
  bunny: () => {
    const cream = '#fdebd3', creamD = '#c99a6a', pink = '#f8a6c4', pinkD = '#b5527f';
    return svg(
      'Crochet bunny',
      disc('#ffe3ef', '#f8b6d1') +
        // ears (behind head)
        crochet(`<ellipse cx="56" cy="46" rx="14" ry="30" transform="rotate(-9 56 46)" %s/>`, cream, 'pc') +
        crochet(`<ellipse cx="57" cy="48" rx="7.5" ry="21" transform="rotate(-9 57 48)" %s/>`, pink, 'pp') +
        crochet(`<ellipse cx="104" cy="46" rx="14" ry="30" transform="rotate(9 104 46)" %s/>`, cream, 'pc') +
        crochet(`<ellipse cx="103" cy="48" rx="7.5" ry="21" transform="rotate(9 103 48)" %s/>`, pink, 'pp') +
        // head
        crochet(`<ellipse cx="80" cy="96" rx="45" ry="39" %s/>`, cream, 'pc') +
        mini(104, 66, 6.2, pink, '#fff3dc', 'pp') +
        `<path d="M108 74 q9 2 10 11 q-9 0 -10 -11z" fill="#a9d7bf"/>` +
        face(80, 94) +
        `<path d="M76.5 101.5 q3.5 -3 7 0 q-3.5 4.5 -7 0z" fill="${pinkD}" opacity=".85"/>`,
      stitch('pc', creamD) + stitch('pp', pinkD),
    );
  },

  /* ------------------------------------------------------------------ cat: lavender & white */
  cat: () => {
    const lav = '#cbb4f0', lavD = '#7a55b0', white = '#fff7ef', whiteD = '#c9a9d6', pink = '#f8a6c4';
    return svg(
      'Crochet cat',
      disc('#f1e8fd', '#cdb4f0') +
        // ears
        crochet(`<path d="M49 76 L52 46 L76 62Z" stroke-linejoin="round" stroke-width="7" stroke="${lav}" %s/>`, lav, 'pl') +
        `<path d="M56 68 L57 53 L68 61Z" fill="${pink}" stroke="${pink}" stroke-width="3.4" stroke-linejoin="round"/>` +
        crochet(`<path d="M111 76 L108 46 L84 62Z" stroke-linejoin="round" stroke-width="7" stroke="${lav}" %s/>`, lav, 'pl') +
        `<path d="M104 68 L103 53 L92 61Z" fill="${pink}" stroke="${pink}" stroke-width="3.4" stroke-linejoin="round"/>` +
        // head
        crochet(`<ellipse cx="80" cy="96" rx="47" ry="38" %s/>`, lav, 'pl') +
        // forehead stripes
        `<g stroke="${lavD}" stroke-width="2.6" stroke-linecap="round" opacity=".55"><path d="M80 62 v10"/><path d="M69 64 l2 8"/><path d="M91 64 l-2 8"/></g>` +
        // muzzle
        crochet(`<ellipse cx="80" cy="110" rx="19" ry="13" %s/>`, white, 'pw') +
        face(80, 96) +
        `<path d="M76 104 h8 l-4 4.6z" fill="${pink}" stroke="${pink}" stroke-width="1.6" stroke-linejoin="round"/>` +
        // whiskers
        `<g stroke="${lavD}" stroke-width="1.6" stroke-linecap="round" opacity=".6"><path d="M52 104 l-12 -3"/><path d="M52 109 l-12 3"/><path d="M108 104 l12 -3"/><path d="M108 109 l12 3"/></g>`,
      stitch('pl', lavD) + stitch('pw', whiteD, 0.3),
    );
  },

  /* ------------------------------------------------------------------ bear: peach & caramel */
  bear: () => {
    const car = '#e9b27f', carD = '#9a5a2b', cream = '#fff0dc', creamD = '#c79a6c', peach = '#ffcfae', mint = '#a9d7bf';
    return svg(
      'Amigurumi bear',
      disc('#ffeadb', '#f6c2a0') +
        crochet(`<circle cx="45" cy="56" r="17" %s/>`, car, 'pb') +
        crochet(`<circle cx="45" cy="56" r="9" %s/>`, peach, 'pe') +
        crochet(`<circle cx="115" cy="56" r="17" %s/>`, car, 'pb') +
        crochet(`<circle cx="115" cy="56" r="9" %s/>`, peach, 'pe') +
        crochet(`<ellipse cx="80" cy="96" rx="46" ry="40" %s/>`, car, 'pb') +
        crochet(`<ellipse cx="80" cy="108" rx="20" ry="15" %s/>`, cream, 'pcr') +
        face(80, 94) +
        `<ellipse cx="80" cy="102.5" rx="5.6" ry="4" fill="${INK}"/><path d="M80 106 v2.6" stroke="${INK}" stroke-width="2" stroke-linecap="round"/><path d="M74.5 109 q5.5 4 5.5 0 q0 4 5.5 0" fill="none" stroke="${INK}" stroke-width="1.9" stroke-linecap="round"/>` +
        // little bow
        `<path d="M80 143 l-13 -8 q-3 6 0 12z M80 143 l13 -8 q3 6 0 12z" fill="${mint}" stroke="#6fb396" stroke-width="1.2" stroke-linejoin="round"/><circle cx="80" cy="143" r="4.2" fill="#8fcab0" stroke="#6fb396" stroke-width="1.2"/>`,
      stitch('pb', carD) + stitch('pe', '#b8693a') + stitch('pcr', creamD, 0.3),
    );
  },

  /* ------------------------------------------------------------------ sheep: cream & mint */
  sheep: () => {
    const wool = '#fff6e6', woolD = '#c9a97c', mint = '#b3e2cf', mintD = '#3f8a72', pink = '#f8a6c4';
    const bob = (x, y, r) => crochet(`<circle cx="${x}" cy="${y}" r="${r}" %s/>`, wool, 'pw');
    return svg(
      'Little yarn sheep',
      disc('#ddf3ea', '#a6dcc9') +
        // ears
        crochet(`<ellipse cx="40" cy="106" rx="15" ry="8.5" transform="rotate(28 40 106)" %s/>`, mint, 'pm') +
        crochet(`<ellipse cx="120" cy="106" rx="15" ry="8.5" transform="rotate(-28 120 106)" %s/>`, mint, 'pm') +
        // wool bobbles
        bob(42, 84, 14) + bob(118, 84, 14) + bob(46, 62, 16) + bob(114, 62, 16) + bob(62, 46, 17) + bob(98, 46, 17) + bob(80, 40, 17) +
        // face
        crochet(`<ellipse cx="80" cy="102" rx="34" ry="38" %s/>`, mint, 'pm') +
        mini(100, 52, 5.4, pink, '#fff3dc', 'pw') +
        face(80, 98, 0.95) +
        `<path d="M75.5 108 h9 l-4.5 4.4z" fill="${pink}" stroke="${pink}" stroke-width="1.4" stroke-linejoin="round"/>`,
      stitch('pw', woolD, 0.3) + stitch('pm', mintD),
    );
  },

  /* ------------------------------------------------------------------ flower: pink & yellow */
  flower: () => {
    const pet = '#f7a3c4', petD = '#b8467a', mid = '#ffe58f', midD = '#c99a2a', leaf = '#a9d7bf', leafD = '#3f8a72';
    let petals = '';
    for (let i = 0; i < 6; i++) {
      const a = (i * 60 - 90) * (Math.PI / 180);
      petals += crochet(`<circle cx="${(80 + Math.cos(a) * 40).toFixed(1)}" cy="${(84 + Math.sin(a) * 40).toFixed(1)}" r="22" %s/>`, pet, 'pp');
    }
    return svg(
      'Smiling crochet flower',
      disc('#fff3d6', '#f6d98c') +
        `<g><ellipse cx="42" cy="136" rx="14" ry="7" transform="rotate(-24 42 136)" fill="${leaf}"/><ellipse cx="118" cy="136" rx="14" ry="7" transform="rotate(24 118 136)" fill="${leaf}"/></g>` +
        petals +
        crochet(`<circle cx="80" cy="84" r="31" %s/>`, mid, 'py') +
        face(80, 82, 0.95),
      stitch('pp', petD) + stitch('py', midD, 0.3),
    );
  },

  /* ------------------------------------------------------------------ yarn: lavender ball + tiny hook */
  yarn: () => {
    const lav = '#c7a8f2', lavD = '#6f3fa3', pink = '#f8a6c4';
    const strands = [
      'M44 72 Q80 52 118 74',
      'M40 88 Q80 64 122 90',
      'M42 106 Q82 82 120 108',
      'M50 124 Q88 104 116 124',
      'M62 52 Q56 90 66 130',
      'M92 50 Q100 92 90 132',
    ]
      .map((d) => `<path d="${d}" fill="none" stroke="${lavD}" stroke-width="3.2" stroke-linecap="round" opacity=".28"/>`)
      .join('');
    return svg(
      'Happy yarn ball',
      disc('#e3f1fb', '#a9cdea') +
        `<clipPath id="ball"><circle cx="76" cy="96" r="42"/></clipPath>` +
        `<path d="M104 130 q14 4 10 14 q-4 6 -12 0" fill="none" stroke="${pink}" stroke-width="4.6" stroke-linecap="round"/>` +
        crochet(`<circle cx="76" cy="96" r="42" %s/>`, lav, 'py') +
        `<g clip-path="url(#ball)">${strands}</g>` +
        face(76, 94, 0.95) +
        // tiny crochet hook
        `<g transform="rotate(34 112 44)"><rect x="107.5" y="20" width="9" height="26" rx="4.5" fill="${pink}"/><path d="M112 46 v16" stroke="#e8b04a" stroke-width="4.2" stroke-linecap="round"/><path d="M112 63 q0 5 -4 4.4" fill="none" stroke="#e8b04a" stroke-width="3.2" stroke-linecap="round"/>${heart(112, 33, 0.58, '#fff')}</g>`,
      stitch('py', lavD, 0.2),
    );
  },
};

for (const [id, build] of Object.entries(AVATARS)) {
  const out = build().replace(/\n/g, '');
  writeFileSync(join(OUT, `${id}.svg`), out);
  console.log(id.padEnd(7), (out.length / 1024).toFixed(1) + ' KB');
}
