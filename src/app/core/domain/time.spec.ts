import { describe, expect, it } from 'vitest';
import { compareTime, estimatedHoursToMinutes, formatMinutes, minutesToEstimatedHours, secondsToMinutes, splitMinutes, toMinutes } from './time';

describe('time — units and conversions', () => {
  it('converts hours + minutes to whole minutes and back with no drift', () => {
    expect(toMinutes(4, 30)).toBe(270);
    expect(toMinutes(25, 0)).toBe(1500);
    expect(toMinutes(0, 90)).toBe(90);
    for (const total of [1, 7, 59, 61, 270, 1439, 1500, 6001]) {
      expect(estimatedHoursToMinutes(minutesToEstimatedHours(total))).toBe(total);
    }
  });
  it('treats invalid or negative input as "no estimate"', () => {
    expect(toMinutes(-3, 5)).toBe(5);
    expect(toMinutes(NaN, NaN)).toBe(0);
    expect(estimatedHoursToMinutes(0)).toBe(0);
    expect(estimatedHoursToMinutes(-1)).toBe(0);
    expect(estimatedHoursToMinutes(NaN)).toBe(0);
  });
  it('splits minutes and floors recorded seconds (never overstates the work)', () => {
    expect(splitMinutes(270)).toEqual({ hours: 4, minutes: 30 });
    expect(secondsToMinutes(11_700)).toBe(195);
    expect(secondsToMinutes(11_759)).toBe(195);
    expect(secondsToMinutes(-5)).toBe(0);
  });
});

describe('time — estimate vs recorded', () => {
  it('no estimate: no remaining time and NO percentage', () => {
    const c = compareTime(0, 3600);
    expect(c).toMatchObject({ state: 'none', estimatedMinutes: 0, recordedMinutes: 60, percent: null, fraction: 0, remainingMinutes: 0 });
  });
  it('the spec example: 4h30 estimated, 3h15 recorded → 1h15 remaining', () => {
    const c = compareTime(4.5, 3 * 3600 + 15 * 60);
    expect(c).toMatchObject({ state: 'under', estimatedMinutes: 270, recordedMinutes: 195, remainingMinutes: 75, overMinutes: 0 });
    expect(c.percent).toBe(72);
    expect(c.estimatedMinutes - c.recordedMinutes).toBe(c.remainingMinutes); // the three numbers on screen always add up
  });
  it('exceeding the estimate reports the overrun, caps the bar at 100% and never goes negative', () => {
    const c = compareTime(4.5, 5 * 3600 + 30 * 60);
    expect(c).toMatchObject({ state: 'over', remainingMinutes: 0, overMinutes: 60, fraction: 1, percent: 100 });
  });
  it('exactly on the estimate', () => {
    expect(compareTime(2, 7200)).toMatchObject({ state: 'exact', remainingMinutes: 0, overMinutes: 0, percent: 100 });
  });
  it('editing the estimate recalculates immediately and never touches the recorded time', () => {
    const recorded = 3 * 3600;
    expect(compareTime(2, recorded).state).toBe('over');
    expect(compareTime(8, recorded)).toMatchObject({ state: 'under', remainingMinutes: 300, recordedMinutes: 180 });
    expect(compareTime(0, recorded)).toMatchObject({ state: 'none', recordedMinutes: 180 });
  });
  it('handles awkward minute estimates exactly (4h37m)', () => {
    const est = minutesToEstimatedHours(toMinutes(4, 37));
    expect(compareTime(est, 0).estimatedMinutes).toBe(277);
  });
});

describe('time — Arabic and English formatting', () => {
  it('Arabic follows the wording of the spec', () => {
    expect(formatMinutes(270, 'ar')).toBe('4 ساعات و30 دقيقة');
    expect(formatMinutes(195, 'ar')).toBe('3 ساعات و15 دقيقة');
    expect(formatMinutes(75, 'ar')).toBe('ساعة و15 دقيقة');
    expect(formatMinutes(60, 'ar')).toBe('ساعة واحدة');
    expect(formatMinutes(120, 'ar')).toBe('ساعتان');
    expect(formatMinutes(720, 'ar')).toBe('12 ساعة');
    expect(formatMinutes(1500, 'ar')).toBe('25 ساعة');
    expect(formatMinutes(45, 'ar')).toBe('45 دقيقة');
    expect(formatMinutes(2, 'ar')).toBe('دقيقتان');
    expect(formatMinutes(0, 'ar')).toBe('أقل من دقيقة');
  });
  it('English', () => {
    expect(formatMinutes(270, 'en')).toBe('4 hours 30 minutes');
    expect(formatMinutes(60, 'en')).toBe('1 hour');
    expect(formatMinutes(1, 'en')).toBe('1 minute');
  });
});
