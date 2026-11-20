import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/api.client';
import { blockedBy, photoRoom, quotaLines, quotaOf, resetLine } from './khayoota-quota';
import { mapError } from './khayoota.service';
import type { AiStatusV1, QuotaV1 } from './khayoota.types';

const q = (chatLeft: number, imageLeft: number, resetAt: string | null = '2026-07-15T21:00:00.000Z'): QuotaV1 => ({
  unlimited: false,
  timezone: 'Africa/Cairo',
  chat: { used: 10 - chatLeft, limit: 10, remaining: chatLeft },
  image: { used: 5 - imageLeft, limit: 5, remaining: imageLeft },
  resetAt,
});
const unlimited: QuotaV1 = { unlimited: true, timezone: 'Africa/Cairo', chat: { used: 40, limit: null, remaining: null }, image: { used: 12, limit: null, remaining: null }, resetAt: null };

describe('Khayoota daily allowance (formatting and pre-checks; the server enforces)', () => {
  it('prints the exact Arabic and English lines', () => {
    expect(quotaLines(q(10, 5), true)).toMatchObject({ chat: 'الرسائل المتبقية اليوم: 10 من 10', image: 'الصور المتبقية اليوم: 5 من 5', out: false });
    expect(quotaLines(q(7, 2), false)).toMatchObject({ chat: 'Messages remaining today: 7 of 10', image: 'Images remaining today: 2 of 5', out: false });
    expect(quotaLines(q(0, 5), false).out).toBe(true);
    expect(quotaLines(q(3, 0), true).out).toBe(true);
  });

  it('the unlimited account reads "Unlimited usage" in both languages and has no countdown', () => {
    expect(quotaLines(unlimited, true)).toMatchObject({ unlimited: true, chat: 'استخدام غير محدود', out: false });
    expect(quotaLines(unlimited, false)).toMatchObject({ unlimited: true, chat: 'Unlimited usage', out: false });
    expect(resetLine(unlimited, true)).toBeNull();
    expect(resetLine(unlimited, false)).toBeNull();
  });

  it('formats the time until the (Cairo-midnight) reset the server reports', () => {
    const now = Date.parse('2026-07-15T15:48:00.000Z'); // 5 h 12 min before 21:00Z
    expect(resetLine(q(0, 5), true, now)).toBe('الحصة بتتجدد عند منتصف الليل بتوقيت القاهرة — بعد 5 ساعة و12 دقيقة');
    expect(resetLine(q(0, 5), false, now)).toBe('Your allowance renews at midnight Cairo time — in 5 h 12 min');
    expect(resetLine(q(0, 5), false, Date.parse('2026-07-15T20:30:00.000Z'))).toBe('Your allowance renews at midnight Cairo time — in 30 min');
    expect(resetLine(q(0, 5), true, Date.parse('2026-07-15T20:00:00.000Z'))).toBe('الحصة بتتجدد عند منتصف الليل بتوقيت القاهرة — بعد 1 ساعة');
    expect(resetLine(q(0, 5, null), true, now)).toBeNull();
    expect(resetLine(q(0, 5, '2020-01-01T00:00:00.000Z'), true, now)).toBeNull(); // a stale reset is never shown as a countdown
  });

  it('pre-checks a send: messages first, then photos against what remains; unlimited is never blocked', () => {
    expect(blockedBy(q(10, 5), 0)).toBeNull();
    expect(blockedBy(q(10, 5), 4)).toBeNull();
    expect(blockedBy(q(0, 5), 0)).toBe('chat');
    expect(blockedBy(q(0, 0), 2)).toBe('chat');
    expect(blockedBy(q(4, 2), 3)).toBe('image');
    expect(blockedBy(q(4, 2), 2)).toBeNull();
    expect(blockedBy(q(4, 0), 0)).toBeNull(); // text only still fits when photos are used up
    expect(blockedBy(unlimited, 4)).toBeNull();
    expect(blockedBy(null, 4)).toBeNull();
  });

  it('photo room is the per-message maximum capped by today\'s remaining images', () => {
    expect(photoRoom(q(10, 5), 4)).toBe(4);
    expect(photoRoom(q(10, 2), 4)).toBe(2);
    expect(photoRoom(q(10, 0), 4)).toBe(0);
    expect(photoRoom(unlimited, 4)).toBe(4);
    expect(photoRoom(null, 4)).toBe(4);
  });

  it('derives the same view from an older server that only sends the v1 numbers; disabled status has no quota', () => {
    const old = { v: 1, enabled: true, provider: 'workers-ai', features: { chat: true, vision: true, extract: true }, consent: { version: 1, accepted: true }, limits: { chat: 10, image: 5, extract: 5 }, remaining: { chat: 6, image: 5, extract: 5 }, available: true, resetAt: '2026-07-15T21:00:00.000Z' } as AiStatusV1;
    expect(quotaOf(old)).toMatchObject({ unlimited: false, chat: { used: 4, limit: 10, remaining: 6 }, image: { used: 0, limit: 5, remaining: 5 }, resetAt: '2026-07-15T21:00:00.000Z' });
    expect(quotaOf({ v: 1, enabled: false })).toBeNull();
    expect(quotaOf(null)).toBeNull();
  });

  it('a quota refusal from the server carries the remaining numbers into the failure', () => {
    const f = mapError(new ApiError(429, 'ai_quota_exceeded', 'x', undefined, { scope: 'user', kind: 'image', remaining: { chat: 9, image: 2, extract: 2 }, resetAt: '2026-07-15T21:00:00.000Z' }));
    expect(f.code).toBe('ai_quota_exceeded');
    expect(f.info).toMatchObject({ scope: 'user', kind: 'image', remaining: { chat: 9, image: 2, extract: 2 } });
    expect(mapError(new ApiError(409, 'ai_duplicate_request', 'x')).code).toBe('ai_duplicate_request');
    expect(mapError(new ApiError(409, 'ai_request_in_progress', 'x')).code).toBe('ai_request_in_progress');
  });
});
