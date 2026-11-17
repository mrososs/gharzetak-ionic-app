import { describe, expect, it } from 'vitest';
import { DEFAULT_REMINDER_PREFS, ReminderPrefs } from '../joy/joy.models';
import { GENERIC_POOL } from './reminder-copy';
import {
  CHANNEL_DETAILS, CHANNEL_PRIVATE, HORIZON_DAYS, INACTIVE_AFTER_MS, MIN_LEAD_MS, PlanInput, PlanProject, REMINDER_ID_BASE, REMINDER_ID_END, SESSION_GAP_MS,
  effectiveDays, isReminderId, pickTarget, planReminders, planSignature, reminderIdFor, weeklyCap,
} from './reminder-planner';
import { dayNumber, dateOfDay, fingerprint, inQuietHours, parseHm, tzOffsetMs, zonedParts, zonedToEpoch } from './reminder-time';

const TZ = 'Africa/Cairo';
/** Tuesday 17 Nov 2026, 12:00 in Cairo (UTC+2: Egypt's summer time ended on 29 Oct). */
const NOW = Date.UTC(2026, 10, 17, 10, 0);
const DAY = 86_400_000;

const prefs = (over: Partial<ReminderPrefs> = {}): ReminderPrefs => ({ ...DEFAULT_REMINDER_PREFS, enabled: true, ...over });
const project = (over: Partial<PlanProject> = {}): PlanProject => ({
  id: 'p1', name: 'Bunny', status: 'active', deletedAt: null, lastWorkedAt: NOW - 3_600_000, progress: 0.3, activeInstanceId: null, pieceLabel: null, hasPhoto: true, ...over,
});
const input = (over: Partial<PlanInput> = {}): PlanInput => ({ now: NOW, tz: TZ, lang: 'en', scopeKey: fingerprint('user:a'), prefs: prefs(), projects: [project()], lastActivityAt: null, ...over });
const local = (ts: number, tz = TZ) => zonedParts(ts, tz);
const hm = (ts: number, tz = TZ) => `${String(local(ts, tz).h).padStart(2, '0')}:${String(local(ts, tz).min).padStart(2, '0')}`;
const weekOf = (ts: number, tz = TZ) => {
  const p = local(ts, tz);
  return dayNumber(p.y, p.m, p.d) - (p.weekday - 1);
};
const perWeek = (plan: { at: number }[]) => {
  const m = new Map<number, number>();
  for (const r of plan) m.set(weekOf(r.at), (m.get(weekOf(r.at)) ?? 0) + 1);
  return [...m.values()];
};

describe('planReminders — defaults and opt-in', () => {
  it('plans nothing unless the user opted in', () => {
    expect(planReminders(input({ prefs: prefs({ enabled: false }) }))).toEqual([]);
    expect(planReminders(input({ prefs: DEFAULT_REMINDER_PREFS }))).toEqual([]); // the shipped default is OFF
  });

  it('the approved defaults: Sunday and Wednesday at 19:30 local, two a week, over a 28-day horizon', () => {
    const plan = planReminders(input());
    expect(plan.map((r) => local(r.at).weekday)).toEqual([3, 7, 3, 7, 3, 7, 3, 7]); // Wed, Sun, Wed, Sun, …
    for (const r of plan) expect(hm(r.at)).toBe('19:30');
    expect(plan).toHaveLength(8);
    expect(Math.max(...perWeek(plan))).toBeLessThanOrEqual(2);
    expect(DEFAULT_REMINDER_PREFS).toMatchObject({ enabled: false, time: '19:30', days: [3, 7], cadence: 'twice', quiet: { start: '22:00', end: '08:00' }, showDetails: false });
    expect(plan.every((r) => r.channelId === CHANNEL_PRIVATE)).toBe(true); // generic / private by default
  });

  it('is sorted, every reminder is in the future and within the 28-day horizon', () => {
    const plan = planReminders(input({ prefs: prefs({ cadence: 'daily' }) }));
    expect(plan.map((r) => r.at)).toEqual([...plan.map((r) => r.at)].sort((a, b) => a - b));
    for (const r of plan) {
      expect(r.at).toBeGreaterThanOrEqual(NOW + MIN_LEAD_MS);
      expect(r.at).toBeLessThan(NOW + (HORIZON_DAYS + 1) * DAY); // nothing beyond four weeks: if the app is not opened, reminders stop on their own
    }
    expect(plan).toHaveLength(28); // today 19:30 is still ahead (it is 12:00 now) … through day 28
  });
});

