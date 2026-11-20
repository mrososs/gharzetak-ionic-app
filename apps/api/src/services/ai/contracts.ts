/**
 * Khayoota AI — wire contracts (requests from the app, model output, replies to the app).
 *
 * Everything that crosses a trust boundary is validated here with Zod:
 *  - requests from the device (sizes, image types, context shape),
 *  - model output (never trusted: unknown fields stripped, unknown actions dropped),
 *  - actions (server-owned allowlist; ids must come from the request's own context).
 *
 * Pure module: no bindings, no I/O. The controlled benchmark imports it too, so the benchmark tests the real prompts and schemas.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* limits                                                              */
/* ------------------------------------------------------------------ */

export const AI_LIMITS = {
  messageChars: 2000,
  historyTurns: 8,
  historyChars: 6000,
  contextBytes: 6 * 1024,
  /** One related set per message (tester release). Each image is budgeted separately (IMAGE_TOKENS_UPPER each). */
  chatImages: 4,
  extractImages: 4,
  /** Base64 characters per image (~700 KB of bytes). The app resizes to ≤ 1568 px JPEG before sending. */
  imageBase64Chars: 950_000,
  chatBodyBytes: 3_800_000 + 64 * 1024,
  /** Text-only chat (photos off): message + history + context + calc, with room for multi-byte Arabic. */
  chatTextBodyBytes: 64 * 1024,
  extractBodyBytes: 3_800_000 + 64 * 1024,
  extractTextChars: 20_000,
  replyTextChars: 1500,
  transcriptLines: 400,
  transcriptLineChars: 300,
  maxActions: 2,
} as const;

/* ------------------------------------------------------------------ */
/* requests                                                            */
/* ------------------------------------------------------------------ */

export const imageMime = z.enum(['image/jpeg', 'image/png', 'image/webp']);
export const inlineImage = z.object({
  mime: imageMime,
  data: z
    .string()
    .min(16)
    .max(AI_LIMITS.imageBase64Chars)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'must be plain base64 (no data: prefix)'),
});
export type InlineImage = z.infer<typeof inlineImage>;

/** Client-generated idempotency key of ONE user action: a retry reuses it, so the daily quota is charged once. */
export const clientRequestId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

const shortText = (max: number) => z.string().max(max);
const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

/** Project context assembled ON THE DEVICE from the pinned revision (see multimodal-architecture.md §5). Data only, never instructions. */
export const khayootaContext = z
  .object({
    v: z.literal(1),
    viewTerms: z.enum(['us', 'uk']).optional(),
    project: z.object({ id, name: shortText(120), category: shortText(40).optional(), kind: z.enum(['simple', 'pattern', 'collection']) }).optional(),
    part: z.object({ instanceId: id, name: shortText(80), index: z.number().int().min(1).max(30), of: z.number().int().min(1).max(30) }).optional(),
    pattern: z.object({ source: z.enum(['pinned', 'snapshot', 'live']), rev: z.number().int().min(0).max(100000), outdated: z.boolean(), terms: z.enum(['us', 'uk']) }).optional(),
    round: z
      .object({
        n: z.number().int().min(0).max(1000),
        text: shortText(300),
        declaredTotal: z.number().int().min(0).max(10000).nullable(),
        calculatedTotal: z.number().int().min(0).max(10000).nullable(),
        consumed: z.number().int().min(0).max(10000).nullable(),
        mismatch: z.boolean(),
        joins: z.array(shortText(40)).max(10),
        position: z.object({ done: z.number().int().min(0).max(100000), of: z.number().int().min(0).max(100000) }).optional(),
        simpleCount: z.object({ count: z.number().int().min(0).max(100000), target: z.number().int().min(0).max(100000) }).optional(),
      })
      .optional(),
    nearby: z.array(z.object({ n: z.number().int().min(0).max(1000), text: shortText(300) })).max(4).optional(),
    unfinishedParts: z.array(z.object({ instanceId: id, label: shortText(100) })).max(10).optional(),
    /** Finished pieces (labels only matter): lets Khayoota say "that piece is already done" instead of opening the wrong one. */
    finishedParts: z.array(z.object({ instanceId: id, label: shortText(100) })).max(10).optional(),
    percent: z.number().min(0).max(100).optional(),
  })
  .strict();
export type KhayootaContext = z.infer<typeof khayootaContext>;

export const chatIntent = z.enum(['ask', 'explain-round', 'diagnose-photo', 'next-piece', 'explain-stitch']);

