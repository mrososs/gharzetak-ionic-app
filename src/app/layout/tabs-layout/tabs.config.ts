import { IconName } from '../../core/data/icons';

export interface Tab {
  id: string;
  icon: IconName;
  ar: string;
  en: string;
  /** The floating primary action (Tracker). It never gets the sliding selection shape. */
  mid?: boolean;
}

/** Visual order, left→right in LTR (the flex row mirrors automatically in RTL). Routes are `/tabs/<id>`. */
export const TABS: readonly Tab[] = [
  { id: 'home', icon: 'home', ar: 'الرئيسية', en: 'Home' },
  { id: 'projects', icon: 'folder', ar: 'مشاريعي', en: 'Projects' },
  { id: 'tracker', icon: 'counter', ar: 'العداد', en: 'Tracker', mid: true },
  { id: 'learn', icon: 'book', ar: 'تعلّمي', en: 'Learn' },
  { id: 'assistant', icon: 'sparkles', ar: 'خيوطة', en: 'Khayoota' },
];

/** The tab a URL belongs to: `/tabs/projects/42?x=1` → `projects`. Unknown / non-tab URLs → `null`. */
export function tabIdFromUrl(url: string): string | null {
  const m = /^\/tabs\/([^/?#]+)/.exec(url);
  return m && TABS.some((t) => t.id === m[1]) ? m[1] : null;
}

/** Whether the full-screen creation forms (new project / add pattern) hide the bar. */
export function isBarHiddenFor(url: string): boolean {
  return /\/(projects|patterns)\/new(\?|#|$)/.test(url);
}