describe('planReminders — what it must never remind about', () => {
  it('plans nothing when there is no unfinished project to continue (none, done, paused or deleted)', () => {
    expect(planReminders(input({ projects: [] }))).toEqual([]);
    expect(planReminders(input({ projects: [project({ status: 'done' })] }))).toEqual([]);
    expect(planReminders(input({ projects: [project({ status: 'paused' })] }))).toEqual([]);
    expect(planReminders(input({ projects: [project({ deletedAt: 5 })] }))).toEqual([]);
    expect(planReminders(input({ projects: [project({ status: 'done' }), project({ id: 'p2', deletedAt: 1 })] }))).toEqual([]);
  });

  it('a completed or deleted CHOSEN project falls back to another unfinished one, never to the dead project', () => {
    const projects = [project({ id: 'done1', status: 'done', lastWorkedAt: NOW }), project({ id: 'live', lastWorkedAt: NOW - 1000 }), project({ id: 'gone', deletedAt: 1, lastWorkedAt: NOW })];
    for (const chosen of ['done1', 'gone']) {
      const plan = planReminders(input({ prefs: prefs({ projectId: chosen }), projects }));
      expect(plan.length).toBeGreaterThan(0);
      expect(plan.every((r) => r.extra.projectId === 'live')).toBe(true);
    }
  });

  it('picks the chosen project when it is unfinished, else the most recently worked-on one', () => {
    const projects = [project({ id: 'a', lastWorkedAt: 100 }), project({ id: 'b', lastWorkedAt: 900 }), project({ id: 'c', lastWorkedAt: 500 })];
    expect(pickTarget({ projectId: null }, projects)?.id).toBe('b');
    expect(pickTarget({ projectId: 'c' }, projects)?.id).toBe('c');
    expect(pickTarget({ projectId: 'zzz' }, projects)?.id).toBe('b');
    expect(pickTarget({ projectId: null }, [])).toBeNull();
  });

  it('never plans a reminder in the past or less than a minute away', () => {
    const slot = zonedToEpoch(2026, 11, 18, 19, 30, TZ);
    expect(planReminders(input({ now: slot - 30_000 })).some((r) => r.at === slot)).toBe(false);
    expect(planReminders(input({ now: slot - MIN_LEAD_MS - 1 })).some((r) => r.at === slot)).toBe(true);
    expect(planReminders(input({ now: slot + 1 })).some((r) => r.at === slot)).toBe(false);
  });
});

describe('planReminders — frequency caps', () => {
  it.each([
    ['twice', [1, 2, 3, 4, 5], 2],
    ['thrice', [1, 2, 3, 4, 5], 3],
  ] as const)('%s: never more than %i a week even when more days are ticked', (cadence, days, cap) => {
    const plan = planReminders(input({ prefs: prefs({ cadence, days: [...days] }) }));
    expect(Math.max(...perWeek(plan))).toBe(cap);
    expect(weeklyCap(prefs({ cadence }))).toBe(cap);
  });

  it('twice keeps the EARLIEST chosen days of each week', () => {
    const plan = planReminders(input({ prefs: prefs({ cadence: 'twice', days: [5, 2, 4] }) }));
    expect(new Set(plan.map((r) => local(r.at).weekday))).toEqual(new Set([2, 4])); // Tue + Thu; Fri is over the cap
  });

  it('daily is only used when explicitly selected, and then means every day', () => {
    expect(weeklyCap(prefs({ cadence: 'daily' }))).toBe(7);
    expect(effectiveDays(prefs({ cadence: 'daily', days: [3] }))).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(effectiveDays(prefs({ cadence: 'twice', days: [7, 3, 3] }))).toEqual([3, 7]); // de-duplicated, Monday-first
    expect(planReminders(input({ prefs: prefs({ cadence: 'twice' }) })).length).toBeLessThan(10); // the default is NOT daily
  });

  it('custom days: exactly the days chosen', () => {
    const plan = planReminders(input({ prefs: prefs({ cadence: 'custom', days: [1, 3, 5, 6] }) }));
    expect(new Set(plan.map((r) => local(r.at).weekday))).toEqual(new Set([1, 3, 5, 6]));
    expect(Math.max(...perWeek(plan))).toBe(4);
    expect(planReminders(input({ prefs: prefs({ cadence: 'custom', days: [] }) }))).toEqual([]);
  });
});

