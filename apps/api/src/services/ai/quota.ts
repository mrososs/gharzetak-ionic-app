/**
 * Khayoota AI — usage protection in D1 (authoritative; counts and token totals only, never content).
 *
 * Every limit is a single conditional upsert (`… DO UPDATE … WHERE counter + delta <= limit RETURNING`), so concurrent
 * requests can never push a counter past its cap. Order per request:
 *   burst window → per-user daily count + global request cap → global Neuron reservation (UPPER BOUND) → model call →
 *   settle (replace the reservation with the estimate from reported tokens, or keep the upper bound if none was reported).
 *
 * The Neuron figures are ESTIMATES from catalogue prices. They protect the account's free allocation conservatively but
 * are not a billing guarantee; the request cap is the second, independent ceiling.
 */
import type { AiConfig, AiKind } from './config';

export const GLOBAL_SCOPE = '__all__';

export type QuotaDenied =
  | { ok: false; reason: 'burst' }
  | { ok: false; reason: 'user'; kind: AiKind }
  | { ok: false; reason: 'global-requests' }
  | { ok: false; reason: 'global-budget' };

const KIND_COLUMN: Record<AiKind, 'chat' | 'image' | 'extract'> = { chat: 'chat', image: 'image', extract: 'extract' };

/** Weighted burst units in the current minute window. */
export async function takeBurst(db: D1Database, userId: string, units: number, limit: number, now = Date.now()): Promise<boolean> {
  if (units > limit) return false;
  const windowStart = Math.floor(now / 60_000) * 60_000;
  const row = await db
    .prepare(
      `INSERT INTO ai_rate (user_id, window_start, units) VALUES (?1, ?2, ?3)
       ON CONFLICT(user_id, window_start) DO UPDATE SET units = units + ?3 WHERE ai_rate.units + ?3 <= ?4
       RETURNING units`,
    )
    .bind(userId, windowStart, units, limit)
    .first<{ units: number }>();
  return !!row;
}

/** One request of `kind` for this user today, and one against the account-wide request cap. Compensates on failure. */
export async function reserveRequest(db: D1Database, cfg: AiConfig, userId: string, kind: AiKind, day: string): Promise<{ ok: true } | QuotaDenied> {
  const col = KIND_COLUMN[kind];
  const limit = cfg.userDaily[kind];
  if (limit <= 0) return { ok: false, reason: 'user', kind };
  if (cfg.dailyRequestCap <= 0) return { ok: false, reason: 'global-requests' };
  const user = await db
    .prepare(
      `INSERT INTO ai_usage_daily (scope, day, ${col}, requests) VALUES (?1, ?2, 1, 1)
       ON CONFLICT(scope, day) DO UPDATE SET ${col} = ${col} + 1, requests = requests + 1 WHERE ai_usage_daily.${col} + 1 <= ?3
       RETURNING ${col} AS n`,
    )
    .bind(userId, day, limit)
    .first<{ n: number }>();
  if (!user) return { ok: false, reason: 'user', kind };
  const global = await db
    .prepare(
      `INSERT INTO ai_usage_daily (scope, day, ${col}, requests) VALUES (?1, ?2, 1, 1)
       ON CONFLICT(scope, day) DO UPDATE SET ${col} = ${col} + 1, requests = requests + 1 WHERE ai_usage_daily.requests + 1 <= ?3
       RETURNING requests AS n`,
    )
    .bind(GLOBAL_SCOPE, day, cfg.dailyRequestCap)
    .first<{ n: number }>();
  if (!global) {
    await db.prepare(`UPDATE ai_usage_daily SET ${col} = ${col} - 1, requests = requests - 1 WHERE scope = ?1 AND day = ?2`).bind(userId, day).run();
    return { ok: false, reason: 'global-requests' };
  }
  return { ok: true };
}

/** Reserves an UPPER-BOUND Neuron amount against the account-wide daily budget. */
export async function reserveNeurons(db: D1Database, budget: number, day: string, amount: number): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO ai_usage_daily (scope, day, neurons_reserved) SELECT ?1, ?2, ?3 WHERE ?3 <= ?4
       ON CONFLICT(scope, day) DO UPDATE SET neurons_reserved = neurons_reserved + ?3 WHERE ai_usage_daily.neurons_reserved + ?3 <= ?4
       RETURNING neurons_reserved`,
    )
    .bind(GLOBAL_SCOPE, day, amount, budget)
    .first<{ neurons_reserved: number }>();
  return !!row;
}

/**
 * Replaces a reservation by the estimate from reported tokens. When the provider reported no usage (failure, timeout)
 * the full reservation is kept as "used": conservative by design.
 */
export async function settle(db: D1Database, userId: string, day: string, reserved: number, actual: number | null, tokensIn: number, tokensOut: number): Promise<void> {
  const used = actual === null ? reserved : Math.min(actual, reserved);
  const release = reserved - used;
  await db.batch([
    db
      .prepare(`UPDATE ai_usage_daily SET neurons_reserved = neurons_reserved - ?3, neurons_used = neurons_used + ?4, tokens_in = tokens_in + ?5, tokens_out = tokens_out + ?6 WHERE scope = ?1 AND day = ?2`)
      .bind(GLOBAL_SCOPE, day, release, used, tokensIn, tokensOut),
    db
      .prepare(
        `INSERT INTO ai_usage_daily (scope, day, neurons_used, tokens_in, tokens_out) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(scope, day) DO UPDATE SET neurons_used = neurons_used + ?3, tokens_in = tokens_in + ?4, tokens_out = tokens_out + ?5`,
      )
      .bind(userId, day, used, tokensIn, tokensOut),
  ]);
}

export interface UsageView {
  used: Record<AiKind, number>;
  remaining: Record<AiKind, number>;
  globalExhausted: boolean;
}

export async function usageFor(db: D1Database, cfg: AiConfig, userId: string, day: string): Promise<UsageView> {
  const rows = await db
    .prepare('SELECT scope, chat, image, extract, requests, neurons_reserved FROM ai_usage_daily WHERE day = ?1 AND scope IN (?2, ?3)')
    .bind(day, userId, GLOBAL_SCOPE)
    .all<{ scope: string; chat: number; image: number; extract: number; requests: number; neurons_reserved: number }>();
  const u = rows.results.find((r) => r.scope === userId);
  const g = rows.results.find((r) => r.scope === GLOBAL_SCOPE);
  const used = { chat: u?.chat ?? 0, image: u?.image ?? 0, extract: u?.extract ?? 0 };
  const globalExhausted = !!g && (g.requests >= cfg.dailyRequestCap || g.neurons_reserved >= cfg.dailyNeuronBudget);
  return {
    used,
    remaining: {
      chat: Math.max(0, cfg.userDaily.chat - used.chat),
      image: Math.max(0, cfg.userDaily.image - used.image),
      extract: Math.max(0, cfg.userDaily.extract - used.extract),
    },
    globalExhausted,
  };
}
