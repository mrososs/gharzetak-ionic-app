/**
 * Project time maths — pure and deterministic.
 *
 * Internal unit: SECONDS for recorded work (`Project.workedSeconds`, the timer's authoritative value) and
 * HOURS-as-a-real for the optional estimate (`Project.estimatedHours`, already synced). Every estimate is entered
 * as whole minutes (hours × 60 + minutes), so `estimatedHours = minutes / 60` round-trips exactly through
 * `Math.round(hours * 60)`; comparisons are done in WHOLE MINUTES so the three numbers on screen always add up
 * (estimated − recorded = remaining, recorded − estimated = overrun) with no hidden second-level rounding.
 */

export const MAX_ESTIMATE_MINUTES = 100_000 * 60;

/** Hours + minutes entered by the user → whole minutes. Invalid / negative input counts as 0 (no estimate). */
export function toMinutes(hours: number, minutes: number): number {
  const h = Number.isFinite(hours) ? Math.max(0, Math.floor(hours)) : 0;
  const m = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0;
  return Math.min(MAX_ESTIMATE_MINUTES, h * 60 + m);
}

/** Whole minutes → the value stored in `estimatedHours`. 0 = no estimate. */
export function minutesToEstimatedHours(totalMinutes: number): number {
  return Math.max(0, Math.round(totalMinutes)) / 60;
}

/** `estimatedHours` (real) → whole minutes (absorbs binary floating-point noise). */
export function estimatedHoursToMinutes(estimatedHours: number): number {
  return Number.isFinite(estimatedHours) && estimatedHours > 0 ? Math.round(estimatedHours * 60) : 0;
}

export function splitMinutes(totalMinutes: number): { hours: number; minutes: number } {
  const t = Math.max(0, Math.floor(totalMinutes));
  return { hours: Math.floor(t / 60), minutes: t % 60 };
}

/** Recorded seconds → whole minutes (floor: never claims more time than was worked). */
export function secondsToMinutes(seconds: number): number {
  return Math.max(0, Math.floor((Number.isFinite(seconds) ? seconds : 0) / 60));
}

export type TimeState = 'none' | 'under' | 'exact' | 'over';

export interface TimeComparison {
  readonly state: TimeState;
  /** Whole minutes; 0 when no estimate. */
  readonly estimatedMinutes: number;
  readonly recordedMinutes: number;
  /** Estimate − recorded, never negative. 0 when over / exact / none. */
  readonly remainingMinutes: number;
  /** Recorded − estimate, never negative. */
  readonly overMinutes: number;
  /** 0..1 for the progress bar (capped at 1). 0 when there is no estimate: no misleading percentage is shown. */
  readonly fraction: number;
  /** Rounded percentage for display, or null when there is no estimate. */
  readonly percent: number | null;
}

/** Compares recorded work against the user's estimate. The result is a comparison, never a prediction. */
export function compareTime(estimatedHours: number, recordedSeconds: number): TimeComparison {
  const est = estimatedHoursToMinutes(estimatedHours);
  const rec = secondsToMinutes(recordedSeconds);
  if (est <= 0) return { state: 'none', estimatedMinutes: 0, recordedMinutes: rec, remainingMinutes: 0, overMinutes: 0, fraction: 0, percent: null };
  const over = Math.max(0, rec - est);
  const remaining = Math.max(0, est - rec);
  return {
    state: rec > est ? 'over' : rec === est ? 'exact' : 'under',
    estimatedMinutes: est,
    recordedMinutes: rec,
    remainingMinutes: remaining,
    overMinutes: over,
    fraction: Math.min(1, rec / est),
    percent: Math.round(Math.min(1, rec / est) * 100),
  };
}

/* ------------------------------------------------------------------ */
/* formatting                                                          */
/* ------------------------------------------------------------------ */

export type DurationLang = 'ar' | 'en';

function arHours(h: number, alone: boolean): string {
  if (h === 1) return alone ? 'ساعة واحدة' : 'ساعة';
  if (h === 2) return 'ساعتان';
  if (h >= 3 && h <= 10) return `${h} ساعات`;
  return `${h} ساعة`;
}
function arMinutes(m: number, alone: boolean): string {
  if (m === 1) return alone ? 'دقيقة واحدة' : 'دقيقة';
  if (m === 2) return 'دقيقتان';
  if (m >= 3 && m <= 10) return `${m} دقائق`;
  return `${m} دقيقة`;
}

/**
 * Human duration from whole minutes, in the voice of the spec:
 *   270 → "4 ساعات و30 دقيقة" · 75 → "ساعة و15 دقيقة" · 60 → "ساعة واحدة" · 0 → "أقل من دقيقة"
 */
export function formatMinutes(totalMinutes: number, lang: DurationLang): string {
  const { hours, minutes } = splitMinutes(totalMinutes);
  if (lang === 'ar') {
    if (!hours && !minutes) return 'أقل من دقيقة';
    if (hours && minutes) return `${arHours(hours, false)} و${arMinutes(minutes, false)}`;
    return hours ? arHours(hours, true) : arMinutes(minutes, true);
  }
  if (!hours && !minutes) return 'Less than a minute';
  const h = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const m = `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  return hours && minutes ? `${h} ${m}` : hours ? h : m;
}