describe('planReminders — quiet hours', () => {
  it('knows the overnight wrap (22:00 → 08:00), a same-day window, and that equal times mean "no quiet hours"', () => {
    expect(inQuietHours(parseHm('22:00'), '22:00', '08:00')).toBe(true);
    expect(inQuietHours(parseHm('23:59'), '22:00', '08:00')).toBe(true);
    expect(inQuietHours(parseHm('03:00'), '22:00', '08:00')).toBe(true);
    expect(inQuietHours(parseHm('07:59'), '22:00', '08:00')).toBe(true);
    expect(inQuietHours(parseHm('08:00'), '22:00', '08:00')).toBe(false); // the end is exclusive
    expect(inQuietHours(parseHm('21:59'), '22:00', '08:00')).toBe(false);
    expect(inQuietHours(parseHm('13:00'), '12:00', '14:00')).toBe(true);
    expect(inQuietHours(parseHm('15:00'), '12:00', '14:00')).toBe(false);
    expect(inQuietHours(parseHm('03:00'), '08:00', '08:00')).toBe(false);
    expect(parseHm('nonsense', 77)).toBe(77);
    expect(parseHm('25:99')).toBe(23 * 60 + 59);
  });

  it.each(['22:00', '23:30', '02:15', '07:59'])('a reminder time of %s (inside quiet hours) produces no reminder', (time) => {
    expect(planReminders(input({ prefs: prefs({ time }) }))).toEqual([]);
  });

  it.each(['08:00', '12:00', '21:59'])('a reminder time of %s (outside quiet hours) is kept', (time) => {
    expect(planReminders(input({ prefs: prefs({ time, cadence: 'daily' }) })).length).toBeGreaterThan(20);
  });

  it('honours custom quiet hours', () => {
    expect(planReminders(input({ prefs: prefs({ time: '19:30', quiet: { start: '19:00', end: '20:00' } }) }))).toEqual([]);
    expect(planReminders(input({ prefs: prefs({ time: '19:30', quiet: { start: '19:30', end: '19:30' } }) })).length).toBe(8);
  });
});

describe('planReminders — not right after a crochet session', () => {
  it('skips a slot that falls within six hours after the last activity, and keeps the others', () => {
    const wed = zonedToEpoch(2026, 11, 18, 19, 30, TZ);
    const plan = planReminders(input({ lastActivityAt: wed - 2 * 3_600_000 }));
    expect(plan.some((r) => r.at === wed)).toBe(false);
    expect(plan).toHaveLength(7); // only that one slot is dropped
    expect(planReminders(input({ lastActivityAt: wed - SESSION_GAP_MS })).some((r) => r.at === wed)).toBe(true); // exactly six hours is fine
    expect(planReminders(input({ lastActivityAt: NOW })).some((r) => r.at === wed)).toBe(true); // activity long before the slot
  });
});

