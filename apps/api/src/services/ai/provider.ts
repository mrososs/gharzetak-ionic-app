/**
 * Khayoota AI — provider adapter.
 *
 *  - WorkersAiProvider: `env.AI.run(model, inputs)` (only when AI_PROVIDER=workers-ai AND the binding exists).
 *  - FakeAiProvider: deterministic, offline. DEFAULT for local development and every automated test — ordinary tests can
 *    therefore never reach a real model (Wrangler's local mode would otherwise bill Workers AI).
 *
 * Errors are classified, never passed through: the route maps them to typed API errors.
 */
import type { ChatRequest, ExtractRequest } from './contracts';
import { MODELS, type AiConfig } from './config';
import type { PromptMessage } from './prompts';

export interface ProviderRequest {
  model: string;
  messages: PromptMessage[];
  jsonSchema: object;
  schemaName: string;
  maxOutputTokens: number;
  temperature: number;
  /** The validated request (used ONLY by the fake provider to build a deterministic reply). */
  source: { purpose: 'chat'; req: ChatRequest } | { purpose: 'extract'; req: ExtractRequest } | { purpose: 'repair'; req?: ChatRequest };
}

export interface ProviderResult {
  text: string;
  usage: { input: number | null; output: number | null };
  finish: string | null;
}

export type ProviderErrorKind = 'quota' | 'capacity' | 'retired' | 'paid-only' | 'timeout' | 'bad-request' | 'upstream';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    readonly providerCode: number | null,
  ) {
    super(`provider ${kind}${providerCode ? ` (${providerCode})` : ''}`);
  }
}

export interface AiProvider {
  readonly id: 'workers-ai' | 'fake';
  generate(req: ProviderRequest): Promise<ProviderResult>;
}

/** Workers AI error codes (https://developers.cloudflare.com/workers-ai/platform/errors/). */
export function classify(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  const code = Number(/\b(3036|3040|5028|5035|8007|3007|3008)\b/.exec(msg)?.[1] ?? NaN);
  if (code === 3036) return new ProviderError('quota', code);
  if (code === 3040) return new ProviderError('capacity', code);
  if (code === 5028) return new ProviderError('retired', code);
  if (code === 5035) return new ProviderError('paid-only', code);
  if (code === 8007) return new ProviderError('bad-request', code);
  if (code === 3007 || code === 3008 || /timeout|timed out/i.test(msg)) return new ProviderError('timeout', Number.isFinite(code) ? code : null);
  return new ProviderError('upstream', null);
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ProviderError('timeout', null)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });

type RawResult = {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  response?: unknown;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export function normalize(raw: unknown): ProviderResult {
  const r = (raw ?? {}) as RawResult;
  if (Array.isArray(r.choices)) {
    const c = r.choices[0] ?? {};
    return { text: c.message?.content ?? '', finish: c.finish_reason ?? null, usage: { input: r.usage?.prompt_tokens ?? null, output: r.usage?.completion_tokens ?? null } };
  }
  const text = typeof r.response === 'string' ? r.response : r.response !== undefined ? JSON.stringify(r.response) : '';
  return { text, finish: null, usage: { input: r.usage?.prompt_tokens ?? null, output: r.usage?.completion_tokens ?? null } };
}

export class WorkersAiProvider implements AiProvider {
  readonly id = 'workers-ai' as const;
  constructor(
    private readonly ai: Ai,
    private readonly timeoutMs: number,
  ) {}

  async generate(req: ProviderRequest): Promise<ProviderResult> {
    const info = MODELS[req.model];
    if (!info) throw new ProviderError('bad-request', null);
    const response_format =
      info.family === 'openai' ? { type: 'json_schema', json_schema: { name: req.schemaName, schema: req.jsonSchema, strict: false } } : { type: 'json_schema', json_schema: req.jsonSchema };
    const inputs = { messages: req.messages, max_tokens: req.maxOutputTokens, temperature: req.temperature, response_format, ...info.extras };
    try {
      // The model id is server-allowlisted (MODELS); the binding's generic typing does not know newer ids.
      const run = this.ai.run.bind(this.ai) as unknown as (model: string, inputs: unknown) => Promise<unknown>;
      return normalize(await withTimeout(run(req.model, inputs), this.timeoutMs));
    } catch (e) {
      throw classify(e);
    }
  }
}

/* ------------------------------------------------------------------ */
/* fake provider                                                       */
/* ------------------------------------------------------------------ */

const est = (s: string) => Math.ceil(s.length / 3);

/** Test triggers (only meaningful with the fake provider). */
export const FAKE_TRIGGERS = {
  badJson: '__fake_bad_json__',
  prose: '__fake_prose__',
  unknownAction: '__fake_unknown_action__',
  foreignId: '__fake_foreign_id__',
  quota: '__fake_3036__',
  capacity: '__fake_3040__',
  timeout: '__fake_timeout__',
} as const;

export class FakeAiProvider implements AiProvider {
  readonly id = 'fake' as const;
  /** Number of calls (tests assert that rejected requests never reach the provider). */
  static calls = 0;

  async generate(req: ProviderRequest): Promise<ProviderResult> {
    FakeAiProvider.calls++;
    const inTok = est(JSON.stringify(req.messages).replace(/data:[^"]{40,}/g, 'IMG'));
    const done = (obj: unknown): ProviderResult => {
      const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
      return { text, finish: 'stop', usage: { input: inTok, output: est(text) } };
    };
    if (req.source.purpose === 'repair') return req.source.req?.message.includes(FAKE_TRIGGERS.prose) ? done('Still prose without any JSON.') : done({ text: 'OK', actions: [] });
    if (req.source.purpose === 'extract') return done(fakeTranscript(req.source.req));

    const r = req.source.req;
    const msg = r.message;
    if (msg.includes(FAKE_TRIGGERS.quota)) throw new ProviderError('quota', 3036);
    if (msg.includes(FAKE_TRIGGERS.capacity)) throw new ProviderError('capacity', 3040);
    if (msg.includes(FAKE_TRIGGERS.timeout)) throw new ProviderError('timeout', null);
    if (msg.includes(FAKE_TRIGGERS.badJson)) return done('{"text": "broken"');
    if (msg.includes(FAKE_TRIGGERS.prose)) return done('Plain prose answer without JSON.');
    const ar = r.lang === 'ar';
    const ctx = r.context;
    const calc = r.calc?.[0];
    const actions: { id: string; payload: Record<string, unknown> }[] = [];
    if (msg.includes(FAKE_TRIGGERS.unknownAction)) actions.push({ id: 'project.delete', payload: { projectId: ctx?.project?.id ?? 'x' } });
    if (msg.includes(FAKE_TRIGGERS.foreignId)) actions.push({ id: 'tracker.openCurrentRound', payload: { projectId: 'someone-elses-project' } });
    if (ctx?.project) actions.push({ id: 'tracker.openCurrentRound', payload: { projectId: ctx.project.id, ...(ctx.part ? { partInstanceId: ctx.part.instanceId } : {}) } });

    let text: string;
    if (calc && calc.produced !== null) {
      text = ar
        ? `الحسبة من الآلة الحاسبة بتاعة غرزتك: ${calc.expr} بتستهلك ${calc.consumed} غرزة وبتطلّع ${calc.produced}.${calc.mismatch ? ` المكتوب ${calc.declared} مش مطابق — راجعي الباترون.` : ''}`
        : `From Gharzetak's calculator: ${calc.expr} uses ${calc.consumed} stitches and makes ${calc.produced}.${calc.mismatch ? ` The written ${calc.declared} does not match — check the pattern.` : ''}`;
    } else if (ctx?.round) {
      text = ar
        ? `إنتي في R${ctx.round.n}: ${ctx.round.text}. آخر الدور المفروض يبقى ${ctx.round.calculatedTotal ?? '؟'} غرزة.`
        : `You are on R${ctx.round.n}: ${ctx.round.text}. The round should end with ${ctx.round.calculatedTotal ?? '?'} stitches.`;
    } else {
      text = ar ? 'دي إجابة تجريبية من خيوطة (بدون ذكاء اصطناعي متصل).' : 'This is a demo answer from Khayoota (no AI model connected).';
    }
    const reply: Record<string, unknown> = { text, actions };
    if (r.images?.length) {
      reply['observations'] = [ar ? 'وصف تجريبي: مفيش تحليل صور حقيقي في الوضع التجريبي.' : 'Demo description: no real image analysis in demo mode.'];
      reply['hypotheses'] = [ar ? 'فرق في عدد الغرز أو في شد الخيط.' : 'A difference in stitch count or tension.'];
      reply['cannotConfirm'] = [ar ? 'عدد الغرز بالظبط من الصورة.' : 'The exact stitch count from a photo.'];
    }
    if (ctx?.round) reply['citations'] = [{ roundN: ctx.round.n, ...(ctx.part ? { partName: ctx.part.name } : {}) }];
    return done(reply);
  }
}

function fakeTranscript(req: ExtractRequest): unknown {
  const lines = req.text
    ? req.text
        .split(/\r?\n/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => ({ page: 1, text: t, kind: /^(r|rnd|round|row|الدور|دور)\s*[0-9٠-٩]/i.test(t) ? 'round' : 'note', legibility: 'clear' }))
    : [
        { page: 1, text: 'Demo ball (fake provider)', kind: 'title', legibility: 'clear' },
        { page: 1, text: 'R1: 6 sc in MR (6)', kind: 'round', legibility: 'clear' },
        { page: 1, text: 'R2: inc x 6 (12)', kind: 'round', legibility: 'clear' },
        { page: 1, text: 'R3: (sc, inc) x 6 (18)', kind: 'round', legibility: 'uncertain', uncertain: ['18'] },
        { page: 1, text: 'R4-R6: 18 sc (18)', kind: 'round', legibility: 'clear' },
        { page: 1, text: 'R7: (sc, dec) x 6 (12)', kind: 'round', legibility: 'clear' },
        { page: 1, text: 'Stuff firmly and close.', kind: 'assembly', legibility: 'clear' },
      ];
  return { sourceClass: 'written', title: req.text ? null : 'Demo ball (fake provider)', language: req.lang === 'ar' ? 'ar' : 'en', terms: 'us', lines, warnings: [] };
}

export function createProvider(env: { AI?: Ai }, cfg: AiConfig): AiProvider | null {
  if (cfg.provider === 'workers-ai') return env.AI ? new WorkersAiProvider(env.AI, cfg.timeoutMs) : null;
  return new FakeAiProvider();
}
