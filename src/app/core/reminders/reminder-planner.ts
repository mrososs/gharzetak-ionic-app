/**
 * The reminder planner — PURE. Given the user's preferences and a snapshot of their projects it returns the exact list of one-shot
 * local notifications to schedule for the next 28 days. No Angular, no plugin, no clock, no storage.
 *
 * Rules (all approved):
 *  - nothing unless the user opted in (`enabled`), and nothing when there is no unfinished project to continue;
 *  - a rolling 28-day horizon of ONE-SHOT notifications (no infinite repeats: if the app is not opened for four weeks the reminders stop
 *    by themselves), re-planned on launch / resume / relevant changes;
 *  - at most the chosen number per ISO week (twice / thrice / daily / custom days), never inside quiet hours, never closer than a minute,
 *    never shortly after an active crochet session;
 *  - a contextual nudge (almost finished / unfinished for a while / progress photo) REPLACES the first scheduled reminder — it never adds one;
 *  - generic text by default; project names only with the explicit "show details" opt-in; nothing private in the payload;
 *  - deterministic ids in one reserved range, so cancelling and replacing is exact and duplicates are impossible.
 */
import { IsoWeekday, ReminderPrefs } from '../joy/joy.models';
import { Bilingual } from '../joy/joy.copy';
import { DETAIL, GENERIC_POOL, NUDGE_GENERIC, REMINDER_TITLE } from './reminder-copy';
import { dateOfDay, dayNumber, inQuietHours, parseHm, zonedParts, zonedToEpoch } from './reminder-time';

export const HORIZON_DAYS = 28;
export const MIN_LEAD_MS = 60_000;
/** A slot this soon after crochet activity is skipped ("avoid reminders right after an active session"). */
export const SESSION_GAP_MS = 6 * 60 * 60 * 1000;
export const INACTIVE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
export const ALMOST_DONE_AT = 0.85;
export const PHOTO_SUGGEST_AT = 0.5;

/** Reserved notification-id range for Gharzetak reminders: [7_000_000, 8_000_000). */
export const REMINDER_ID_BASE = 7_000_000;
export const REMINDER_ID_END = 8_000_000;
export const PREVIEW_ID = 7_999_990;
export const isReminderId = (id: number): boolean => id >= REMINDER_ID_BASE && id < REMINDER_ID_END;

/** Android notification channels. The channel decides what a locked screen may show. */
export const CHANNEL_PRIVATE = 'gz_reminders_v1';
export const CHANNEL_DETAILS = 'gz_reminders_details_v1';

export type ReminderKind = 'scheduled' | 'motivation' | 'inactive' | 'almostDone' | 'photo';

/** The ONLY data a notification carries (besides its visible text). No names, no pattern text, no account id. */
export interface ReminderExtra {
  readonly v: 1;
  readonly kind: ReminderKind;
  /** Non-reversible fingerprint of the owning scope (account / guest): lets the router refuse another account's notification. */
  readonly scope: string;
  readonly projectId: string | null;
  readonly instanceId: string | null;
}

export interface PlannedReminder {
  readonly id: number;
  /** Epoch ms. */
  readonly at: number;
  readonly title: string;
  readonly body: string;
  readonly kind: ReminderKind;
  readonly channelId: string;
  readonly extra: ReminderExtra;
}

export interface PlanProject {
  readonly id: string;
  readonly name: string;
  readonly status: 'active' | 'paused' | 'done';
  readonly deletedAt: number | null;
  readonly lastWorkedAt: number;
  /** 0..1 overall progress. */
  readonly progress: number;
  readonly activeInstanceId: string | null;
  /** The piece the user is on ("Head 1/2"), for a detailed text. */
  readonly pieceLabel: string | null;
  readonly hasPhoto: boolean;
}

export interface PlanInput {
  readonly now: number;
  /** IANA zone of the device ("Africa/Cairo"). */
  readonly tz: string;
  readonly lang: 'ar' | 'en';
  readonly scopeKey: string;
  readonly prefs: ReminderPrefs;
  readonly projects: readonly PlanProject[];
  /** Last time the user did crochet work (a tap or a timer session), or null. */
  readonly lastActivityAt: number | null;
}

const ALL_DAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

/** Reminders per ISO week for each frequency. */
export function weeklyCap(prefs: Pick<ReminderPrefs, 'cadence' | 'days'>): number {
  switch (prefs.cadence) {
    case 'twice':
      return 2;
    case 'thrice':
      return 3;
    case 'daily':
      return 7;
    default:
      return Math.min(7, new Set(prefs.days).size);
  }
}

