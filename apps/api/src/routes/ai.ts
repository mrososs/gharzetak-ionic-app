/**
 * Khayoota AI routes, mounted at /v1/ai behind the existing `requireUser` (signed-in users only; guests never reach them).
 *
 *   GET    /v1/ai/status    feature flags, consent state, today's remaining usage (no model call)
 *   PUT    /v1/ai/consent   accept the current consent version
 *   DELETE /v1/ai/consent   withdraw consent
 *   POST   /v1/ai/chat      crochet chat; photos only when AI_VISION_ENABLED
 *   POST   /v1/ai/extract   image/text → faithful transcript (NO stitch maths); only when AI_EXTRACT_ENABLED
 *
 * Request order: kill switch → access → consent → size-capped Zod body → feature flag → image magic bytes → burst window →
 * idempotency ledger → per-account daily units (chat 1 + images N, Africa/Cairo day) + global caps → upper-bound Neuron
 * reservation → model → output validation (+1 repair) → settle → ledger done (or a capped refund when no reply was produced).
 * Nothing about the conversation is stored or logged; only counters (see services/ai/quota.ts and log.ts).
 */
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppBindings } from '../env';
import { ApiError, badRequest } from '../errors';
import { aiConfig, nextQuotaReset, nextUtcMidnight, QUOTA_TZ, quotaDay, userAllowed, userUnlimited, utcDay, worstCaseNeurons, actualNeurons, type AiConfig, type AiKind, type Units } from '../services/ai/config';
import { AI_LIMITS, chatRequest, consentRequest, extractJson, extractRequest, modelReply, modelTranscript, toChatReply, toTranscript, type ChatReplyV1, type ChatRequest, type ExtractRequest, type InlineImage } from '../services/ai/contracts';
import { aiLog } from '../services/ai/log';
import { buildChatMessages, buildExtractMessages, estimateInputTokens, REPLY_JSON_SCHEMA, TRANSCRIPT_JSON_SCHEMA, type PromptMessage } from '../services/ai/prompts';
import { createProvider, ProviderError, type AiProvider, type ProviderRequest, type ProviderResult } from '../services/ai/provider';
import { ledgerGate, markDone, recordReserved, refundRequest, releaseCharge, reserveNeurons, reserveUnits, settle, takeBurst, usageFor, type UsageView } from '../services/ai/quota';
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

/** The quota as the app shows it (authoritative: read from D1). resetAt is null for exempt accounts (no countdown). */
function quotaPayload(cfg: AiConfig, u: UsageView, now = Date.now()) {
  return {
    unlimited: u.unlimited,
    timezone: QUOTA_TZ,
    chat: u.chat,
    image: u.image,
    resetAt: u.unlimited ? null : nextQuotaReset(now),
  };
}

/** Same numbers in the v1 shape older app builds read (remaining.extract = photo-pattern reads still possible). */
function legacyRemaining(u: UsageView) {
  const chat = u.chat.remaining ?? 999;
  const image = u.image.remaining ?? 999;
  return { chat, image, extract: Math.min(chat, image) };
}

async function usageBody(c: C, cfg: AiConfig, userDay: string, globalDay: string, unlimited: boolean) {
  const u = await usageFor(c.env.DB, cfg, c.get('userId'), userDay, globalDay, unlimited);
  return { remaining: legacyRemaining(u), resetAt: nextQuotaReset(), quota: quotaPayload(cfg, u) };
}

/** What one request costs: ONE chat message plus one image unit per image actually submitted. */
const unitsFor = (imageCount: number): Units => ({ chat: 1, image: imageCount });

interface Charge {
  /** Idempotency key (the client's, or a fresh one when none was sent). */
  key: string;
  /** Africa/Cairo quota day and UTC global day of this request. */
  day: string;
  gday: string;
  unlimited: boolean;
  units: Units;
}

/**
 * Burst window → idempotency ledger → per-account units + global request cap. Throws a typed API error when any refuses.
 * Everything that can be rejected for FORMAT reasons (kill switch, consent, size, flags, magic bytes) has already happened,
 * so an invalid request never costs quota.
 */