describe('planReminders — nudges REPLACE, they never add', () => {
  const plain = () => planReminders(input());
  it('almost finished replaces only the first reminder', () => {
    const plan = planReminders(input({ projects: [project({ progress: 0.9 })] }));
    expect(plan).toHaveLength(plain().length);
    expect(plan[0].kind).toBe('almostDone');
    expect(plan.slice(1).every((r) => r.kind === 'scheduled' || r.kind === 'motivation')).toBe(true);
    expect(plan[0].at).toBe(plain()[0].at); // same slot, different words
    expect(plan[0].id).toBe(plain()[0].id);
  });

  it('is not "almost finished" at 100 % or below 85 %', () => {
    expect(planReminders(input({ projects: [project({ progress: 1 })] }))[0].kind).not.toBe('almostDone');
    expect(planReminders(input({ projects: [project({ progress: 0.84 })] }))[0].kind).not.toBe('almostDone');
  });

  it('a project left alone for three days gets a gentle "unfinished" nudge in place of the first reminder', () => {
    const first = plain()[0].at;
    const plan = planReminders(input({ projects: [project({ lastWorkedAt: first - INACTIVE_AFTER_MS })] }));
    expect(plan[0].kind).toBe('inactive');
    expect(plan).toHaveLength(plain().length);
    expect(planReminders(input({ projects: [project({ lastWorkedAt: first - INACTIVE_AFTER_MS + 1000 })] }))[0].kind).not.toBe('inactive');
  });

  it('the photo suggestion is OFF by default, needs real progress and no photo yet', () => {
    expect(planReminders(input({ projects: [project({ progress: 0.6, hasPhoto: false })] }))[0].kind).not.toBe('photo');
    const on = prefs({ nudges: { inactive: true, almostDone: true, photo: true } });
    expect(planReminders(input({ prefs: on, projects: [project({ progress: 0.6, hasPhoto: false })] }))[0].kind).toBe('photo');
    expect(planReminders(input({ prefs: on, projects: [project({ progress: 0.6, hasPhoto: true })] }))[0].kind).not.toBe('photo');
    expect(planReminders(input({ prefs: on, projects: [project({ progress: 0.3, hasPhoto: false })] }))[0].kind).not.toBe('photo');
  });

  it('priority: almost finished > unfinished > photo, and a switched-off nudge never fires', () => {
    const on = prefs({ nudges: { inactive: true, almostDone: true, photo: true } });
    const p = project({ progress: 0.9, hasPhoto: false, lastWorkedAt: 0 });
    expect(planReminders(input({ prefs: on, projects: [p] }))[0].kind).toBe('almostDone');
    expect(planReminders(input({ prefs: { ...on, nudges: { inactive: true, almostDone: false, photo: true } }, projects: [p] }))[0].kind).toBe('inactive');
    expect(planReminders(input({ prefs: { ...on, nudges: { inactive: false, almostDone: false, photo: true } }, projects: [p] }))[0].kind).toBe('photo');
    expect(['scheduled', 'motivation']).toContain(planReminders(input({ prefs: { ...on, nudges: { inactive: false, almostDone: false, photo: false } }, projects: [p] }))[0].kind);
  });
});

