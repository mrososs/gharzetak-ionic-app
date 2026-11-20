/**
 * Khayoota AI — usage protection in D1 (authoritative; counts and token totals only, never content).
 *
 * Per-account daily allowance (Africa/Cairo day): `chat` = hosted AI requests, `image` = individual images submitted.
 * A request costs { chat: 1, image: <images in the request> }. Both counters are charged by ONE conditional upsert
 * (`… DO UPDATE … WHERE chat + c <= limit AND image + i <= limit RETURNING`), so concurrent requests can never push either
 * counter past its cap and a multi-image request is charged all-or-nothing.
 *
 * Order per request:
 *   burst window → idempotency ledger → per-user daily units + global request cap → global Neuron reservation (UPPER BOUND)
 *   → model call → settle (replace the reservation with the estimate from reported tokens) → ledger 'done',
 *   or, when no reply was produced, a capped refund of the user's units (the global Neuron reservation is never refunded).
 *
 * The Neuron figures are ESTIMATES from catalogue prices. They protect the account's free allocation conservatively but
 * are not a billing guarantee; the request cap is the second, independent ceiling.
 */
import type { AiConfig, Units } from './config';

export const GLOBAL_SCOPE = '__all__';
/** Effective "no limit" for exempt accounts (they are still counted, for visibility). */
export const UNLIMITED = 2_000_000_000;
/** A 'reserved' ledger row older than this is a crashed request: a retry with the same key re-claims it without charging again. */
export const STALE_RESERVED_MS = 180_000;

export type QuotaDenied =
  | { ok: false; reason: 'burst' }
  | { ok: false; reason: 'user'; blocked: 'chat' | 'image'; remaining: Units }
  | { ok: false; reason: 'global-requests' };

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

/**
 * Charges `units` to the account's day row, and one request against the account-wide cap (UTC day, shared Workers AI
 * allocation). `unlimited` accounts get an effectively infinite per-account limit but are still counted.
 * Compensates the per-account charge when the global cap refuses.
 */
export async function reserveUnits(db: D1Database, cfg: AiConfig, userId: string, units: Units, userDay: string, globalDay: string, unlimited: boolean): Promise<{ ok: true } | QuotaDenied> {
  const limit = unlimited ? { chat: UNLIMITED, image: UNLIMITED } : cfg.userDaily;
  if (cfg.dailyRequestCap <= 0) return { ok: false, reason: 'global-requests' };
  const user = await db
    .prepare(
      `INSERT INTO ai_usage_daily (scope, day, chat, image, requests) SELECT ?1, ?2, ?3, ?4, 1 WHERE ?3 <= ?5 AND ?4 <= ?6
       ON CONFLICT(scope, day) DO UPDATE SET chat = chat + ?3, image = image + ?4, requests = requests + 1
         WHERE ai_usage_daily.chat + ?3 <= ?5 AND ai_usage_daily.image + ?4 <= ?6
       RETURNING chat, image`,
    )
    .bind(userId, userDay, units.chat, units.image, limit.chat, limit.image)
    .first<{ chat: number; image: number }>();
  if (!user) {
    const u = await db.prepare('SELECT chat, image FROM ai_usage_daily WHERE scope = ?1 AND day = ?2').bind(userId, userDay).first<{ chat: number; image: number }>();
    const remaining = { chat: Math.max(0, limit.chat - (u?.chat ?? 0)), image: Math.max(0, limit.image - (u?.image ?? 0)) };
    return { ok: false, reason: 'user', blocked: remaining.chat < units.chat ? 'chat' : 'image', remaining };
  }
  const global = await db
    .prepare(
      `INSERT INTO ai_usage_daily (scope, day, chat, image, requests) VALUES (?1, ?2, ?3, ?4, 1)
       ON CONFLICT(scope, day) DO UPDATE SET chat = chat + ?3, image = image + ?4, requests = requests + 1 WHERE ai_usage_daily.requests + 1 <= ?5
       RETURNING requests AS n`,
    )
    .bind(GLOBAL_SCOPE, globalDay, units.chat, units.image, cfg.dailyRequestCap)
    .first<{ n: number }>();
  if (!global) {
    await releaseUnits(db, userId, userDay, units);
    return { ok: false, reason: 'global-requests' };
  }
  return { ok: true };
}

