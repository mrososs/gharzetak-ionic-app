/**
 * Share cards — the pure model. NO canvas, NO Angular, NO I/O.
 *
 * Privacy by construction: a card can only ever contain what is in a {@link ShareSource}, and a ShareSource is a small whitelist
 * (generic headline, the user's own project title, their chosen photo, an avatar id, progress numbers, a recorded-time text, a badge).
 * It is built from a project by the launcher and NEVER receives pattern instructions, notes, e-mail, account ids, tokens or anything
 * the user did not choose to show. The user then switches individual items on/off before anything is rendered or shared.
 */
import { AvatarId } from '../data/avatars';
import { Bilingual } from './joy.copy';
import { SharePrefs } from './joy.models';

export type ShareKind = 'milestone' | 'part' | 'progress' | 'project' | 'achievement';
export type ShareLang = 'ar' | 'en';

export interface ShareSource {
  readonly kind: ShareKind;
  readonly lang: ShareLang;
  readonly avatarId: AvatarId;
  /** A generic sentence ("Halfway there! 🎉"): never contains the project name (that is a separate, switchable item). */
  readonly headline: string;
  /** The user's own project (or piece) title. */
  readonly projectName: string | null;
  /** The photo the user took for this project (a data: / blob: URL). */
  readonly photoUrl: string | null;
  /** 0..100, shown as a progress bar. */
  readonly pct: number | null;
  /** Numbers only, e.g. "3 of 5 rounds". */
  readonly detail: string | null;
  /** e.g. "3 hours 20 minutes". */
  readonly timeText: string | null;
  readonly pieces: { readonly done: number; readonly total: number } | null;
  readonly badge: { readonly emoji: string; readonly name: string } | null;
}

export type ShareToggle = keyof SharePrefs;
export type ShareToggles = SharePrefs;

export interface ShareCardModel {
  readonly kind: ShareKind;
  readonly lang: ShareLang;
  readonly rtl: boolean;
  readonly headline: string;
  readonly projectName: string | null;
  readonly photoUrl: string | null;
  readonly avatarId: AvatarId | null;
  readonly pct: number | null;
  readonly detail: string | null;
  /** Small pills under the title (recorded time, finished pieces). */
  readonly chips: readonly string[];
  readonly badge: { readonly emoji: string; readonly name: string } | null;
  readonly quote: string;
  readonly brand: string;
}

export const BRAND = 'غرزتك · Gharzetak';

const QUOTES: readonly Bilingual[] = [
  { ar: 'غرزة ورا غرزة، تحفة بتتولد 💗', en: 'Stitch by stitch, a little masterpiece is born 💗' },
  { ar: 'كل غرزة إنجاز ✨', en: 'Every stitch counts ✨' },
  { ar: 'صُنع بإيدين بتحب 🧶', en: 'Made with loving hands 🧶' },
];
const QUOTE_FOR: Readonly<Record<ShareKind, number>> = { milestone: 1, part: 2, progress: 0, project: 0, achievement: 1 };

export const quoteFor = (kind: ShareKind, lang: ShareLang): string => QUOTES[QUOTE_FOR[kind]][lang];

/** Which switches make sense for this card (a switch for something that is not there would be confusing). */
export function applicableToggles(src: ShareSource): ShareToggle[] {
  const t: ShareToggle[] = [];
  if (src.photoUrl) t.push('photo');
  t.push('avatar');
  if (src.timeText) t.push('time');
  if (src.pieces) t.push('parts');
  if (src.projectName) t.push('name');
  return t;
}

/** The ONLY place that decides what appears on a card. */
export function buildShareModel(src: ShareSource, toggles: ShareToggles): ShareCardModel {
  const chips: string[] = [];
  if (toggles.time && src.timeText) chips.push(`⏱ ${src.timeText}`);
  if (toggles.parts && src.pieces && src.pieces.total > 1) chips.push(`🧩 ${src.pieces.done}/${src.pieces.total}`);
  return {
    kind: src.kind,
    lang: src.lang,
    rtl: src.lang === 'ar',
    headline: src.headline,
    projectName: toggles.name ? src.projectName : null,
    photoUrl: toggles.photo ? src.photoUrl : null,
    avatarId: toggles.avatar ? src.avatarId : null,
    pct: src.pct,
    detail: src.detail,
    chips,
    badge: src.badge,
    quote: quoteFor(src.kind, src.lang),
    brand: BRAND,
  };
}

/** The text that travels with the image (some apps ignore it when an image is attached — the card itself carries everything). */
export function captionFor(model: ShareCardModel): string {
  const ar = model.lang === 'ar';
  const name = model.projectName ? ` «${model.projectName}»` : '';
  switch (model.kind) {
    case 'project':
      return ar ? `خلصت مشروعي${name} بغرزتك 🧶💗` : `Just finished my project${name} with Gharzetak 🧶💗`;
    case 'part':
      return ar ? `خلصت قطعة جديدة${name} بغرزتك 🧸💗` : `Just finished another piece${name} with Gharzetak 🧸💗`;
    case 'achievement':
      return ar ? `إنجاز جديد في غرزتك: ${model.badge?.name ?? ''} 🏅` : `New achievement in Gharzetak: ${model.badge?.name ?? ''} 🏅`;
    case 'milestone':
      return ar ? `${model.headline}${name} — بغرزتك 🧶` : `${model.headline}${name} — with Gharzetak 🧶`;
    default:
      return ar ? `مشروعي${name} ماشي حلو بغرزتك 🧶💗` : `My project${name} is coming along with Gharzetak 🧶💗`;
  }
}
