/**
 * Khayoota AI routes, mounted at /v1/ai behind the existing `requireUser` (signed-in users only; guests never reach them).
 *
 *   GET    /v1/ai/status    feature flags, consent state, today's remaining usage (no model call)
 *   PUT    /v1/ai/consent   accept the current consent version
 *   DELETE /v1/ai/consent   withdraw consent
 *   POST   /v1/ai/chat      crochet chat; photos only when AI_VISION_ENABLED
 *   POST   /v1/ai/extract   image/text → faithful transcript (NO stitch maths); only when AI_EXTRACT_ENABLED
 *
 * Request order: kill switch → consent → size-capped Zod body → feature flag → image magic bytes → burst window →
 * per-user + global daily caps → upper-bound Neuron reservation → model → output validation (+1 repair) → settle.
 * Nothing about the conversation is stored or logged; only counters (see services/ai/quota.ts and log.ts).
 */
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppBindings } from '../env';
import { ApiError, badRequest } from '../errors';
import { aiConfig, nextUtcMidnight, userAllowed, utcDay, worstCaseNeurons, actualNeurons, type AiConfig, type AiKind } from '../services/ai/config';
import { AI_LIMITS, chatRequest, consentRequest, extractJson, extractRequest, modelReply, modelTranscript, toChatReply, toTranscript, type ChatReplyV1, type InlineImage } from '../services/ai/contracts';
import { aiLog } from '../services/ai/log';
import { buildChatMessages, buildExtractMessages, estimateInputTokens, REPLY_JSON_SCHEMA, TRANSCRIPT_JSON_SCHEMA, type PromptMessage } from '../services/ai/prompts';
import { createProvider, ProviderError, type AiProvider, type ProviderRequest, type ProviderResult } from '../services/ai/provider';
import { reserveNeurons, reserveRequest, settle, takeBurst, usageFor } from '../services/ai/quota';
import { parseBody } from '../validators';

type C = Context<AppBindings>;

const aiError = (status: ContentfulStatusCode, code: string, message: string, extra?: Record<string, unknown>) => new ApiError(status, code, message, undefined, extra);

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Magic-byte check on the first bytes only: the Worker never decodes a whole image. */
export function sniffImage(img: InlineImage): boolean {
  let head: string;
  try {
    head = atob(img.data.slice(0, 24));
  } catch {
    return false;
  }
  const b = (i: number) => head.charCodeAt(i);
  if (img.mime === 'image/jpeg') return b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff;
  if (img.mime === 'image/png') return b(0) === 0x89 && head.slice(1, 4) === 'PNG';
  if (img.mime === 'image/webp') return head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP';
  return false;
}

async function consentVersion(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare('SELECT consent_version FROM ai_user_state WHERE user_id = ?1').bind(userId).first<{ consent_version: number }>();
  return row?.consent_version ?? 0;
}

/** Kill switch → provider → per-account access (deny-all allowlist). Runs before consent, body parsing, quotas or any model call. */
async function requireEnabled(c: C): Promise<{ cfg: AiConfig; provider: AiProvider }> {
  const cfg = aiConfig(c.env);
  if (!cfg.enabled) throw aiError(503, 'ai_disabled', 'Khayoota is not available right now');
  const provider = createProvider(c.env, cfg);
  if (!provider) throw aiError(503, 'ai_disabled', 'Khayoota is not configured');
  if (!(await userAllowed(c.env.DB, cfg, c.get('userId')))) throw aiError(403, 'ai_access_restricted', 'Khayoota AI is not available for this account yet');
  return { cfg, provider };
}

async function requireConsent(c: C, cfg: AiConfig): Promise<void> {
  if ((await consentVersion(c.env.DB, c.get('userId'))) !== cfg.consentVersion) throw aiError(403, 'ai_consent_required', 'Consent is required before using Khayoota', { consentVersion: cfg.consentVersion });
}

async function takeQuota(c: C, cfg: AiConfig, kind: AiKind, day: string): Promise<void> {
  const userId = c.get('userId');
  if (!(await takeBurst(c.env.DB, userId, cfg.burstWeight[kind], cfg.burstUnitsPerMinute))) {
    throw aiError(429, 'ai_rate_limited', 'Too many requests — try again in a minute', { retryAfterSec: 60 - Math.floor((Date.now() % 60_000) / 1000) });
  }
  const r = await reserveRequest(c.env.DB, cfg, userId, kind, day);
  if (!r.ok) throw aiError(429, 'ai_quota_exceeded', 'Daily Khayoota limit reached', { scope: r.reason === 'user' ? 'user' : 'global', kind, resetAt: nextUtcMidnight() });
}

interface CallOutcome {
  result: ProviderResult;
  neurons: number;
}