/** Gives units back to the account's day row (never below zero). */
async function releaseUnits(db: D1Database, userId: string, day: string, units: Units): Promise<void> {
  await db
    .prepare(`UPDATE ai_usage_daily SET chat = MAX(0, chat - ?3), image = MAX(0, image - ?4), requests = MAX(0, requests - 1) WHERE scope = ?1 AND day = ?2`)
    .bind(userId, day, units.chat, units.image)
    .run();
}

/* ------------------------------------------------------------------ */
/* idempotency ledger                                                  */
/* ------------------------------------------------------------------ */

export type LedgerGate =
  /** No charge exists for this key: reserve units, then `recordReserved`. */
  | { action: 'charge'; existing: 'none' | 'refunded' }
  /** A crashed request holds the charge already: re-claimed, run without charging again. */
  | { action: 'reclaimed'; day: string }
  | { action: 'duplicate' }
  | { action: 'in-progress' };

interface LedgerRow {
  day: string;
  state: string;
  created_at: number;
}

export async function ledgerGate(db: D1Database, userId: string, key: string, now = Date.now()): Promise<LedgerGate> {
  const row = await db.prepare('SELECT day, state, created_at FROM ai_request_ledger WHERE user_id = ?1 AND request_id = ?2').bind(userId, key).first<LedgerRow>();
  if (!row) return { action: 'charge', existing: 'none' };
  if (row.state === 'done') return { action: 'duplicate' };
  if (row.state === 'refunded') return { action: 'charge', existing: 'refunded' };
  if (now - row.created_at < STALE_RESERVED_MS) return { action: 'in-progress' };
  // Stale 'reserved' (the Worker died mid-request after charging): compare-and-set the timestamp so only one retry wins.
  const won = await db.prepare(`UPDATE ai_request_ledger SET created_at = ?3 WHERE user_id = ?1 AND request_id = ?2 AND state = 'reserved' AND created_at = ?4`).bind(userId, key, now, row.created_at).run();
  return (won.meta?.changes ?? 0) > 0 ? { action: 'reclaimed', day: row.day } : { action: 'in-progress' };
}

/** After a successful charge: writes (or revives) the ledger row. false = lost a race for the same key (the caller releases its charge). */
export async function recordReserved(db: D1Database, userId: string, key: string, day: string, units: Units, existing: 'none' | 'refunded', now = Date.now()): Promise<boolean> {
  const res =
    existing === 'none'
      ? await db
          .prepare(`INSERT INTO ai_request_ledger (user_id, request_id, day, chat, image, state, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'reserved', ?6) ON CONFLICT(user_id, request_id) DO NOTHING`)
          .bind(userId, key, day, units.chat, units.image, now)
          .run()
      : await db
          .prepare(`UPDATE ai_request_ledger SET state = 'reserved', day = ?3, chat = ?4, image = ?5, created_at = ?6 WHERE user_id = ?1 AND request_id = ?2 AND state = 'refunded'`)
          .bind(userId, key, day, units.chat, units.image, now)
          .run();
  return (res.meta?.changes ?? 0) > 0;
}

/** The request produced a reply: its charge is final. */
export async function markDone(db: D1Database, userId: string, key: string): Promise<void> {
  await db.prepare(`UPDATE ai_request_ledger SET state = 'done' WHERE user_id = ?1 AND request_id = ?2 AND state = 'reserved'`).bind(userId, key).run();
}

/** Releases a charge that was taken but never recorded (lost race, or the key turned out to be a duplicate). */
export async function releaseCharge(db: D1Database, userId: string, day: string, units: Units): Promise<void> {
  await releaseUnits(db, userId, day, units);
}

/**
 * The request failed without producing a reply: give the user's units back, at most `maxPerDay` times per account per day
 * (a failing request still cost the shared Neuron budget, so refunds must not be farmable). Returns whether a refund happened.
 */
