/**
 * Time-zone maths for reminders, done with `Intl` (not the host's zone), so the planner is deterministic, DST-safe and testable
 * for any IANA zone. All functions are pure.
 */

export interface ZonedParts {
  readonly y: number;
  readonly m: number;
  readonly d: number;
  readonly h: number;
  readonly min: number;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  readonly weekday: number;
}

const WEEKDAYS: Readonly<Record<string, number>> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });
    fmtCache.set(tz, f);
  }
  return f;
}

/** The wall-clock date and time that epoch `ts` shows in time zone `tz`. */
export function zonedParts(ts: number, tz: string): ZonedParts {
  const get: Record<string, string> = {};
  for (const p of fmt(tz).formatToParts(new Date(ts))) get[p.type] = p.value;
  return { y: +get['year'], m: +get['month'], d: +get['day'], h: +get['hour'] % 24, min: +get['minute'], weekday: WEEKDAYS[get['weekday']] ?? 1 };
}

/** Offset of `tz` from UTC at instant `ts`, in ms (east is positive). Minute resolution. */
export function tzOffsetMs(ts: number, tz: string): number {
  const p = zonedParts(ts, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(ts / 60_000) * 60_000;
}

/**
 * The epoch at which a clock in `tz` reads y-m-d h:min. A time that does not exist (spring-forward gap) resolves to the first instant
 * after the gap; a time that happens twice (autumn overlap) resolves to its first occurrence.
 */
export function zonedToEpoch(y: number, m: number, d: number, h: number, min: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const off1 = tzOffsetMs(guess, tz);
  const t1 = guess - off1;
  const off2 = tzOffsetMs(t1, tz);
  if (off2 === off1) return t1; // same offset on both sides: unambiguous (or the FIRST occurrence of an autumn overlap)
  // The offset changed around this instant (a DST boundary): try the other offset.
  const t2 = guess - off2;
  if (tzOffsetMs(t2, tz) === off2) return t2; // a real wall-clock time under the other offset
  return Math.max(t1, t2); // neither is valid: the time falls in a spring-forward gap, so use the first instant after it
}

/** Whole days since 1970-01-01 of a calendar date (timezone-free). */
export const dayNumber = (y: number, m: number, d: number): number => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);

/** Calendar date + weekday for `dayNumber` (timezone-free). */
export function dateOfDay(n: number): { y: number; m: number; d: number; weekday: number } {
  const dt = new Date(n * 86_400_000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), weekday: dt.getUTCDay() === 0 ? 7 : dt.getUTCDay() };
}

/** 'HH:mm' → minutes since midnight (clamped, never NaN). */
export function parseHm(hm: string, fallback = 0): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm ?? '');
  if (!m) return fallback;
  return Math.max(0, Math.min(23, +m[1])) * 60 + Math.max(0, Math.min(59, +m[2]));
}

/** Is a time of day inside quiet hours? Handles the overnight wrap (22:00 → 08:00). Equal start/end = no quiet hours. */
export function inQuietHours(minuteOfDay: number, start: string, end: string): boolean {
  const s = parseHm(start, 22 * 60);
  const e = parseHm(end, 8 * 60);
  if (s === e) return false;
  return s < e ? minuteOfDay >= s && minuteOfDay < e : minuteOfDay >= s || minuteOfDay < e;
}

/** The device's current IANA time zone ('UTC' when it cannot be determined). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** A short, stable, NON-reversible fingerprint (FNV-1a) used to tag notifications with their owner without storing the account id. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
