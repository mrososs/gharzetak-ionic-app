import type { TourDefinition } from '../tour.types';

/**
 * Pattern reader. Highlight only: linking a pattern to a project resets that project's position, and "Next round" saves the reading
 * position, so nothing here is ever tapped for the user. "Count along" has two wordings because the link row is empty without a project.
 * `hasProjects` means "has an unfinished project".
 */
export const PATTERN_READER_TOUR: TourDefinition = {
  id: 'pattern-reader',
  version: 1,
  route: { match: /^\/tabs\/home\/patterns\/(?!new$|import$)[^/]+$/ },
  entry: { url: '/tabs/home/patterns', mode: 'forward' },
  offer: 'pill',
  canRun: () => true,
  steps: [
    {
      id: 'reader.read',
      target: 'reader.focus-card',
      side: 'bottom',
      align: 'center',
      ifMissing: 'end',
      title: { ar: 'اقري دور بدور', en: 'One round at a time' },
      body: { ar: 'الكارت ده بيعرض الدور اللي إنتي فيه وشرحه بكلام بسيط. ومكانك بيتحفظ.', en: 'This card shows your current round with a plain-language explanation. Your place is saved.' },
    },
    {
      id: 'reader.move',
      target: 'reader.next-round',
      side: 'top',
      align: 'center',
      ifMissing: 'skip',
      title: { ar: 'التالي والسابق', en: 'Next and previous' },
      body: { ar: 'اتنقّلي بين الأدوار من هنا، أو اضغطي أي دور من القايمة تحت.', en: 'Move between rounds here, or tap any round in the list below.' },
    },
    {
      id: 'reader.track',
      target: 'reader.track',
      side: 'top',
      align: 'center',
      ifMissing: 'skip',
      title: (ctx) =>
        ctx.hasProjects ? { ar: 'عدّي على الباترون ده', en: 'Count along with it' } : { ar: 'عايزة تعدّي عليه؟', en: 'Want to count along?' },
      body: (ctx) =>
        ctx.hasProjects
          ? { ar: 'اربطي الباترون بمشروع من فوق، وبعدين اضغطي هنا والعدّاد يمشي معاكي دور بدور.', en: 'Link the pattern to a project above, then tap here and the tracker follows it round by round.' }
          : { ar: 'اعملي مشروع جديد واختاري الباترون ده، والعدّاد هيمشي معاكي دور بدور.', en: 'Create a new project and choose this pattern. The tracker will follow it round by round.' },
    },
  ],
};