export async function refundRequest(db: D1Database, userId: string, key: string, maxPerDay: number): Promise<boolean> {
  const row = await db.prepare(`SELECT day, chat, image FROM ai_request_ledger WHERE user_id = ?1 AND request_id = ?2 AND state = 'reserved'`).bind(userId, key).first<{ day: string; chat: number; image: number }>();
  if (!row) return false;
  const cap = await db.prepare(`UPDATE ai_usage_daily SET refunds = refunds + 1 WHERE scope = ?1 AND day = ?2 AND refunds < ?3`).bind(userId, row.day, maxPerDay).run();
  if ((cap.meta?.changes ?? 0) === 0) return false;
  const flip = await db.prepare(`UPDATE ai_request_ledger SET state = 'refunded' WHERE user_id = ?1 AND request_id = ?2 AND state = 'reserved'`).bind(userId, key).run();
  if ((flip.meta?.changes ?? 0) === 0) {
    await db.prepare(`UPDATE ai_usage_daily SET refunds = MAX(0, refunds - 1) WHERE scope = ?1 AND day = ?2`).bind(userId, row.day).run();
    return false;
  }
  await releaseUnits(db, userId, row.day, { chat: row.chat, image: row.image });
  return true;
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
 * the full reservation is kept as "used": conservative by design. When the reported usage is HIGHER than the reservation
 * (the input estimate was low), the higher figure is recorded, so the budget is never under-counted.
 * `userDay` (Africa/Cairo) and `globalDay` (UTC) differ: per-account token totals live on the account's day row.
 */
export async function settle(db: D1Database, userId: string, userDay: string, globalDay: string, reserved: number, actual: number | null, tokensIn: number, tokensOut: number): Promise<void> {
  const used = actual === null ? reserved : actual;
  const release = reserved - used;
  await db.batch([
    db
      .prepare(`UPDATE ai_usage_daily SET neurons_reserved = neurons_reserved - ?3, neurons_used = neurons_used + ?4, tokens_in = tokens_in + ?5, tokens_out = tokens_out + ?6 WHERE scope = ?1 AND day = ?2`)
      .bind(GLOBAL_SCOPE, globalDay, release, used, tokensIn, tokensOut),
    db
      .prepare(
        `INSERT INTO ai_usage_daily (scope, day, neurons_used, tokens_in, tokens_out) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(scope, day) DO UPDATE SET neurons_used = neurons_used + ?3, tokens_in = tokens_in + ?4, tokens_out = tokens_out + ?5`,
      )
      .bind(userId, userDay, used, tokensIn, tokensOut),
  ]);
}

/** One counter as the app shows it. `limit`/`remaining` are null for exempt accounts. */
export interface QuotaCounter {
  used: number;
  limit: number | null;
  remaining: number | null;
}
export interface UsageView {
  unlimited: boolean;
  chat: QuotaCounter;
  image: QuotaCounter;
  globalExhausted: boolean;
}

export async function usageFor(db: D1Database, cfg: AiConfig, userId: string, userDay: string, globalDay: string, unlimited: boolean): Promise<UsageView> {
  const [u, g] = await Promise.all([
    db.prepare('SELECT chat, image FROM ai_usage_daily WHERE scope = ?1 AND day = ?2').bind(userId, userDay).first<{ chat: number; image: number }>(),
    db.prepare('SELECT requests, neurons_reserved FROM ai_usage_daily WHERE scope = ?1 AND day = ?2').bind(GLOBAL_SCOPE, globalDay).first<{ requests: number; neurons_reserved: number }>(),
  ]);
  const counter = (used: number, limit: number): QuotaCounter => (unlimited ? { used, limit: null, remaining: null } : { used, limit, remaining: Math.max(0, limit - used) });
  return {
    unlimited,
    chat: counter(u?.chat ?? 0, cfg.userDaily.chat),
    image: counter(u?.image ?? 0, cfg.userDaily.image),
    globalExhausted: !!g && (g.requests >= cfg.dailyRequestCap || g.neurons_reserved >= cfg.dailyNeuronBudget),
  };
}
