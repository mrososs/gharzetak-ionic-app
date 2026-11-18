// Minimal Workers AI REST client for the CONTROLLED benchmark only (never used by app code or ordinary tests).
// Same request shape as the Worker binding (`env.AI.run(model, inputs)`), so results carry over to production.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Workers AI bills $0.011 per 1,000 Neurons (pricing page, 2026-11-12) → Neurons per USD. */
export const NEURONS_PER_USD = 1000 / 0.011;

/** Per-model request extras. Reasoning is switched off / to low: reasoning tokens are billed as output. */
export const MODEL_PROFILES = {
  '@cf/google/gemma-4-26b-a4b-it': { family: 'openai', extras: { chat_template_kwargs: { enable_thinking: false } } },
  '@cf/qwen/qwen3.8-27b': { family: 'openai', extras: { reasoning_effort: 'low', chat_template_kwargs: { enable_thinking: false } } },
  '@cf/meta/llama-4-scout-17b-16e-instruct': { family: 'legacy', extras: {} },
  '@cf/mistralai/mistral-small-3.1-24b-instruct': { family: 'legacy', extras: {} },
};

/**
 * Reads the OAuth token of the already-authenticated Wrangler login (scope `ai (write)`), in memory only.
 * The token is never printed, written to disk or logged.
 */
export function wranglerToken(wranglerJs) {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  if (!wranglerJs || !existsSync(wranglerJs)) throw new Error('No CLOUDFLARE_API_TOKEN and no --wrangler path to an authenticated wrangler.js');
  const raw = execFileSync(process.execPath, [wranglerJs, 'auth', 'token', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const json = JSON.parse(raw.slice(raw.indexOf('{')));
  const token = json.token ?? json.accessToken ?? json.access_token;
  if (!token) throw new Error('wrangler auth token returned no token');
  return token;
}

/** Normalises the two response families into { text, usage, finish }. */
export function normalizeResult(result) {
  if (result && Array.isArray(result.choices)) {
    const c = result.choices[0] ?? {};
    return {
      text: c.message?.content ?? '',
      reasoning: c.message?.reasoning_content ?? c.message?.reasoning ?? null,
      finish: c.finish_reason ?? null,
      usage: { input: result.usage?.prompt_tokens ?? null, output: result.usage?.completion_tokens ?? null, reasoning: result.usage?.completion_tokens_details?.reasoning_tokens ?? null },
    };
  }
  const text = typeof result?.response === 'string' ? result.response : result?.response !== undefined ? JSON.stringify(result.response) : '';
  return { text, reasoning: null, finish: null, usage: { input: result?.usage?.prompt_tokens ?? null, output: result?.usage?.completion_tokens ?? null, reasoning: null } };
}

/** One inference. Returns { ok, status, code, latencyMs, raw, ...normalized } — never throws for API errors. */
export async function runModel({ account, token, model, inputs, timeoutMs = 90_000 }) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(inputs),
      signal: ctrl.signal,
    });
    const latencyMs = Date.now() - started;
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) {
      const err = body?.errors?.[0] ?? {};
      return { ok: false, status: res.status, code: err.code ?? null, message: String(err.message ?? res.statusText).slice(0, 300), latencyMs };
    }
    return { ok: true, status: res.status, code: null, latencyMs, raw: body.result, ...normalizeResult(body.result) };
  } catch (e) {
    return { ok: false, status: 0, code: e.name === 'AbortError' ? 'timeout' : 'network', message: String(e.message).slice(0, 200), latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/** Estimated Neurons from token usage and the catalogue's per-token price. */
export function estimateNeurons(modelCfg, usage) {
  if (usage?.input == null || usage?.output == null) return null;
  return ((usage.input * modelCfg.usdPerMInput + usage.output * modelCfg.usdPerMOutput) / 1e6) * NEURONS_PER_USD;
}