/** Stitch arithmetic computed ON THE DEVICE by the deterministic Smart Pattern Parser for round expressions in the message. */
export const calcFact = z
  .object({
    expr: shortText(200),
    normalized: shortText(200),
    consumed: z.number().int().min(0).max(100000).nullable(),
    produced: z.number().int().min(0).max(100000).nullable(),
    declared: z.number().int().min(0).max(100000).nullable(),
    mismatch: z.boolean(),
    status: z.enum(['validated', 'needs-review', 'unsupported']),
  })
  .strict();

export const chatRequest = z
  .object({
    v: z.literal(1),
    message: z.string().max(AI_LIMITS.messageChars),
    images: z.array(inlineImage).max(AI_LIMITS.chatImages).optional(),
    history: z
      .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(AI_LIMITS.messageChars) }))
      .max(AI_LIMITS.historyTurns)
      .optional(),
    context: khayootaContext.optional(),
    calc: z.array(calcFact).max(5).optional(),
    intent: chatIntent.optional(),
    lang: z.enum(['ar', 'en']),
    clientRequestId: clientRequestId.optional(),
  })
  .strict()
  .refine((r) => r.message.trim().length > 0 || (r.images?.length ?? 0) > 0, { message: 'message or image required' })
  .refine((r) => (r.history ?? []).reduce((a, h) => a + h.text.length, 0) <= AI_LIMITS.historyChars, { message: 'history too long' })
  .refine((r) => !r.context || JSON.stringify(r.context).length <= AI_LIMITS.contextBytes, { message: 'context too large' });
export type ChatRequest = z.infer<typeof chatRequest>;

export const extractRequest = z
  .object({
    v: z.literal(1),
    images: z.array(inlineImage).max(AI_LIMITS.extractImages).optional(),
    text: z.string().max(AI_LIMITS.extractTextChars).optional(),
    hint: z.object({ lang: z.enum(['ar', 'en', 'mixed']).optional(), terms: z.enum(['us', 'uk']).optional() }).strict().optional(),
    lang: z.enum(['ar', 'en']),
    clientRequestId: clientRequestId.optional(),
  })
  .strict()
  .refine((r) => (r.images?.length ?? 0) > 0 || (r.text ?? '').trim().length > 0, { message: 'images or text required' });
export type ExtractRequest = z.infer<typeof extractRequest>;

export const consentRequest = z.object({ version: z.number().int().min(1).max(1000) }).strict();

/* ------------------------------------------------------------------ */
/* actions (server-owned allowlist)                                    */
/* ------------------------------------------------------------------ */

/** Stitch keys of the app's glossary (src/app/core/data/catalog.ts TERMS). */
export const STITCH_KEYS = ['ch', 'sl', 'sc', 'hdc', 'dc', 'tr', 'dtr', 'inc', 'dec', 'mr', 'flo', 'blo', 'st', 'sk', 'rnd'] as const;
/** Tutorial topic ids of the app (catalog.ts VIDEOS). An unknown id is never forwarded (the page would fall back silently). */
export const VIDEO_TOPICS = ['magic-ring', 'sc-basic', 'inc-dec', 'invisible-dec', 'read-pattern', 'amigurumi-assemble', 'granny', 'no-twist', 'sweater', 'basket'] as const;

export const ACTION_SCHEMAS = {
  'tracker.openCurrentRound': z.object({ projectId: id, partInstanceId: id.optional() }).strict(),
  'project.openPart': z.object({ projectId: id, partInstanceId: id }).strict(),
  'learn.explainStitch': z.object({ stitch: z.enum(STITCH_KEYS), topic: z.enum(VIDEO_TOPICS).optional() }).strict(),
} as const;
export type ActionId = keyof typeof ACTION_SCHEMAS;
export const ACTION_IDS = Object.keys(ACTION_SCHEMAS) as ActionId[];