async function chargeRequest(c: C, cfg: AiConfig, units: Units, burst: number, clientKey: string | undefined): Promise<Charge> {
  const userId = c.get('userId');
  const now = Date.now();
  const day = quotaDay(now);
  const gday = utcDay(now);
  const key = clientKey ?? crypto.randomUUID();
  if (!(await takeBurst(c.env.DB, userId, burst, cfg.burstUnitsPerMinute))) {
    throw aiError(429, 'ai_rate_limited', 'Too many requests — try again in a minute', { retryAfterSec: 60 - Math.floor((Date.now() % 60_000) / 1000) });
  }
  const gate = await ledgerGate(c.env.DB, userId, key, now);
  if (gate.action === 'duplicate') throw aiError(409, 'ai_duplicate_request', 'This request was already processed and counted', { clientRequestId: key });
  if (gate.action === 'in-progress') throw aiError(409, 'ai_request_in_progress', 'This request is still being processed', { retryAfterSec: 5 });
  const unlimited = await userUnlimited(c.env.DB, cfg, userId);
  if (gate.action === 'reclaimed') return { key, day: gate.day, gday, unlimited, units, };
  const r = await reserveUnits(c.env.DB, cfg, userId, units, day, gday, unlimited);
  if (!r.ok) {
    if (r.reason === 'user') {
      throw aiError(429, 'ai_quota_exceeded', 'Daily Khayoota limit reached', {
        scope: 'user',
        kind: r.blocked,
        requested: units,
        remaining: { chat: r.remaining.chat, image: r.remaining.image, extract: Math.min(r.remaining.chat, r.remaining.image) },
        limits: cfg.userDaily,
        resetAt: nextQuotaReset(now),
      });
    }
    throw aiError(429, 'ai_quota_exceeded', 'Daily Khayoota limit reached', { scope: 'global', kind: units.image ? 'image' : 'chat', resetAt: nextUtcMidnight(now) });
  }
  if (!(await recordReserved(c.env.DB, userId, key, day, units, gate.existing, now))) {
    await releaseCharge(c.env.DB, userId, day, units);
    throw aiError(409, 'ai_request_in_progress', 'This request is still being processed', { retryAfterSec: 5 });
  }
  return { key, day, gday, unlimited, units };
}

/** Success keeps the charge (ledger 'done'); any failure that produced no reply gives the account's units back (capped per day). */
async function finishCharge(c: C, cfg: AiConfig, ch: Charge, ok: boolean): Promise<void> {
  try {
    if (ok) await markDone(c.env.DB, c.get('userId'), ch.key);
    else await refundRequest(c.env.DB, c.get('userId'), ch.key, cfg.maxRefundsPerDay);
  } catch {
    // Accounting trouble must never turn a delivered reply into an error; a stuck 'reserved' row only keeps the (conservative) charge.
  }
}

interface CallOutcome {
  result: ProviderResult;
  neurons: number;
}