describe('planReminders — privacy of what is shown and carried', () => {
  const secretProject = project({ name: 'Secret Surprise Gift', pieceLabel: 'Head 1/2', progress: 0.9 });

  it('generic by default: no project name, no piece name on the lock screen — not even in a nudge', () => {
    const plan = planReminders(input({ projects: [secretProject] }));
    expect(plan.length).toBeGreaterThan(0);
    for (const r of plan) {
      expect(`${r.title} ${r.body}`).not.toMatch(/Secret|Surprise|Gift|Head/);
      expect(r.channelId).toBe(CHANNEL_PRIVATE);
    }
  });

  it('names appear only with the explicit "show details" opt-in, on the public-lock-screen channel the user chose', () => {
    const plan = planReminders(input({ prefs: prefs({ showDetails: true }), projects: [secretProject] }));
    expect(plan[0].kind).toBe('almostDone');
    expect(plan[0].body).toContain('Head 1/2 · Secret Surprise Gift');
    expect(plan.find((r) => r.kind === 'scheduled')?.body).toContain('Secret Surprise Gift');
    for (const r of plan) expect(r.channelId).toBe(CHANNEL_DETAILS);
  });

  it('the payload holds only five fields and never a name, a pattern, an e-mail or the raw account id', () => {
    const scopeKey = fingerprint('user:private-account-id-123');
    const plan = planReminders(input({ scopeKey, prefs: prefs({ showDetails: true }), projects: [project({ name: 'R1: 6sc in MR secret pattern text', activeInstanceId: 'inst-1' })] }));
    for (const r of plan) {
      expect(Object.keys(r.extra).sort()).toEqual(['instanceId', 'kind', 'projectId', 'scope', 'v']);
      const payload = JSON.stringify(r.extra);
      expect(payload).not.toContain('private-account-id-123');
      expect(payload).not.toContain('user:');
      expect(payload).not.toMatch(/secret|6sc|@/);
      expect(r.extra).toMatchObject({ v: 1, scope: scopeKey, projectId: 'p1', instanceId: 'inst-1' });
    }
    expect(scopeKey).not.toContain('private');
    expect(fingerprint('user:a')).not.toBe(fingerprint('user:b'));
    expect(fingerprint('user:a')).toBe(fingerprint('user:a'));
  });

  it('is gentle: no guilt, no countdowns, no shouting, one emoji up front', () => {
    const texts = [...GENERIC_POOL.flatMap((m) => [m.ar, m.en])];
    const plan = [
      ...planReminders(input({ prefs: prefs({ showDetails: true, nudges: { inactive: true, almostDone: true, photo: true } }), projects: [project({ progress: 0.9 })] })),
      ...planReminders(input({ prefs: prefs({ nudges: { inactive: true, almostDone: true, photo: true } }), projects: [project({ progress: 0.9, lastWorkedAt: 0 })] })),
      ...planReminders(input({ prefs: prefs({ nudges: { inactive: true, almostDone: false, photo: true } }), projects: [project({ progress: 0.9, lastWorkedAt: 0, hasPhoto: false })] })),
    ].map((r) => r.body);
    for (const t of [...texts, ...plan]) {
      expect(t).not.toMatch(/\b(haven'?t|missed|lose|losing|streak|last chance|hurry|don'?t forget|only \d+ days?)\b/i);
      expect(t).not.toMatch(/ما?\s*فاتك|هتخسري|آخر فرصة|اتأخرتي|مقصّرة/);
      expect(t).not.toMatch(/[A-Z]{5,}/); // no shouting
    }
  });

  it('speaks Arabic or English', () => {
    expect(planReminders(input({ lang: 'ar' }))[0].title).toBe('غرزتك 🧶');
    expect(planReminders(input({ lang: 'en' }))[0].title).toBe('Gharzetak 🧶');
    expect(GENERIC_POOL.some((m) => planReminders(input({ lang: 'ar' }))[0].body === m.ar)).toBe(true);
  });
});

describe('planReminders — ids', () => {
  it('are unique, deterministic, inside the reserved range, and one per day', () => {
    const a = planReminders(input({ prefs: prefs({ cadence: 'daily' }) }));
    const b = planReminders(input({ prefs: prefs({ cadence: 'daily' }) }));
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
    expect(new Set(a.map((r) => r.id)).size).toBe(a.length);
    for (const r of a) {
      expect(isReminderId(r.id)).toBe(true);
      expect(r.id).toBeGreaterThanOrEqual(REMINDER_ID_BASE);
      expect(r.id).toBeLessThan(REMINDER_ID_END);
    }
    expect(isReminderId(REMINDER_ID_BASE - 1)).toBe(false);
    expect(isReminderId(REMINDER_ID_END)).toBe(false);
    const p = local(a[0].at);
    expect(a[0].id).toBe(reminderIdFor(dayNumber(p.y, p.m, p.d)));
  });
});

