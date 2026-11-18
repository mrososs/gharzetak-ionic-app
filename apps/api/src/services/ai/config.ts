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

export interface AiConfig {
  enabled: boolean;
  provider: 'workers-ai' | 'fake';
  models: { chat: string; vision: string; extract: string };
  features: { chat: boolean; vision: boolean; extract: boolean };
  dailyNeuronBudget: number;
  dailyRequestCap: number;
  userDaily: Record<AiKind, number>;
  burstUnitsPerMinute: number;
  burstWeight: Record<AiKind, number>;
  consentVersion: number;
  /**
   * Who may use hosted AI: '*' = every signed-in account, otherwise an explicit list of user ids. FAIL-CLOSED: in a deployed
   * environment an unset/empty AI_ALLOWED_USER_IDS means NOBODY; only local development/tests default to everyone.
   */
  allowedUsers: '*' | readonly string[];
  timeoutMs: number;
  maxOutputTokens: { chat: number; image: number; extract: number; repair: number };
}

const int = (v: string | undefined, d: number, min: number, max: number): number => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const model = (v: string | undefined): string => (v && v in MODELS ? v : DEFAULT_MODEL);
const allowList = (v: string | undefined, environment: string | undefined): '*' | readonly string[] => {
  const raw = (v ?? '').trim();
  if (raw === '*') return '*';
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);
  if (ids.length) return ids;
  return environment === 'development' || environment === 'test' ? '*' : [];
};
export const userAllowed = (cfg: Pick<AiConfig, 'allowedUsers'>, userId: string): boolean => cfg.allowedUsers === '*' || cfg.allowedUsers.includes(userId);

export function aiConfig(env: AppEnv): AiConfig {
  return {
    enabled: env.AI_ENABLED === 'true',
    provider: env.AI_PROVIDER === 'workers-ai' ? 'workers-ai' : 'fake',
    models: { chat: model(env.AI_MODEL_CHAT), vision: model(env.AI_MODEL_VISION), extract: model(env.AI_MODEL_EXTRACT) },
    features: { chat: true, vision: env.AI_VISION_ENABLED === 'true', extract: env.AI_EXTRACT_ENABLED === 'true' },
    // 8,000 leaves headroom under the 10,000 free Neurons/day for anything else on the account.
    dailyNeuronBudget: int(env.AI_DAILY_NEURON_BUDGET, 8000, 0, 10_000_000),
    dailyRequestCap: int(env.AI_DAILY_REQUEST_CAP, 300, 0, 1_000_000),
    userDaily: { chat: int(env.AI_USER_DAILY_CHAT, 20, 0, 1000), image: int(env.AI_USER_DAILY_IMAGE, 5, 0, 1000), extract: int(env.AI_USER_DAILY_EXTRACT, 3, 0, 1000) },
    burstUnitsPerMinute: int(env.AI_BURST_UNITS_PER_MINUTE, 20, 1, 10_000),
    burstWeight: { chat: 1, image: 3, extract: 6 },
    consentVersion: int(env.AI_CONSENT_VERSION, 1, 1, 1000),
    allowedUsers: allowList(env.AI_ALLOWED_USER_IDS, env.ENVIRONMENT),
    timeoutMs: int(env.AI_TIMEOUT_MS, 45_000, 1000, 120_000),
    maxOutputTokens: { chat: 600, image: 700, extract: 2500, repair: 600 },
  };
}

/** UTC day key: Workers AI's free allocation resets at 00:00 UTC, so the caps do too. */
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