export interface ActionProposal {
  id: ActionId;
  v: 1;
  payload: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* model output                                                        */
/* ------------------------------------------------------------------ */

const lenient = (max: number) => z.string().transform((s) => s.slice(0, max));

/** What the model is asked to return for chat / photo turns. Extra keys are stripped; actions are re-validated below. */
export const modelReply = z.object({
  /** The model's own scope call. false → the server guard strips actions/citations (see toChatReply). */
  inScope: z.boolean().optional(),
  text: lenient(AI_LIMITS.replyTextChars * 2),
  observations: z.array(lenient(300)).max(6).optional(),
  hypotheses: z.array(lenient(300)).max(6).optional(),
  cannotConfirm: z.array(lenient(300)).max(6).optional(),
  citations: z.array(z.object({ roundN: z.number().int().min(0).max(1000), partName: z.string().max(80).optional() })).max(6).optional(),
  actions: z.array(z.object({ id: z.string().max(64), payload: z.record(z.string(), z.unknown()).optional() })).max(10).optional(),
});
export type ModelReply = z.infer<typeof modelReply>;

export const transcriptWarning = z.enum([
  'cropped',
  'blurred',
  'rotated',
  'handwriting',
  'crossed-out',
  'multi-column',
  'chart-no-legend',
  'missing-rounds',
  'non-pattern-text',
  'possible-instruction-in-source',
  'mixed-patterns',
  'duplicate-page',
  'missing-page',
  'page-order',
]);

/** What the model is asked to return for extraction: a faithful transcript, NO stitch maths. */
export const modelTranscript = z.object({
  sourceClass: z.enum(['written', 'chart', 'finished-object', 'tutorial', 'other']),
  title: z.string().max(200).nullable().optional(),
  language: z.enum(['ar', 'en', 'mixed']).optional(),
  terms: z.enum(['us', 'uk', 'unknown']).optional(),
  lines: z
    .array(
      z.object({
        page: z.number().int().min(1).max(10).optional(),
        text: lenient(AI_LIMITS.transcriptLineChars),
        kind: z.enum(['title', 'part-heading', 'round', 'assembly', 'note', 'other']).optional(),
        legibility: z.enum(['clear', 'uncertain', 'unreadable']).optional(),
        uncertain: z.array(z.string().max(60)).max(10).optional(),
      }),
    )
    .max(AI_LIMITS.transcriptLines),
  warnings: z.array(z.object({ code: z.string().max(40), lineIndex: z.number().int().min(0).max(1000).optional(), note: z.string().max(300).optional() })).max(30).optional(),
});
export type ModelTranscript = z.infer<typeof modelTranscript>;

/* ------------------------------------------------------------------ */
/* replies to the app                                                  */
/* ------------------------------------------------------------------ */

export interface ChatReplyV1 {
  v: 1;
  lang: 'ar' | 'en';
  text: string;
  observations?: string[];
  hypotheses?: string[];
  cannotConfirm?: string[];
  citations?: { roundN: number; partName?: string }[];
  actions: ActionProposal[];
  /** true when the model's JSON could not be used and only its text (or nothing) is returned. */
  degraded: boolean;
  /** The model judged the request out of scope: the reply is a short refusal and the guard removed any action/citation. */
  outOfScope?: true;
}

export interface TranscriptV1 {
  schema: 'gz.pattern-transcript';
  v: 1;
  sourceClass: ModelTranscript['sourceClass'];
  title: string | null;
  language: 'ar' | 'en' | 'mixed';
  terms: 'us' | 'uk' | 'unknown';
  lines: { page: number; text: string; kind: NonNullable<ModelTranscript['lines'][number]['kind']>; legibility: 'clear' | 'uncertain' | 'unreadable'; uncertain: string[] }[];
  warnings: { code: z.infer<typeof transcriptWarning>; lineIndex?: number; note: string }[];
}

/* ------------------------------------------------------------------ */
/* output sanitising                                                   */
/* ------------------------------------------------------------------ */

/** Pulls the first JSON object out of a model message (tolerates ```json fences and leading prose). */
export function extractJson(text: string): unknown {
  const t = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  const candidate = fenced ? fenced[1]! : t;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object');
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Ids the device put into the request context — the only ids an action may target. */
export function contextIds(ctx: KhayootaContext | undefined): { projectIds: Set<string>; instanceIds: Set<string> } {
  const projectIds = new Set<string>();
  const instanceIds = new Set<string>();
  if (ctx?.project) projectIds.add(ctx.project.id);
  if (ctx?.part) instanceIds.add(ctx.part.instanceId);
  for (const p of ctx?.unfinishedParts ?? []) instanceIds.add(p.instanceId);
  return { projectIds, instanceIds };
}

/** Validates model-proposed actions: allowlisted id, strict payload, ids only from this request's context, at most two. */
export function sanitizeActions(raw: ModelReply['actions'], ctx: KhayootaContext | undefined): ActionProposal[] {
  const { projectIds, instanceIds } = contextIds(ctx);
  const out: ActionProposal[] = [];
  for (const a of raw ?? []) {
    if (out.length >= AI_LIMITS.maxActions) break;
    if (!(a.id in ACTION_SCHEMAS)) continue;
    const actionId = a.id as ActionId;
    const parsed = ACTION_SCHEMAS[actionId].safeParse(a.payload ?? {});
    if (!parsed.success) continue;
    const p = parsed.data as Record<string, unknown>;
    if (typeof p['projectId'] === 'string' && !projectIds.has(p['projectId'])) continue;
    if (typeof p['partInstanceId'] === 'string' && !instanceIds.has(p['partInstanceId'])) continue;
    // project.openPart opens a piece still to be made: only an UNFINISHED piece of this request's context qualifies
    // (on the device the model offered the current, finished piece when asked for "the second arm").
    if (actionId === 'project.openPart' && !(ctx?.unfinishedParts ?? []).some((u) => u.instanceId === p['partInstanceId'])) continue;
    if (out.some((x) => x.id === actionId && JSON.stringify(x.payload) === JSON.stringify(p))) continue;
    out.push({ id: actionId, v: 1, payload: p });
  }
  return out;
}

/** Strips anything markup-like the app would never render anyway (defence in depth; the app renders plain text). */
export const plainText = (s: string, max: number): string =>
  s
    .replace(/<[^>]{0,200}>/g, '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, max);

/** Sentences that tell the user to tap a button ("دوسي على الزرار تحت", "tap the button below"). */
const BUTTON_REF = /(?<![؀-ۿ])(?:ال)?(?:زر|زرار|أزرار|ازرار)(?![؀-ۿ])|\bbuttons?\b|\btap (?:below|here)\b/i;

/**
 * CONSISTENCY GUARD: when no action survived validation (the model proposed an unavailable or finished piece, a foreign
 * id, ...), the reply must not tell the user to tap a button that will not be shown. Sentences that mention a button
 * are removed; if nothing is left, a neutral line says where to go instead. Never adds facts.
 */
export function withoutDanglingButtonRefs(text: string, lang: 'ar' | 'en'): string {
  if (!BUTTON_REF.test(text)) return text;
  const parts = text.split(/(?<=[.!؟?])\s+|\n+/).filter((p) => p.trim());
  const kept = parts.filter((p) => !BUTTON_REF.test(p));
  if (kept.length) return kept.join(' ').trim();
  return lang === 'ar' ? 'مش قادرة أفتحلك ده من هنا — افتحيه من صفحة المشروع.' : 'I can’t open that from here — open it from the project page.';
}

export function toChatReply(model: ModelReply, ctx: KhayootaContext | undefined, lang: 'ar' | 'en'): ChatReplyV1 {
  const arr = (x: string[] | undefined) => (x ?? []).map((s) => plainText(s, 300)).filter(Boolean);
  // APPLICATION GUARD: an out-of-scope reply never carries an action card, citation or photo analysis, whatever the model added.
  if (model.inScope === false) return { v: 1, lang, text: plainText(model.text, AI_LIMITS.replyTextChars), actions: [], degraded: false, outOfScope: true };
  const actions = sanitizeActions(model.actions, ctx);
  const text = plainText(model.text, AI_LIMITS.replyTextChars);
  const reply: ChatReplyV1 = { v: 1, lang, text: actions.length ? text : withoutDanglingButtonRefs(text, lang), actions, degraded: false };
  const obs = arr(model.observations);
  const hyp = arr(model.hypotheses);
  const cc = arr(model.cannotConfirm);
  if (obs.length) reply.observations = obs;
  if (hyp.length) reply.hypotheses = hyp;
  if (cc.length) reply.cannotConfirm = cc;
  const roundsInCtx = new Set<number>([...(ctx?.round ? [ctx.round.n] : []), ...(ctx?.nearby ?? []).map((r) => r.n)]);
  const cites = (model.citations ?? []).filter((c) => roundsInCtx.has(c.roundN)).map((c) => ({ roundN: c.roundN, ...(c.partName ? { partName: plainText(c.partName, 80) } : {}) }));
  if (cites.length) reply.citations = cites;
  return reply;
}

const KNOWN_WARNINGS = new Set<string>(transcriptWarning.options);

export function toTranscript(model: ModelTranscript): TranscriptV1 {
  return {
    schema: 'gz.pattern-transcript',
    v: 1,
    sourceClass: model.sourceClass,
    title: model.title ? plainText(model.title, 200) : null,
    language: model.language ?? 'mixed',
    terms: model.terms ?? 'unknown',
    lines: model.lines
      .map((l) => ({ page: l.page ?? 1, text: plainText(l.text, AI_LIMITS.transcriptLineChars), kind: l.kind ?? 'other', legibility: l.legibility ?? 'uncertain', uncertain: (l.uncertain ?? []).map((u) => plainText(u, 60)) }))
      .filter((l) => l.text.length > 0),
    warnings: (model.warnings ?? [])
      .filter((w) => KNOWN_WARNINGS.has(w.code))
      .map((w) => ({ code: w.code as z.infer<typeof transcriptWarning>, ...(w.lineIndex !== undefined ? { lineIndex: w.lineIndex } : {}), note: plainText(w.note ?? '', 300) })),
  };
}