describe('planReminders — time zones and DST', () => {
  it('keeps 19:30 LOCAL across the end of New York daylight saving (a 25-hour day)', () => {
    const tz = 'America/New_York';
    const now = Date.UTC(2026, 9, 28, 12, 0);
    const plan = planReminders(input({ now, tz, prefs: prefs({ cadence: 'daily', time: '19:30' }) }));
    for (const r of plan) expect(hm(r.at, tz)).toBe('19:30');
    const gaps = plan.slice(1).map((r, i) => (r.at - plan[i].at) / 3_600_000);
    expect(gaps.filter((g) => g === 25)).toHaveLength(1); // the autumn "fall back" day
    expect(gaps.filter((g) => g === 24).length).toBe(gaps.length - 1);
  });

  it('keeps 19:30 LOCAL across the start of New York daylight saving (a 23-hour day)', () => {
    const tz = 'America/New_York';
    const plan = planReminders(input({ now: Date.UTC(2026, 2, 5, 12, 0), tz, prefs: prefs({ cadence: 'daily', time: '19:30' }) }));
    for (const r of plan) expect(hm(r.at, tz)).toBe('19:30');
    expect(plan.slice(1).map((r, i) => (r.at - plan[i].at) / 3_600_000).filter((g) => g === 23)).toHaveLength(1);
  });

  it('works for Cairo and for a half-hour zone (Kolkata), and a travelling user gets 19:30 in the NEW zone', () => {
    const cairo = planReminders(input({ prefs: prefs({ cadence: 'daily' }) }));
    const india = planReminders(input({ tz: 'Asia/Kolkata', prefs: prefs({ cadence: 'daily' }) }));
    expect(hm(cairo[0].at, 'Africa/Cairo')).toBe('19:30');
    expect(hm(india[0].at, 'Asia/Kolkata')).toBe('19:30');
    expect(india[0].at).not.toBe(cairo[0].at);
    expect(tzOffsetMs(NOW, 'Asia/Kolkata')).toBe(5.5 * 3_600_000);
  });

  it('a time that does not exist (the spring-forward gap) resolves to the first moment after it; an autumn overlap to its first occurrence', () => {
    const tz = 'America/New_York';
    const gap = zonedToEpoch(2026, 3, 8, 2, 30, tz);
    expect(hm(gap, tz)).toBe('03:30');
    const overlap = zonedToEpoch(2026, 11, 1, 1, 30, tz);
    expect(hm(overlap, tz)).toBe('01:30');
    expect(tzOffsetMs(overlap, tz)).toBe(-4 * 3_600_000); // the first (daylight-time) 01:30
    expect(local(zonedToEpoch(2026, 6, 15, 8, 0, tz), tz)).toMatchObject({ y: 2026, m: 6, d: 15, h: 8, min: 0 });
  });

  it('date helpers round-trip and know the weekday', () => {
    const n = dayNumber(2026, 11, 17);
    expect(dateOfDay(n)).toEqual({ y: 2026, m: 11, d: 17, weekday: 2 }); // Tuesday
    expect(dateOfDay(dayNumber(2026, 11, 22)).weekday).toBe(7); // Sunday
    expect(dateOfDay(dayNumber(2026, 11, 23)).weekday).toBe(1); // Monday
  });
});

describe('planSignature', () => {
  it('is stable for the same plan and changes when anything in it changes', () => {
    const a = planReminders(input());
    const sig = planSignature(a, 's', TZ);
    expect(planSignature(planReminders(input()), 's', TZ)).toBe(sig);
    expect(planSignature(planReminders(input({ prefs: prefs({ time: '20:00' }) })), 's', TZ)).not.toBe(sig);
    expect(planSignature(a, 'other-scope', TZ)).not.toBe(sig);
    expect(planSignature(a, 's', 'Asia/Kolkata')).not.toBe(sig);
    expect(planSignature(planReminders(input({ lang: 'ar' })), 's', TZ)).not.toBe(sig);
  });
});
