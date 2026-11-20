/**
 * Khayoota daily allowance, as the app shows it. The numbers are ALWAYS the server's (GET /v1/ai/status and the `usage` of every
 * reply); this file only formats them and pre-checks a send so the user is told BEFORE a request that would be refused.
 * The server enforces the limits regardless (apps/api/src/services/ai/quota.ts).
 */
import type { AiStatusV1, QuotaV1 } from './khayoota.types';

type EnabledStatus = Extract<AiStatusV1, { enabled: true }>;

/** The quota of an enabled status; builds the same shape from the v1 numeric fields when talking to an older server. */
export function quotaOf(s: AiStatusV1 | null): QuotaV1 | null {
  if (!s || !s.enabled) return null;
  if (s.quota) return s.quota;
  const e = s as EnabledStatus;
  return {
    unlimited: false,
    timezone: 'Africa/Cairo',
    chat: { used: Math.max(0, e.limits.chat - e.remaining.chat), limit: e.limits.chat, remaining: e.remaining.chat },
    image: { used: Math.max(0, e.limits.image - e.remaining.image), limit: e.limits.image, remaining: e.remaining.image },
    resetAt: e.resetAt || null,
  };
}

/** Which allowance a send of `imageCount` photos would run into (null = it fits, or the account is unlimited). */
export function blockedBy(q: QuotaV1 | null, imageCount: number): 'chat' | 'image' | null {
  if (!q || q.unlimited) return null;
  if ((q.chat.remaining ?? Infinity) < 1) return 'chat';
  if (imageCount > (q.image.remaining ?? Infinity)) return 'image';
  return null;
}

/** How many photos may still be attached today (never more than the per-message maximum). */
export function photoRoom(q: QuotaV1 | null, perMessage: number): number {
  if (!q || q.unlimited) return perMessage;
  return Math.max(0, Math.min(perMessage, q.image.remaining ?? perMessage));
}

export interface QuotaLines {
  unlimited: boolean;
  chat: string;
  image: string;
  /** True when either allowance is used up. */
  out: boolean;
}

export function quotaLines(q: QuotaV1, ar: boolean): QuotaLines {
  if (q.unlimited) {
    const t = ar ? 'استخدام غير محدود' : 'Unlimited usage';
    return { unlimited: true, chat: t, image: t, out: false };
  }
  const of = (r: number | null, l: number | null) => `${r ?? 0} ${ar ? 'من' : 'of'} ${l ?? 0}`;
  return {
    unlimited: false,
    chat: `${ar ? 'الرسائل المتبقية اليوم' : 'Messages remaining today'}: ${of(q.chat.remaining, q.chat.limit)}`,
    image: `${ar ? 'الصور المتبقية اليوم' : 'Images remaining today'}: ${of(q.image.remaining, q.image.limit)}`,
    out: (q.chat.remaining ?? 1) < 1 || (q.image.remaining ?? 1) < 1,
  };
}

/** "Renews at midnight Cairo time — in 5 h 12 min". Null for unlimited accounts (no countdown) or an unknown reset. */
export function resetLine(q: QuotaV1 | null, ar: boolean, now = Date.now()): string | null {
  if (!q || q.unlimited || !q.resetAt) return null;
  const ms = Date.parse(q.resetAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (ar) {
    const dur = h > 0 ? `${h} ساعة${m ? ` و${m} دقيقة` : ''}` : `${m} دقيقة`;
    return `الحصة بتتجدد عند منتصف الليل بتوقيت القاهرة — بعد ${dur}`;
  }
  return `Your allowance renews at midnight Cairo time — in ${h > 0 ? `${h} h ` : ''}${m ? `${m} min` : ''}`.trim();
}
