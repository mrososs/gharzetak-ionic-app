/**
 * Khayoota AI — server-side configuration. Every value has a SAFE default: hosted AI off, fake provider, flags off,
 * small caps. The client never chooses a model or a limit.
 */
import type { AppEnv } from '../../env';

export const DEFAULT_MODEL = '@cf/google/gemma-4-26b-a4b-it';

export interface ModelInfo {
  /** 'openai' = chat.completion responses (choices[]); 'legacy' = { response, usage }. */
  readonly family: 'openai' | 'legacy';
  /** Neurons per million tokens (Workers AI pricing page, 2026-11-12). Used for UPPER-BOUND reservations. */
  readonly neuronsPerMIn: number;
  readonly neuronsPerMOut: number;
  /** Request extras: reasoning off (reasoning tokens are billed as output). */
  readonly extras: Record<string, unknown>;
}

/** Allowlisted models only. An env var naming anything else is ignored (falls back to DEFAULT_MODEL). */
export const MODELS: Readonly<Record<string, ModelInfo>> = {
  '@cf/google/gemma-4-26b-a4b-it': { family: 'openai', neuronsPerMIn: 9091, neuronsPerMOut: 27273, extras: { chat_template_kwargs: { enable_thinking: false } } },
  '@cf/qwen/qwen3.8-27b': { family: 'openai', neuronsPerMIn: 40909, neuronsPerMOut: 290909, extras: { reasoning_effort: 'low', chat_template_kwargs: { enable_thinking: false } } },
};

export type AiKind = 'chat' | 'image' | 'extract';
/** What a request costs the account's daily allowance: one chat message plus one image unit per image actually submitted. */
export interface Units {
  chat: number;
  image: number;
}

export interface AiConfig {
  enabled: boolean;
  provider: 'workers-ai' | 'fake';
  models: { chat: string; vision: string; extract: string };
  features: { chat: boolean; vision: boolean; extract: boolean };
  dailyNeuronBudget: number;
  dailyRequestCap: number;
  /** Per-account daily allowance (Africa/Cairo day). 'chat' = hosted AI requests, 'image' = individual images submitted. */
  userDaily: Units;
  /**
   * Accounts with NO application-level daily quota (verified e-mail, trusted D1 identity — never a client claim).
   * Burst limiter, global request/Neuron caps and the kill switch still apply to them.
   */
  unlimitedEmails: readonly string[];
  /** Max quota refunds per account per day for requests that produced no reply (provider failure), so failures cannot be farmed. */
  maxRefundsPerDay: number;
  burstUnitsPerMinute: number;
  burstWeight: { chat: number; imageEach: number; extract: number };
  consentVersion: number;
  /**
   * Who may use hosted AI. DENY ALL by default in a deployed environment: only accounts listed in AI_ALLOWED_EMAILS or
   * AI_ALLOWED_USER_IDS, and only while that account's e-mail is VERIFIED (read from D1 for the session's user id — never
   * from anything the client sends). '*' = every signed-in account. Local development/tests default to everyone.
   */
  access: { all: boolean; ids: readonly string[]; emails: readonly string[] };
  timeoutMs: number;
  /** Reading a full pattern page produces a long transcript: its own, longer ceiling (device finding: 45 s timed out). */
  extractTimeoutMs: number;
  maxOutputTokens: { chat: number; image: number; extract: number; repair: number };
}

const int = (v: string | undefined, d: number, min: number, max: number): number => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const model = (v: string | undefined): string => (v && v in MODELS ? v : DEFAULT_MODEL);
const list = (v: string | undefined): string[] =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);
const accessList = (env: AppEnv): AiConfig['access'] => {
  const ids = list(env.AI_ALLOWED_USER_IDS);
  const emails = list(env.AI_ALLOWED_EMAILS).map((e) => e.toLowerCase());
  if (ids.includes('*') || emails.includes('*')) return { all: true, ids: [], emails: [] };
  if (ids.length || emails.length) return { all: false, ids, emails };
  const local = env.ENVIRONMENT === 'development' || env.ENVIRONMENT === 'test';
  return { all: local, ids: [], emails: [] };
};

/**
 * Server-side decision: is this SESSION user exempt from the daily AI quotas? Same trust model as userAllowed: the e-mail is read
 * from D1 for the session's user id, must be VERIFIED (Google sign-in verifies it; an e-mail/password sign-up without
 * verification never qualifies, so nobody can claim the address by registering it), and is compared case-insensitively after trimming.
 * Nothing the client sends (body, header, flag) is consulted.
 */
export async function userUnlimited(db: D1Database, cfg: Pick<AiConfig, 'unlimitedEmails'>, userId: string): Promise<boolean> {
  if (!cfg.unlimitedEmails.length) return false;
  const row = await db.prepare('SELECT email, email_verified FROM user WHERE id = ?1').bind(userId).first<{ email: string; email_verified: number }>();
  if (!row || !row.email_verified) return false;
  return cfg.unlimitedEmails.includes(row.email.trim().toLowerCase());
}

