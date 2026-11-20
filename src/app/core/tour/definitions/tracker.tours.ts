import type { TourDefinition } from '../tour.types';

const TRACKER_ROUTE = { match: /^\/tabs\/tracker$/ };
const TRACKER_ENTRY = { url: '/tabs/tracker', mode: 'root' } as const;

/**
 * Simple-counter tracker. Step 2 is the one invited, optional tap: the real button stays live, one tap counts once and advances once,
 * and Next works without it. The tour never taps for the user and never fakes a counting event.
 */
export const TRACKER_SIMPLE_TOUR: TourDefinition = {
  id: 'tracker-simple',
  version: 1,
  route: TRACKER_ROUTE,
  entry: TRACKER_ENTRY,
  offer: 'pill',
  canRun: (ctx) => ctx.trackerLayout === 'simple' || ctx.trackerLayout === 'parts-simple',
  steps: [
    {
      id: 'tracker.read',
      target: 'tracker.ring',
      side: 'bottom',
      align: 'center',
      ifMissing: 'end',
      title: { ar: 'إنتي فين دلوقتي', en: 'Where you are' },
      body: { ar: 'الرقم الكبير هو غرزك في الدور ده، وتحته العدد المطلوب.', en: "The big number is your stitches this round, with the round's target under it." },
    },
    {
      id: 'tracker.tap',
      target: 'tracker.tap',
      side: 'top',
      align: 'center',
      interaction: 'action',
      ifMissing: 'end',
      title: { ar: 'اضغطي مع كل غرزة', en: 'Tap as you stitch' },
      body: { ar: 'كل ضغطة بتزوّد العدّ وبتتحفظ في ساعتها.', en: 'Each tap adds to the count and is saved right away.' },
      hint: { ar: 'جرّبي: اضغطي الزرار مرة', en: 'Try it: tap the button once' },
    },
    {
      id: 'tracker.undo',
      target: 'tracker.undo',
      side: 'top',
      align: 'end',
      ifMissing: 'skip',
      title: { ar: 'غلطتي؟ تراجعي', en: 'Miscounted? Undo' },
      body: { ar: 'زرار التراجع بيرجّع آخر ضغطة، واحدة واحدة.', en: 'Undo takes back your last tap, one at a time.' },
    },
    {
      id: 'tracker.resume',
      target: 'tracker.project-picker',
      side: 'bottom',
      align: 'start',
      ifMissing: 'skip',
      title: { ar: 'كمّلي بعدين', en: 'Pick it up later' },
      body: { ar: 'تقدّمك محفوظ. ارجعي للعدّاد في أي وقت، وبدّلي المشروع من هنا.', en: 'Your progress is saved. Come back any time, and switch projects from here.' },
    },
  ],
};

/** Pattern-mode tracker. Every step is a highlight: a single tap can complete a whole round and unlock an achievement. */
export const TRACKER_PATTERN_TOUR: TourDefinition = {
  id: 'tracker-pattern',
  version: 1,
  route: TRACKER_ROUTE,
  entry: TRACKER_ENTRY,
  offer: 'pill',
  canRun: (ctx) => ctx.trackerLayout === 'pattern' || ctx.trackerLayout === 'parts-pattern',
  steps: [
    {
      id: 'tracker.rounds',
      target: 'tracker.round-pills',
      side: 'bottom',
      align: 'center',
      ifMissing: 'end',
      title: { ar: 'أدوار الباترون', en: 'Pattern rounds' },
      body: { ar: 'الدور المميّز هو اللي إنتي فيه. اضغطي أي دور لو عايزة تروحيله.', en: "The highlighted round is the one you're on. Tap any round to jump to it." },
    },
    {
      id: 'tracker.instruction',
      target: 'tracker.instruction',
      side: 'bottom',
      align: 'center',
      ifMissing: 'end',
      title: { ar: 'تعليمات الدور', en: "This round's instructions" },
      body: { ar: 'هنا غرز الدور مكتوبة، وجنبها علامة بتقول لو العدد مظبوط.', en: "The round's stitches are written here, with a check that the count adds up." },
    },
    {
      id: 'tracker.step',
      target: 'tracker.current-step',
      side: 'top',
      align: 'center',
      ifMissing: 'skip',
      title: { ar: 'الخطوة الحالية', en: 'Current step' },
      body: { ar: 'بتعرّفك إنتي عند أنهي غرزة في الدور، وإيه اللي بعدها.', en: "Shows which stitch of the round you're on, and what comes next." },
    },
    {
      id: 'tracker.countby',
      target: 'tracker.count-by',
      side: 'top',
      align: 'center',
      ifMissing: 'skip',
      title: { ar: 'عدّي بطريقتك', en: 'Count your way' },
      body: { ar: 'اختاري الضغطة تحسب غرزة، مجموعة، أو الدور كله.', en: 'Choose whether one tap counts a stitch, a group, or the whole round.' },
    },
    {
      id: 'tracker.count',
      target: 'tracker.tap-row',
      side: 'top',
      align: 'center',
      ifMissing: 'end',
      title: { ar: 'اضغطي وكمّلي', en: 'Tap to count' },
      body: { ar: 'الزرار الكبير بيعدّ، واللي جنبه بيتراجع عن آخر ضغطة. كل حاجة بتتحفظ لوحدها.', en: 'The big button counts, and the one beside it undoes the last tap. Everything saves by itself.' },
    },
  ],
};

/** Multi-part project: the piece switcher and the whole-project line. Never switches a piece for the user. */
export const TRACKER_PARTS_TOUR: TourDefinition = {
  id: 'tracker-parts',
  version: 1,
  route: TRACKER_ROUTE,
  entry: TRACKER_ENTRY,
  offer: 'pill',
  canRun: (ctx) => ctx.trackerLayout === 'parts-simple' || ctx.trackerLayout === 'parts-pattern',
  steps: [
    {
      id: 'tracker.pieces',
      target: 'tracker.piece-tabs',
      side: 'bottom',
      align: 'center',
      ifMissing: 'end',
      title: { ar: 'قطع المشروع', en: 'Project pieces' },
      body: { ar: 'كل قطعة ليها عدّاد لوحدها. «الإيد 1/2» يعني أول إيد من اتنين.', en: 'Each piece has its own counter. "Arm 1/2" means the first of two arms.' },
    },
    {
      id: 'tracker.whole',
      target: 'tracker.completion',
      side: 'bottom',
      align: 'center',
      ifMissing: 'skip',
      title: { ar: 'تقدّم المشروع كله', en: 'Whole-project progress' },
      body: { ar: 'هنا بتشوفي خلصتي كام قطعة من المشروع.', en: "See how many pieces of the project you've finished." },
    },
  ],
};
