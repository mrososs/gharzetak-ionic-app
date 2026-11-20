import type { GsTask } from './getting-started';
import type { Lang, LocalText, StepText, TourContext } from './tour.types';

/**
 * Shared words of the tour system (controls, the Getting Started card, offer pills, Settings rows). The words of each step live with
 * its definition. Egyptian colloquial Arabic, matching the rest of the app (docs/product-tour-discovery/05).
 */
export const L = {
  start: { ar: 'ابدئي الجولة', en: 'Start the tour' },
  startShort: { ar: 'ابدئي', en: 'Start' },
  next: { ar: 'التالي', en: 'Next' },
  prev: { ar: 'السابق', en: 'Back' },
  skip: { ar: 'تخطّي', en: 'Skip' },
  done: { ar: 'تمام', en: 'Done' },
  close: { ar: 'إغلاق الجولة', en: 'Close tour' },
  notNow: { ar: 'مش دلوقتي', en: 'Not now' },
  hide: { ar: 'إخفاء', en: 'Hide' },
  resume: { ar: 'كمّلي الجولة', en: 'Resume tour' },

  offerTitle: { ar: 'أهلاً بيكي في غرزتك 🧶', en: 'Welcome to Gharzetak 🧶' },
  offerBody: { ar: 'جولة سريعة تعرّفك كل حاجة فين. ٦ خطوات، أقل من دقيقة.', en: 'A quick tour of where everything is. 6 steps, under a minute.' },
  welcomeDone: { ar: 'خلصت الجولة. ابدئي بأول خطوة من القايمة 🧶', en: "That's the tour. Pick your first step from the list 🧶" },

  gsTitle: { ar: 'أول خطواتك في غرزتك', en: 'Your first steps' },
  gsDoneTitle: { ar: 'خلّصتي أول خطواتك 🧶', en: "You've finished your first steps 🧶" },
  gsDoneBody: { ar: 'القايمة دي موجودة في الإعدادات لو حبيتي ترجعيلها.', en: 'You can find this list again in Settings.' },
  gsListAria: { ar: 'أول خطواتك', en: 'Your first steps' },
  gsProgress: { ar: 'خلّصتي {n} من {total}', en: '{n} of {total} done' },
  gsDoneWord: { ar: 'تمّت', en: 'done' },

  pillFirst: { ar: 'أول مرة هنا؟ جولة {n} خطوات', en: 'New here? {n}-step tour' },
  pillResume: { ar: 'كمّلي الجولة من مكان ما وقفتي', en: 'Resume the tour where you stopped' },

  helpSection: { ar: 'الجولات والمساعدة', en: 'Tours & help' },
  helpWelcome: { ar: 'جولة التطبيق', en: 'App tour' },
  helpPatterns: { ar: 'جولة الباترونات', en: 'Patterns tour' },
  helpTracker: { ar: 'جولة العدّاد', en: 'Tracker tour' },
  helpProject: { ar: 'جولة مشروع جديد', en: 'New project tour' },
  helpParts: { ar: 'جولة قطع المشروع', en: 'Project pieces tour' },
  helpKhayoota: { ar: 'جولة خيوطة', en: 'Khayoota tour' },
  helpList: { ar: 'قايمة أول خطواتك', en: 'Getting-started list' },
  helpNeedsProject: { ar: 'اعملي مشروع الأول علشان تشوفي جولة العدّاد.', en: 'Create a project first to see the tracker tour.' },
  helpNeedsParts: { ar: 'جولة القطع بتظهر لما يكون عندك مشروع من باترون بأجزاء.', en: 'The pieces tour needs a project made from a multi-part pattern.' },
  helpUnavailable: { ar: 'الجولة مش متاحة دلوقتي. جرّبي تاني بعد لحظة.', en: 'The tour is not available right now. Try again in a moment.' },
  helpListRestored: { ar: 'القايمة رجعت في الصفحة الرئيسية.', en: 'The list is back on Home.' },
} as const satisfies Record<string, LocalText>;

export const GS_ROWS: Record<GsTask, LocalText> = {
  pattern: { ar: 'استكشفي باترون جاهز', en: 'Explore a sample pattern' },
  project: { ar: 'اعملي أول مشروع', en: 'Create your first project' },
  tracker: { ar: 'جرّبي العدّاد', en: 'Try the tracker' },
  learn: { ar: 'افتحي أول شرح', en: 'Open a tutorial' },
  khayoota: { ar: 'اسألي خيوطة سؤال', en: 'Ask Khayoota a question' },
};

export const pick = (t: LocalText, lang: Lang): string => t[lang];

export const resolveText = (t: StepText, ctx: TourContext): LocalText => (typeof t === 'function' ? t(ctx) : t);

export const fill = (template: string, vars: Record<string, string | number>): string => template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

/** The words the engine needs for its own controls, in the given language. */
export function renderLabels(lang: Lang) {
  return {
    next: pick(L.next, lang),
    prev: pick(L.prev, lang),
    done: pick(L.done, lang),
    skip: pick(L.skip, lang),
    close: pick(L.close, lang),
    progress: (n: number, total: number) => (lang === 'ar' ? `خطوة ${n} من ${total}` : `Step ${n} of ${total}`),
  };
}
