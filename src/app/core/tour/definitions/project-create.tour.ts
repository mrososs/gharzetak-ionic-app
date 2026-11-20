import type { TourDefinition } from '../tour.types';

/**
 * New project. The form is never touched (no focus, no typing, no keyboard) so the unsaved-changes guard cannot fire because of the
 * tour. The tab bar is hidden on this page, so no step points at it.
 */
export const PROJECT_CREATE_TOUR: TourDefinition = {
  id: 'project-create',
  version: 1,
  route: { match: /^\/tabs\/projects\/new$/ },
  entry: { url: '/tabs/projects/new', mode: 'forward' },
  offer: 'pill',
  canRun: () => true,
  steps: [
    {
      id: 'project.name',
      target: 'project-new.name',
      side: 'bottom',
      align: 'start',
      ifMissing: 'end',
      title: { ar: 'سمّي مشروعك', en: 'Name your project' },
      body: { ar: 'الاسم بس هو المطلوب. الباقي اختياري وتقدري تغيّريه بعدين.', en: 'Only the name is required. Everything else is optional and can be changed later.' },
    },
    {
      id: 'project.source',
      target: 'project-new.source',
      side: 'bottom',
      align: 'center',
      ifMissing: 'skip',
      title: { ar: 'ابدئي من باترون', en: 'Start from a pattern' },
      body: {
        ar: 'اختاري باترون محفوظ والعدّاد هيمشي عليه دور بدور، أو كمّلي من غير باترون بعدّاد بسيط. زرار الحفظ في آخر الصفحة.',
        en: 'Pick a saved pattern and the tracker follows it round by round, or go without one and use a simple counter. Save is at the bottom.',
      },
    },
  ],
};