/** One model call inside an upper-bound Neuron reservation; always settles, maps provider errors to typed API errors. */
async function callModel(c: C, cfg: AiConfig, provider: AiProvider, req: ProviderRequest, day: string, route: string, kind: AiKind): Promise<CallOutcome> {
  const estIn = estimateInputTokens(req.messages);
  const reserved = worstCaseNeurons(req.model, estIn, req.maxOutputTokens);
  if (!(await reserveNeurons(c.env.DB, cfg.dailyNeuronBudget, day, reserved))) {
    throw aiError(429, 'ai_quota_exceeded', 'Khayoota is resting until tomorrow', { scope: 'global', kind, resetAt: nextUtcMidnight() });
  }
  const started = Date.now();
  const base = { requestId: c.get('requestId'), route, kind, model: req.model, provider: provider.id };
  let attempt = 0;
  for (;;) {
    try {
      const result = await provider.generate(req);
      const tIn = result.usage.input ?? 0;
      const tOut = result.usage.output ?? 0;
      const actual = result.usage.input !== null && result.usage.output !== null ? actualNeurons(req.model, tIn, tOut) : null;
      await settle(c.env.DB, c.get('userId'), day, reserved, actual, tIn, tOut);
      aiLog({ ...base, status: 200, latencyMs: Date.now() - started, tokensIn: tIn, tokensOut: tOut, neurons: actual ?? reserved });
      return { result, neurons: actual ?? reserved };
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError('upstream', null);
      // Bounded: ONE retry, only for capacity errors.
      if (err.kind === 'capacity' && attempt === 0) {
        attempt++;
        await new Promise((r) => setTimeout(r, 400));
        continue;
      }
      await settle(c.env.DB, c.get('userId'), day, reserved, null, 0, 0);
      aiLog({ ...base, status: 'error', code: err.providerCode ?? err.kind, latencyMs: Date.now() - started });
      if (err.kind === 'quota') throw aiError(429, 'ai_quota_exceeded', 'Khayoota is resting until tomorrow', { scope: 'global', kind, resetAt: nextUtcMidnight() });
      if (err.kind === 'capacity') throw aiError(503, 'ai_busy', 'Khayoota is busy — try again shortly');
      if (err.kind === 'timeout') throw aiError(504, 'ai_timeout', 'Khayoota took too long — try again');
      if (err.kind === 'retired' || err.kind === 'paid-only') throw aiError(503, 'ai_disabled', 'Khayoota is not available right now');
      throw aiError(502, 'ai_upstream_error', 'Khayoota could not answer — try again');
    }
  }
}

const REPAIR = 'Your previous output was not one valid JSON object of the required shape. Reply again with ONLY that JSON object, no other text.';

async function remaining(c: C, cfg: AiConfig, day: string) {
  const u = await usageFor(c.env.DB, cfg, c.get('userId'), day);
  return { remaining: u.remaining, resetAt: nextUtcMidnight() };
}

/* ------------------------------------------------------------------ */
/* routes                                                              */
/* ------------------------------------------------------------------ */

export const ai = new Hono<AppBindings>();

ai.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});

ai.get('/status', async (c) => {
  const cfg = aiConfig(c.env);
  if (!cfg.enabled || !createProvider(c.env, cfg)) return c.json({ v: 1, enabled: false });
  // Hosted AI is on, but not for this account: the app shows "coming soon" and never calls chat/extract.
  if (!(await userAllowed(c.env.DB, cfg, c.get('userId')))) return c.json({ v: 1, enabled: false, access: 'restricted' });
  const day = utcDay();
  const [accepted, usage] = await Promise.all([consentVersion(c.env.DB, c.get('userId')), usageFor(c.env.DB, cfg, c.get('userId'), day)]);
  return c.json({
    v: 1,
    enabled: true,
    /** 'fake' = deterministic demo replies; the app labels them as such. */
    provider: cfg.provider,
    features: cfg.features,
    consent: { version: cfg.consentVersion, accepted: accepted === cfg.consentVersion },
    limits: cfg.userDaily,
    remaining: usage.remaining,
    available: !usage.globalExhausted,
    resetAt: nextUtcMidnight(),
  });
});

