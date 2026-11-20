import type { TourDefinition } from '../tour.types';

/** Pattern library: the ready-made samples, the two kinds of pattern, and how to add one. */
export const PATTERNS_TOUR: TourDefinition = {
  id: 'patterns',
  version: 1,
  route: { match: /^\/tabs\/home\/patterns$/ },
  entry: { url: '/tabs/home/patterns', mode: 'forward' },
  offer: 'pill',
  canRun: () => true,
  steps: [
    {
      id: 'patterns.sample',
      target: 'patterns.sample-row',
      side: 'bottom',
      align: 'center',
      ifMissing: 'skip',
      title: { ar: 'جرّبي باترون جاهز', en: 'Try a ready-made pattern' },
      body: { ar: 'الباترونات اللي عليها «نموذج» جاهزة للتجربة. افتحي واحد وشوفيه دور بدور.', en: 'Patterns marked "Sample" are ready to explore. Open one and read it round by round.' },
    },
    {
      id: 'patterns.kinds',
      target: 'patterns.kind-filter',
      side: 'bottom',
      align: 'start',
      ifMissing: 'skip',
      title: { ar: 'بأجزاء ولا منفرد؟', en: 'Multi-part or standalone?' },
      body: { ar: 'الباترون المنفرد قطعة واحدة. الباترون بأجزاء فيه كذا قطعة، زي دمية ليها راس وإيدين.', en: 'A standalone pattern is one piece. A multi-part pattern has several, like a doll with a head and two arms.' },
    },
    {
      id: 'patterns.add',
      target: 'patterns.add',
      side: 'bottom',
      align: 'end',
      ifMissing: 'end',
      title: { ar: 'أضيفي باترونك', en: 'Add your own' },
      body: { ar: 'اكتبي الباترون أو الصقيه. بعد كده اعملي منه مشروع وابدئي العدّ.', en: 'Type or paste a pattern, then start a project from it and begin counting.' },
    },
  ],
};