/** The weekdays reminders may fall on: every day for "daily", otherwise the user's chosen days (de-duplicated, Monday-first). */
export function effectiveDays(prefs: Pick<ReminderPrefs, 'cadence' | 'days'>): IsoWeekday[] {
  if (prefs.cadence === 'daily') return [...ALL_DAYS];
  return [...new Set(prefs.days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b) as IsoWeekday[];
}

/** The project reminders are about: the chosen one if still unfinished, else the most recently worked-on unfinished project; null if none. */
export function pickTarget(prefs: Pick<ReminderPrefs, 'projectId'>, projects: readonly PlanProject[]): PlanProject | null {
  const open = projects.filter((p) => p.status === 'active' && !p.deletedAt);
  if (!open.length) return null;
  const chosen = prefs.projectId ? open.find((p) => p.id === prefs.projectId) : undefined;
  return chosen ?? [...open].sort((a, b) => b.lastWorkedAt - a.lastWorkedAt)[0];
}

/** Deterministic id for a day (one reminder per day at most, so no duplicates are possible). */
export const reminderIdFor = (dayNo: number): number => REMINDER_ID_BASE + (dayNo % 100_000) * 10;

const fill = (m: Bilingual, lang: 'ar' | 'en', vars: Record<string, string>): string => m[lang].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');

export function planReminders(input: PlanInput): PlannedReminder[] {
  const { now, tz, lang, prefs, projects } = input;
  if (!prefs.enabled) return [];
  const target = pickTarget(prefs, projects);
  if (!target) return []; // nothing unfinished to continue: no reminder is better than a hollow one

  const days = new Set(effectiveDays(prefs));
  if (!days.size) return [];
  const cap = weeklyCap(prefs);
  const timeMin = parseHm(prefs.time, 19 * 60 + 30);
  const today = zonedParts(now, tz);
  const startDay = dayNumber(today.y, today.m, today.d);

  const perWeek = new Map<number, number>();
  const kept: { at: number; dayNo: number }[] = [];
  for (let off = 0; off < HORIZON_DAYS; off++) {
    const dayNo = startDay + off;
    const { y, m, d, weekday } = dateOfDay(dayNo);
    if (!days.has(weekday as IsoWeekday)) continue;
    const at = zonedToEpoch(y, m, d, Math.floor(timeMin / 60), timeMin % 60, tz);
    if (at < now + MIN_LEAD_MS) continue;
    // the slot's actual local time (a DST gap can shift it): never inside quiet hours
    const local = zonedParts(at, tz);
    if (inQuietHours(local.h * 60 + local.min, prefs.quiet.start, prefs.quiet.end)) continue;
    // not right after a crochet session
    if (input.lastActivityAt !== null && at > input.lastActivityAt && at - input.lastActivityAt < SESSION_GAP_MS) continue;
    const week = dayNo - (weekday - 1); // the Monday of this ISO week
    const used = perWeek.get(week) ?? 0;
    if (used >= cap) continue;
    perWeek.set(week, used + 1);
    kept.push({ at, dayNo });
  }

  const channelId = prefs.showDetails ? CHANNEL_DETAILS : CHANNEL_PRIVATE;
  const scopeBase = { v: 1 as const, scope: input.scopeKey, projectId: target.id, instanceId: target.activeInstanceId };
  const title = REMINDER_TITLE[lang];

  const out: PlannedReminder[] = kept.map((slot, i) => {
    // two generic flavours alternate (scheduled time / gentle motivation); the text pool rotates by day so it never repeats back to back
    const kind: ReminderKind = i % 2 === 0 ? 'scheduled' : 'motivation';
    const body = prefs.showDetails && kind === 'scheduled' ? fill(DETAIL.scheduled, lang, { project: target.name }) : GENERIC_POOL[(slot.dayNo + i) % GENERIC_POOL.length][lang];
    return { id: reminderIdFor(slot.dayNo), at: slot.at, title, body, kind, channelId, extra: { ...scopeBase, kind } };
  });

  // At most ONE contextual nudge, and it REPLACES the first reminder (it never adds an extra notification).
  const first = out[0];
  if (first) {
    const nudge = chooseNudge(prefs, target, first.at);
    if (nudge) {
      const body = prefs.showDetails
        ? fill(DETAIL[nudge], lang, { project: target.name, target: target.pieceLabel ? `${target.pieceLabel} · ${target.name}` : target.name })
        : NUDGE_GENERIC[nudge][lang];
      out[0] = { ...first, kind: nudge, body, extra: { ...scopeBase, kind: nudge } };
    }
  }
  return out;
}

function chooseNudge(prefs: ReminderPrefs, t: PlanProject, at: number): 'almostDone' | 'inactive' | 'photo' | null {
  if (prefs.nudges.almostDone && t.progress >= ALMOST_DONE_AT && t.progress < 1) return 'almostDone';
  if (prefs.nudges.inactive && at - t.lastWorkedAt >= INACTIVE_AFTER_MS) return 'inactive';
  if (prefs.nudges.photo && !t.hasPhoto && t.progress >= PHOTO_SUGGEST_AT) return 'photo';
  return null;
}

/**
 * The "Preview notification" button: ONE reminder a few seconds from now, worded exactly like a real one (generic unless the user opted
 * into details). Works even with no unfinished project (then the text is generic and the tap opens the projects list).
 */
export function previewReminder(args: { now: number; lang: 'ar' | 'en'; scopeKey: string; prefs: ReminderPrefs; target: PlanProject | null }): PlannedReminder {
  const { now, lang, prefs, target } = args;
  const body = prefs.showDetails && target ? fill(DETAIL.scheduled, lang, { project: target.name }) : GENERIC_POOL[0][lang];
  return {
    id: PREVIEW_ID,
    at: now + 5_000,
    title: REMINDER_TITLE[lang],
    body,
    kind: 'scheduled',
    channelId: prefs.showDetails ? CHANNEL_DETAILS : CHANNEL_PRIVATE,
    extra: { v: 1, kind: 'scheduled', scope: args.scopeKey, projectId: target?.id ?? null, instanceId: target?.activeInstanceId ?? null },
  };
}

/** A stable signature of a plan: two plans with the same signature need no re-scheduling. */
export function planSignature(plan: readonly PlannedReminder[], scopeKey: string, tz: string): string {
  return `${scopeKey}|${tz}|` + plan.map((p) => `${p.id}@${p.at}:${p.kind}:${p.channelId}:${p.body}`).join('|');
}