ai.put('/consent', async (c) => {
  const { cfg } = await requireEnabled(c);
  const body = await parseBody(c, consentRequest, 1024);
  if (body.version !== cfg.consentVersion) throw badRequest('Outdated consent version', [{ path: 'version', message: `current version is ${cfg.consentVersion}` }]);
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO ai_user_state (user_id, consent_version, consent_at, updated_at) VALUES (?1, ?2, ?3, ?3)
     ON CONFLICT(user_id) DO UPDATE SET consent_version = ?2, consent_at = ?3, updated_at = ?3`,
  )
    .bind(c.get('userId'), body.version, now)
    .run();
  return c.json({ accepted: true, version: body.version });
});

ai.delete('/consent', async (c) => {
  await c.env.DB.prepare('UPDATE ai_user_state SET consent_version = 0, updated_at = ?2 WHERE user_id = ?1').bind(c.get('userId'), Date.now()).run();
  return c.body(null, 204);
});

ai.post('/chat', async (c) => {
  const { cfg, provider } = await requireEnabled(c);
  await requireConsent(c, cfg);
  // With photos off, a text-only body is small: refuse big bodies before reading/parsing them (Worker CPU limit).
  const req = await parseBody(c, chatRequest, cfg.features.vision ? AI_LIMITS.chatBodyBytes : AI_LIMITS.chatTextBodyBytes);
  const images = req.images ?? [];
  if (images.length && !cfg.features.vision) throw aiError(403, 'ai_feature_disabled', 'Photo questions are not available yet', { feature: 'vision' });
  if (images.some((i) => !sniffImage(i))) throw aiError(415, 'ai_unsupported_image', 'Images must be JPEG, PNG or WebP');
  const kind: AiKind = images.length ? 'image' : 'chat';
  const day = utcDay();
  await takeQuota(c, cfg, kind, day);

  const model = images.length ? cfg.models.vision : cfg.models.chat;
  const messages = buildChatMessages(req);
  const maxOutputTokens = images.length ? cfg.maxOutputTokens.image : cfg.maxOutputTokens.chat;
  const first = await callModel(c, cfg, provider, { model, messages, jsonSchema: REPLY_JSON_SCHEMA, schemaName: 'khayoota_reply', maxOutputTokens, temperature: 0.2, source: { purpose: 'chat', req } }, day, 'chat', kind);

  let reply: ChatReplyV1 | null = null;
  let repaired = false;
  let modelActions = 0;
  const tryParse = (text: string) => {
    try {
      const parsed = modelReply.parse(extractJson(text));
      modelActions = parsed.actions?.length ?? 0;
      return toChatReply(parsed, req.context, req.lang);
    } catch {
      return null;
    }
  };
  reply = tryParse(first.result.text);
  if (!reply) {
    const repairMessages: PromptMessage[] = [...messages, { role: 'assistant', content: first.result.text.slice(0, 2000) }, { role: 'user', content: REPAIR }];
    const second = await callModel(c, cfg, provider, { model, messages: repairMessages, jsonSchema: REPLY_JSON_SCHEMA, schemaName: 'khayoota_reply', maxOutputTokens: cfg.maxOutputTokens.repair, temperature: 0, source: { purpose: 'repair', req } }, day, 'chat-repair', kind);
    reply = tryParse(second.result.text);
    repaired = !!reply;
    if (!reply) {
      // Prose without any JSON: show the text, no actions, clearly marked degraded. Anything else is refused.
      const prose = second.result.text.includes('{') ? first.result.text : second.result.text;
      if (prose.includes('{') || !prose.trim()) throw aiError(502, 'ai_bad_output', 'Khayoota could not answer — try again');
      reply = { v: 1, lang: req.lang, text: prose.replace(/<[^>]{0,200}>/g, '').trim().slice(0, AI_LIMITS.replyTextChars), actions: [], degraded: true };
    }
  }
  aiLog({ requestId: c.get('requestId'), route: 'chat', kind, status: 'reply', degraded: reply.degraded, repaired, actions: reply.actions.length, modelActions, scope: reply.outOfScope ? 'out' : 'in', images: images.length });
  return c.json({ requestId: c.get('requestId'), reply, usage: await remaining(c, cfg, day) });
});

ai.post('/extract', async (c) => {
  const { cfg, provider } = await requireEnabled(c);
  await requireConsent(c, cfg);
  // Flag first: while extraction is off its (large) body is never read.
  if (!cfg.features.extract) throw aiError(403, 'ai_feature_disabled', 'Reading patterns from photos is not available yet', { feature: 'extract' });
  const req = await parseBody(c, extractRequest, AI_LIMITS.extractBodyBytes);
  const images = req.images ?? [];
  if (images.some((i) => !sniffImage(i))) throw aiError(415, 'ai_unsupported_image', 'Images must be JPEG, PNG or WebP');
  const day = utcDay();
  await takeQuota(c, cfg, 'extract', day);

  const model = cfg.models.extract;
  const messages = buildExtractMessages(req);
  const call = (msgs: PromptMessage[], purpose: 'extract' | 'repair', maxOutputTokens: number) =>
    callModel(c, cfg, provider, { model, messages: msgs, jsonSchema: TRANSCRIPT_JSON_SCHEMA, schemaName: 'pattern_transcript', maxOutputTokens, temperature: 0, source: purpose === 'extract' ? { purpose, req } : { purpose: 'repair' } }, day, purpose === 'extract' ? 'extract' : 'extract-repair', 'extract');
  const parse = (text: string) => {
    try {
      return toTranscript(modelTranscript.parse(extractJson(text)));
    } catch {
      return null;
    }
  };
  const first = await call(messages, 'extract', cfg.maxOutputTokens.extract);
  let transcript = parse(first.result.text);
  if (!transcript) {
    const second = await call([...messages, { role: 'assistant', content: first.result.text.slice(0, 4000) }, { role: 'user', content: REPAIR }], 'repair', cfg.maxOutputTokens.extract);
    transcript = parse(second.result.text);
  }
  if (!transcript) throw aiError(502, 'ai_bad_output', 'Khayoota could not read this — try a clearer photo');
  aiLog({ requestId: c.get('requestId'), route: 'extract', kind: 'extract', status: 'transcript', images: images.length });
  return c.json({ requestId: c.get('requestId'), transcript, usage: await remaining(c, cfg, day) });
});
