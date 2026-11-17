/** Crochet Joy — preference and achievement types. Everything here is device-local and account-scoped (see `ScopeDocs.prefs`). */

export type CelebrationMode = 'every' | 'milestones' | 'off';
export type MotionPref = 'system' | 'reduced';

export interface JoyPrefs {
  /** Which celebrations are shown. The ledger records events in every mode. */
  readonly celebrate: CelebrationMode;
  /** Motivational sentences. Off = a plain "✓ Round 6" confirmation. */
  readonly messages: boolean;
  readonly haptics: boolean;
  /** `reduced` forces the reduced-motion presentation even when the OS allows motion. The OS setting is always honoured as well. */
  readonly motion: MotionPref;
}

export const DEFAULT_JOY_PREFS: JoyPrefs = { celebrate: 'every', messages: true, haptics: true, motion: 'system' };

export type ReminderCadence = 'twice' | 'thrice' | 'daily' | 'custom';
/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface ReminderPrefs {
  readonly v: 1;
  /** Disabled until the user explicitly opts in. */
  readonly enabled: boolean;
  /** 'HH:mm' in the device's local time zone. */
  readonly time: string;
  readonly days: readonly IsoWeekday[];
  readonly cadence: ReminderCadence;
  readonly quiet: { readonly start: string; readonly end: string };
  readonly nudges: { readonly inactive: boolean; readonly almostDone: boolean; readonly photo: boolean };
  /** null = the most recently worked-on unfinished project. */
  readonly projectId: string | null;
  /** Show project / piece names on the lock screen. Off = generic text. */
  readonly showDetails: boolean;
  /** When the soft-ask was last shown (epoch ms), so it is not repeated too often. */
  readonly askedAt?: number;
}

/** Approved defaults after opt-in: Sunday + Wednesday, 7:30 PM local, two a week, quiet 10 PM – 8 AM, generic lock-screen text. */
export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  v: 1,
  enabled: false,
  time: '19:30',
  days: [3, 7],
  cadence: 'twice',
  quiet: { start: '22:00', end: '08:00' },
  nudges: { inactive: true, almostDone: true, photo: false },
  projectId: null,
  showDetails: false,
};

export interface SharePrefs {
  readonly photo: boolean;
  readonly avatar: boolean;
  readonly time: boolean;
  readonly parts: boolean;
  readonly name: boolean;
}

export const DEFAULT_SHARE_PREFS: SharePrefs = { photo: true, avatar: true, time: true, parts: true, name: true };

export const ACHIEVEMENT_IDS = ['first_round', 'rounds_10', 'rounds_50', 'first_project', 'first_multipart', 'first_piece', 'first_finished', 'first_amigurumi'] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

/** Local display + Crochet Joy preferences stored in `ScopeDocs.prefs` (all optional: older installs have none). */
export interface ScopePrefs {
  immersive?: boolean;
  joy?: Partial<JoyPrefs>;
  reminders?: Partial<ReminderPrefs>;
  share?: Partial<SharePrefs>;
}

export const joyPrefsOf = (p: ScopePrefs | undefined): JoyPrefs => ({ ...DEFAULT_JOY_PREFS, ...(p?.joy ?? {}) });
export const reminderPrefsOf = (p: ScopePrefs | undefined): ReminderPrefs => ({ ...DEFAULT_REMINDER_PREFS, ...(p?.reminders ?? {}) });
export const sharePrefsOf = (p: ScopePrefs | undefined): SharePrefs => ({ ...DEFAULT_SHARE_PREFS, ...(p?.share ?? {}) });