/**
 * Server-side access decision for the SESSION's user id (set by requireUser from the validated Better Auth session).
 * An explicit match additionally needs a verified e-mail. No request field or header can influence this.
 */
export async function userAllowed(db: D1Database, cfg: Pick<AiConfig, 'access'>, userId: string): Promise<boolean> {
  const a = cfg.access;
  if (a.all) return true;
  if (!a.ids.length && !a.emails.length) return false;
  const row = await db.prepare('SELECT email, email_verified FROM user WHERE id = ?1').bind(userId).first<{ email: string; email_verified: number }>();
  if (!row || !row.email_verified) return false;
  return a.ids.includes(userId) || a.emails.includes(row.email.trim().toLowerCase());
}

export function aiConfig(env: AppEnv): AiConfig {
  return {
    enabled: env.AI_ENABLED === 'true',
    provider: env.AI_PROVIDER === 'workers-ai' ? 'workers-ai' : 'fake',
    models: { chat: model(env.AI_MODEL_CHAT), vision: model(env.AI_MODEL_VISION), extract: model(env.AI_MODEL_EXTRACT) },
    features: { chat: true, vision: env.AI_VISION_ENABLED === 'true', extract: env.AI_EXTRACT_ENABLED === 'true' },
    // 8,000 leaves headroom under the 10,000 free Neurons/day for anything else on the account.
    dailyNeuronBudget: int(env.AI_DAILY_NEURON_BUDGET, 8000, 0, 10_000_000),
    dailyRequestCap: int(env.AI_DAILY_REQUEST_CAP, 300, 0, 1_000_000),
    userDaily: { chat: int(env.AI_USER_DAILY_CHAT, 10, 0, 1000), image: int(env.AI_USER_DAILY_IMAGE, 5, 0, 1000) },
    unlimitedEmails: list(env.AI_UNLIMITED_EMAILS).map((e) => e.toLowerCase()).filter((e) => e !== '*').slice(0, 20),
    maxRefundsPerDay: int(env.AI_USER_DAILY_REFUNDS, 3, 0, 100),
    burstUnitsPerMinute: int(env.AI_BURST_UNITS_PER_MINUTE, 20, 1, 10_000),
    burstWeight: { chat: 1, imageEach: 3, extract: 6 },
    consentVersion: int(env.AI_CONSENT_VERSION, 1, 1, 1000),
    access: accessList(env),
    timeoutMs: int(env.AI_TIMEOUT_MS, 45_000, 1000, 120_000),
    extractTimeoutMs: int(env.AI_EXTRACT_TIMEOUT_MS, 120_000, 1000, 140_000),
    // extract 4000: a dense page is ~60 lines of Arabic plus JSON fields (2500 truncated the JSON).
    maxOutputTokens: { chat: 600, image: 700, extract: 4000, repair: 600 },
  };
}

/**
 * Per-account quota day: the calendar date in Africa/Cairo (Egypt observes DST again since 2023, so the offset is +02:00 or +03:00 and
 * is taken from the platform's tz database, never hard-coded). Counters roll over when this key changes.
 */
export const QUOTA_TZ = 'Africa/Cairo';
const quotaFmt = new Intl.DateTimeFormat('en-US', { timeZone: QUOTA_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
export const quotaDay = (now = Date.now()): string => {
  const p = Object.fromEntries(quotaFmt.formatToParts(now).map((x) => [x.type, x.value]));
  return `${p['year']}-${p['month']}-${p['day']}`;
};
/**
 * The first instant at which quotaDay() changes (an ISO string). Found by bisection on the date key, so it is right on the
 * DST days too: on the spring day local 00:00 does not exist (the day starts at 01:00 local), on the autumn day 23:00-24:00 happens twice.
 */
export const nextQuotaReset = (now = Date.now()): string => {
  const today = quotaDay(now);
  let lo = now;
  let hi = now + 26 * 3_600_000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (quotaDay(mid) === today) lo = mid;
    else hi = mid;
  }
  return new Date(hi).toISOString();
};

/** UTC day key: Workers AI's free allocation resets at 00:00 UTC, so the ACCOUNT-WIDE caps (global requests, Neurons) do too. */
export const utcDay = (now = Date.now()): string => new Date(now).toISOString().slice(0, 10);
export const nextUtcMidnight = (now = Date.now()): string => {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
};

/** Upper-bound Neurons for one call: estimated input + the full output allowance. */
export function worstCaseNeurons(modelId: string, inputTokens: number, maxOutputTokens: number): number {
  const m = MODELS[modelId] ?? MODELS[DEFAULT_MODEL]!;
  return Math.ceil((inputTokens * m.neuronsPerMIn + maxOutputTokens * m.neuronsPerMOut) / 1e6);
}
export function actualNeurons(modelId: string, tokensIn: number, tokensOut: number): number {
  const m = MODELS[modelId] ?? MODELS[DEFAULT_MODEL]!;
  return Math.ceil((tokensIn * m.neuronsPerMIn + tokensOut * m.neuronsPerMOut) / 1e6);
}
