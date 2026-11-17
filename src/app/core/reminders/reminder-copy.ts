import { Bilingual } from '../joy/joy.copy';

/**
 * Notification copy. Warm and gentle; never guilt, never a countdown, never "you haven't…". Generic text is the default — the project
 * and piece names appear only when the user switched "show project name on the lock screen" on.
 */
export const REMINDER_TITLE: Bilingual = { ar: 'غرزتك 🧶', en: 'Gharzetak 🧶' };

/** Generic texts (safe on a lock screen). Used for scheduled crochet time and for the occasional gentle motivation. */
export const GENERIC_POOL: readonly Bilingual[] = [
  { ar: '🧶 غرزتك مستنياكي! نكمل الدور اللي وقفنا عنده؟', en: '🧶 Your stitches are waiting! Shall we pick up where you left off?' },
  { ar: '🌸 ربع ساعة كروشيه ممكن تعمل فرق جميل.', en: '🌸 Fifteen minutes of crochet can make a lovely difference.' },
  { ar: '💗 مشروعك مستني لمستك الحلوة.', en: '💗 Your project is waiting for your lovely touch.' },
  { ar: '☕ وقت هادي + خيط حلو = لحظة كروشيه؟', en: '☕ Quiet moment + pretty yarn = crochet time?' },
];

/** Generic versions of the contextual nudges (no names). */
export const NUDGE_GENERIC = {
  almostDone: { ar: '🐰 إنتي قريبة تخلصي حاجة حلوة! نكمل؟', en: "🐰 You're close to finishing something lovely! Shall we continue?" },
  inactive: { ar: '💗 مشروعك مستني لمسة حلوة — نكمل شوية؟', en: '💗 Your project is waiting for a lovely touch — a few stitches?' },
  photo: { ar: '📸 تحبي تصوّري تقدّمك النهاردة؟', en: '📸 Want to snap a photo of your progress today?' },
} as const satisfies Record<string, Bilingual>;

/** Detailed versions (project / piece names): only with the user's explicit "show details" opt-in. */
export const DETAIL = {
  scheduled: { ar: '🧶 {project} مستنياكي — نكمل؟', en: '🧶 {project} is waiting for you — shall we continue?' },
  almostDone: { ar: '🐰 فاضلك شوية وتخلصي {target}!', en: '🐰 Just a little more and {target} is done!' },
  inactive: { ar: '🧶 {project} وحشها شغلك — نكمل؟', en: '🧶 {project} misses you — shall we continue?' },
  photo: { ar: '📸 {project} اتقدم حلو! تصوّريه؟', en: '📸 {project} has grown — snap a progress photo?' },
} as const satisfies Record<string, Bilingual>;

/** Shown by the "Preview notification" button (always generic unless details are on, exactly like a real one). */
export const PREVIEW_NOTE: Bilingual = { ar: 'ده شكل التذكير. هيظهر كده في الوقت اللي اخترتيه.', en: 'This is how a reminder looks. It will appear like this at the time you chose.' };