/** One model call inside an upper-bound Neuron reservation; always settles, maps provider errors to typed API errors. */
async function callModel(c: C, cfg: AiConfig, provider: AiProvider, req: ProviderRequest, ch: Charge, route: string, kind: AiKind): Promise<CallOutcome> {
  const estIn = estimateInputTokens(req.messages);
  const reserved = worstCaseNeurons(req.model, estIn, req.maxOutputTokens);
  if (!(await reserveNeurons(c.env.DB, cfg.dailyNeuronBudget, ch.gday, reserved))) {
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
      await settle(c.env.DB, c.get('userId'), ch.day, ch.gday, reserved, actual, tIn, tOut);
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
      await settle(c.env.DB, c.get('userId'), ch.day, ch.gday, reserved, null, 0, 0);
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
  const now = Date.now();
  const unlimited = await userUnlimited(c.env.DB, cfg, c.get('userId'));
  const [accepted, usage] = await Promise.all([consentVersion(c.env.DB, c.get('userId')), usageFor(c.env.DB, cfg, c.get('userId'), quotaDay(now), utcDay(now), unlimited)]);
  return c.json({
    v: 1,
    enabled: true,
    /** 'fake' = deterministic demo replies; the app labels them as such. */
    provider: cfg.provider,
    features: cfg.features,
    consent: { version: cfg.consentVersion, accepted: accepted === cfg.consentVersion },
    // v1 fields (older builds read these): numeric limits/remaining. The authoritative, richer view is `quota`.
    limits: { chat: cfg.userDaily.chat, image: cfg.userDaily.image, extract: Math.min(cfg.userDaily.chat, cfg.userDaily.image) },
    remaining: legacyRemaining(usage),
    quota: quotaPayload(cfg, usage, now),
    available: !usage.globalExhausted,
    resetAt: nextQuotaReset(now),
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
  const ch = await chargeRequest(c, cfg, unitsFor(images.length), cfg.burstWeight.chat + cfg.burstWeight.imageEach * images.length, req.clientRequestId);
  try {
    return await runChat(c, cfg, provider, req, images, kind, ch);
  } catch (e) {
    await finishCharge(c, cfg, ch, false);
    throw e;
  }
});

async function runChat(c: C, cfg: AiConfig, provider: AiProvider, req: ChatRequest, images: InlineImage[], kind: AiKind, ch: Charge): Promise<Response> {
  const model = images.length ? cfg.models.vision : cfg.models.chat;
  const messages = buildChatMessages(req);
  const maxOutputTokens = images.length ? cfg.maxOutputTokens.image : cfg.maxOutputTokens.chat;
  const first = await callModel(c, cfg, provider, { model, messages, jsonSchema: REPLY_JSON_SCHEMA, schemaName: 'khayoota_reply', maxOutputTokens, temperature: 0.2, source: { purpose: 'chat', req } }, ch, 'chat', kind);

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
    const second = await callModel(c, cfg, provider, { model, messages: repairMessages, jsonSchema: REPLY_JSON_SCHEMA, schemaName: 'khayoota_reply', maxOutputTokens: cfg.maxOutputTokens.repair, temperature: 0, source: { purpose: 'repair', req } }, ch, 'chat-repair', kind);
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
  await finishCharge(c, cfg, ch, true);
  return c.json({ requestId: c.get('requestId'), reply, usage: await usageBody(c, cfg, ch.day, ch.gday, ch.unlimited) });
}

ai.post('/extract', async (c) => {
  const { cfg, provider } = await requireEnabled(c);
  await requireConsent(c, cfg);
  // Flag first: while extraction is off its (large) body is never read.
  if (!cfg.features.extract) throw aiError(403, 'ai_feature_disabled', 'Reading patterns from photos is not available yet', { feature: 'extract' });
  const req = await parseBody(c, extractRequest, AI_LIMITS.extractBodyBytes);
  const images = req.images ?? [];
  if (images.some((i) => !sniffImage(i))) throw aiError(415, 'ai_unsupported_image', 'Images must be JPEG, PNG or WebP');
  const ch = await chargeRequest(c, cfg, unitsFor(images.length), cfg.burstWeight.extract, req.clientRequestId);
  try {
    return await runExtract(c, cfg, provider, req, images, ch);
  } catch (e) {
    await finishCharge(c, cfg, ch, false);
    throw e;
  }
});

async function runExtract(c: C, cfg: AiConfig, provider: AiProvider, req: ExtractRequest, images: InlineImage[], ch: Charge): Promise<Response> {
  const model = cfg.models.extract;
  const messages = buildExtractMessages(req);
  const call = (msgs: PromptMessage[], purpose: 'extract' | 'repair', maxOutputTokens: number) =>
    callModel(c, cfg, provider, { model, messages: msgs, jsonSchema: TRANSCRIPT_JSON_SCHEMA, schemaName: 'pattern_transcript', maxOutputTokens, temperature: 0, timeoutMs: cfg.extractTimeoutMs, source: purpose === 'extract' ? { purpose, req } : { purpose: 'repair' } }, ch, purpose === 'extract' ? 'extract' : 'extract-repair', 'extract');
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
  await finishCharge(c, cfg, ch, true);
  return c.json({ requestId: c.get('requestId'), transcript, usage: await usageBody(c, cfg, ch.day, ch.gday, ch.unlimited) });
}
