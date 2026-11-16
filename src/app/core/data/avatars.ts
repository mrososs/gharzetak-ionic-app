/**
 * Bundled crochet avatar presets. Only these stable ids are ever persisted or synced (never paths/URLs);
 * the artwork is a static app asset built by scripts/avatars/build-avatars.mjs.
 * Keep AVATAR_IDS in sync with apps/api/src/validators.ts (AVATAR_IDS) and the profiles_avatar_id CHECK.
 */
export const AVATAR_IDS = ['bunny', 'cat', 'bear', 'sheep', 'flower', 'yarn'] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];

/** Shown when the user has not chosen one (guests, existing accounts, skipped selection). */
export const DEFAULT_AVATAR: AvatarId = 'bunny';

export interface AvatarInfo {
  readonly id: AvatarId;
  readonly ar: string;
  readonly en: string;
  /** Soft backdrop colour, used behind the preview. */
  readonly tint: string;
}

export const AVATARS: Readonly<Record<AvatarId, AvatarInfo>> = {
  bunny: { id: 'bunny', ar: 'أرنوبة الكروشيه', en: 'Crochet Bunny', tint: '#ffe3ef' },
  cat: { id: 'cat', ar: 'قطقوطة اللافندر', en: 'Lavender Kitty', tint: '#f1e8fd' },
  bear: { id: 'bear', ar: 'دبدوبة الأميجورومي', en: 'Amigurumi Bear', tint: '#ffeadb' },
  sheep: { id: 'sheep', ar: 'خروفة الصوف', en: 'Little Yarn Sheep', tint: '#ddf3ea' },
  flower: { id: 'flower', ar: 'وردة مبتسمة', en: 'Smiling Flower', tint: '#fff3d6' },
  yarn: { id: 'yarn', ar: 'كرة الخيط السعيدة', en: 'Happy Yarn Ball', tint: '#e3f1fb' },
};

export const isAvatarId = (v: unknown): v is AvatarId => typeof v === 'string' && (AVATAR_IDS as readonly string[]).includes(v);

/** Validates anything read from storage or the network; unknown values never reach the UI. */
export const toAvatarId = (v: unknown): AvatarId | null => (isAvatarId(v) ? v : null);

export const avatarSrc = (id: AvatarId): string => `assets/avatars/${id}.svg`;
