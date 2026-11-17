/**
 * Crochet Joy copy. Warm Egyptian Arabic in the product's existing (feminine) voice, neutral phrasing where it sounds natural, and
 * full English equivalents. No guilt, no countdowns, no pressure — celebration only.
 */
export interface Bilingual {
  readonly ar: string;
  readonly en: string;
}

const AR_ORDINALS = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر'];

/** "الدور السادس" up to ten; beyond that the plain number ("الدور 11"). */
export function arOrdinal(n: number): string {
  return n >= 1 && n <= 10 ? AR_ORDINALS[n] : String(n);
}

/** Arabic count noun for rounds: دورين / 3 أدوار … 10 أدوار / 11 دور. */
export function arRounds(k: number): string {
  if (k === 2) return 'دورين';
  if (k >= 3 && k <= 10) return `${k} أدوار`;
  return `${k} دور`;
}

/** One-round messages. `{n}` = the round (an ordinal word in Arabic up to ten). */
export const ROUND_MESSAGES: readonly Bilingual[] = [
  { ar: 'شطورة يا فنانة! خلصتي الدور {n}! 🧶', en: 'Brilliant! Round {n} is done! 🧶' },
  { ar: 'غرزة ورا غرزة، تحفتك الصغيرة بتاخد شكلها 💗', en: 'Stitch by stitch, your little masterpiece is taking shape 💗' },
  { ar: 'يا جمال إيدك! دور كمان وقربنا 🌸', en: 'Lovely work! One more round and we get closer 🌸' },
  { ar: 'مش لازم تستعجلي، كل غرزة إنجاز ✨', en: 'No rush — every stitch counts ✨' },
  { ar: 'الدور {n} خلص — كمّلي على رواقة ✨', en: 'Round {n} done — keep going at your own pace ✨' },
  { ar: 'برافو! إيدك بقت خفيفة 🧶', en: 'Bravo! Your hands are flying 🧶' },
];

/** Several rounds finished quickly: one summary instead of several banners. `{r}` = "دورين / 3 أدوار …", `{k}` = the number. */
export const ROUNDS_IN_A_ROW: readonly Bilingual[] = [
  { ar: 'ما شاء الله! خلصتي {r} ورا بعض 🔥', en: '{k} rounds in a row — you are on a roll! 🔥' },
  { ar: 'إيدك مولّعة! {r} من غير ما تقفي 🧶', en: 'Your hands are on fire — {k} rounds without a pause 🧶' },
];

/** Plain confirmations used when "encouraging messages" is switched off. */
export const PLAIN_ROUND: Bilingual = { ar: '✓ الدور {n}', en: '✓ Round {n}' };
export const PLAIN_ROUNDS_IN_A_ROW: Bilingual = { ar: '✓ {r}', en: '✓ {k} rounds' };

/** Picks the next message of a pool, never the same one twice in a row. */
export function nextIndex(poolSize: number, last: number, random: () => number = Math.random): number {
  if (poolSize <= 1) return 0;
  let i = Math.floor(random() * poolSize);
  if (i === last) i = (i + 1) % poolSize;
  return i;
}
