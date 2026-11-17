/**
 * Builds the whitelisted {@link ShareSource} from the app's data. Together with `buildShareModel` this is the privacy boundary of sharing:
 * every parameter type below is deliberately NARROW (a few plain fields), so the compiler itself refuses to let pattern instructions,
 * notes, e-mail addresses, account ids or tokens flow into a card, whatever object the caller happens to hold.
 */
import { AvatarId } from '../data/avatars';
import { ACHIEVEMENTS } from './achievements';
import { Bilingual } from './joy.copy';
import { ShareKind, ShareLang, ShareSource } from './share-card';

/** The only facts about a project a card may read. (`Project` satisfies this shape, but nothing else of it is ever touched.) */
export interface ShareProjectFacts {
  readonly name: string;
  readonly coverLocalUrl: string | null;
  readonly photos: readonly { readonly localUrl?: string | null }[];
  readonly workedSeconds: number;
}

export const SHARE_HEADLINE: Readonly<Record<'part' | 'allParts' | 'project' | 'achievement', Bilingual>> = {
  part: { ar: 'خلصت قطعة جديدة! 🎊', en: 'Another piece finished! 🎊' },
  allParts: { ar: 'كل القطع خلصت! 🧸', en: 'All the pieces are done! 🧸' },
  project: { ar: 'خلصت مشروع جديد! 🏆', en: 'Finished a new project! 🏆' },
  achievement: { ar: 'إنجاز جديد! 🏅', en: 'New achievement! 🏅' },
};

export const progressHeadline = (pct: number, lang: ShareLang): string => (lang === 'ar' ? `${pct}% خلصت 🧶` : `${pct}% done 🧶`);

/** The photo the user chose for the project: its cover, else its newest local photo. Remote-only photos are not used (offline-safe). */
export function photoOf(p: ShareProjectFacts): string | null {
  return p.coverLocalUrl ?? p.photos.find((x) => !!x.localUrl)?.localUrl ?? null;
}

export interface ProjectSourceArgs {
  readonly kind: Exclude<ShareKind, 'achievement'>;
  readonly lang: ShareLang;
  readonly avatarId: AvatarId;
  readonly headline: string;
  readonly project: ShareProjectFacts;
  /** The finished piece / part the card is about ("Head 1/2"), shown together with the project name. */
  readonly pieceLabel?: string | null;
  readonly pct?: number | null;
  /** Numbers only ("3 of 5 rounds"). */
  readonly detail?: string | null;
  readonly pieces?: { readonly done: number; readonly total: number } | null;
  /** Formats a number of seconds ("3 hours 20 minutes"). */
  readonly formatTime: (seconds: number) => string;
}

export function projectSource(a: ProjectSourceArgs): ShareSource {
  const name = a.project.name.trim();
  return {
    kind: a.kind,
    lang: a.lang,
    avatarId: a.avatarId,
    headline: a.headline,
    projectName: name ? (a.pieceLabel ? `${name} · ${a.pieceLabel}` : name) : null,
    photoUrl: photoOf(a.project),
    pct: a.pct ?? null,
    detail: a.detail ?? null,
    timeText: a.project.workedSeconds >= 60 ? a.formatTime(a.project.workedSeconds) : null,
    pieces: a.pieces && a.pieces.total > 1 ? a.pieces : null,
    badge: null,
  };
}

export function achievementSource(id: string, lang: ShareLang, avatarId: AvatarId): ShareSource | null {
  const def = ACHIEVEMENTS.find((x) => x.id === id);
  if (!def) return null;
  return {
    kind: 'achievement',
    lang,
    avatarId,
    headline: SHARE_HEADLINE.achievement[lang],
    projectName: null,
    photoUrl: null,
    pct: null,
    detail: def.hint[lang],
    timeText: null,
    pieces: null,
    badge: { emoji: def.emoji, name: def.name[lang] },
  };
}
