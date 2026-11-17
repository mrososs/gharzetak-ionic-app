import type { Context } from 'hono';
import { z } from 'zod';
import { badRequest } from './errors';

export const MAX_JSON_BYTES = 256 * 1024;

export const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'must be a UUID');
export const idParam = (v: string | undefined, name = 'id'): string => {
  const r = id.safeParse(v);
  if (!r.success) throw badRequest(`Invalid ${name}`);
  return r.data;
};

/** Optimistic-concurrency envelope carried by every versioned write. */
export const versioned = {
  /** Revision the device last saw (0 = create). */
  baseRevision: z.number().int().min(0),
  /** Device clock hint (ms). Clamped server-side; never used for authorisation. */
  clientUpdatedAt: z.number().int().min(0),
};

export const level = z.enum(['beginner', 'intermediate', 'advanced']);
export const terms = z.enum(['us', 'uk']);

const str = (max: number) => z.string().max(max);

/** Bundled crochet avatars. Keep in sync with src/app/core/data/avatars.ts and the profiles_avatar_id CHECK. */
export const AVATAR_IDS = ['bunny', 'cat', 'bear', 'sheep', 'flower', 'yarn'] as const;

export const profileBody = z.object({
  ...versioned,
  displayName: str(80),
  level,
  terms,
  locale: z.enum(['ar', 'en']),
  interests: z.array(str(32)).max(20),
  onboarded: z.boolean(),
  /** Optional: older clients omit it and must never clear a stored choice. Unknown ids are rejected (400). */
  avatarId: z.enum(AVATAR_IDS).optional(),
});

export const toolsBody = z.object({
  ...versioned,
  hooks: z.array(z.string().min(1).max(40)).max(40),
  yarns: z.array(z.string().min(1).max(40)).max(40),
  accessories: z.array(z.string().min(1).max(40)).max(40),
});

export const patternBody = z.object({
  ...versioned,
  name: z.string().min(1).max(120),
  level,
  terms,
  sourceType: z.enum(['text', 'pdf', 'image', 'youtube']),
  sourceUrl: str(500).nullable(),
  attribution: str(200).nullable(),
  rawText: str(20000),
  readingPosition: z.number().int().min(0).max(100000),
  /** Optional for older clients (which keep the stored value). */
  contentRev: z.number().int().min(1).max(100000).optional(),
  suggestedMinutes: z.number().int().min(0).max(6_000_000).optional(),
  /** Derived round table, replaced atomically with the pattern. */
  rounds: z
    .array(
      z.object({
        n: z.number().int(),
        raw: str(500),
        ok: z.boolean(),
        cons: z.number().int().min(0),
        prod: z.number().int().min(0),
        declared: z.number().int().nullable(),
      }),
    )
    .max(500),
});

/** Larger body limit for the multi-part entities (a collection carries every part's text; a multi-part progress carries every instance). */
export const MAX_MULTI_BYTES = 900 * 1024;

const partBody = z.object({
  id,
  name: z.string().min(1).max(80),
  quantity: z.number().int().min(1).max(30),
  rawText: str(20000),
  assemblyNotes: str(4000),
});

const coverData = z
  .string()
  .max(220_000)
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'must be a base64 image data URL');

export const collectionBody = z
  .object({
    ...versioned,
    name: z.string().min(1).max(120),
    description: str(2000),
    level,
    terms,
    coverData: coverData.nullable(),
    contentRev: z.number().int().min(1).max(100000),
    suggestedMinutes: z.number().int().min(0).max(6_000_000),
    sourceText: str(60000),
    parts: z.array(partBody).max(30),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.parts.map((p) => p.id)).size !== v.parts.length) ctx.addIssue({ code: 'custom', path: ['parts'], message: 'part ids must be unique' });
    if (v.parts.reduce((n, p) => n + p.rawText.length + p.assemblyNotes.length, 0) > 400_000) ctx.addIssue({ code: 'custom', path: ['parts'], message: 'collection text too large' });
  });

/** Immutable snapshot of the previous content of a pattern ({ text }) or a collection ({ parts }). */
export const revisionBody = z.object({
  name: z.string().min(1).max(120),
  createdAt: z.number().int().min(0),
  snapshot: z.object({ terms, text: str(20000).optional(), parts: z.array(partBody).max(30).optional() }),
});
export const revisionKind = z.enum(['pattern', 'collection']);

/** A project's pinned copy of a part's instructions (immutable until the user chooses to update). */
const snapshotPart = z.object({ partId: id, name: z.string().min(1).max(80), quantity: z.number().int().min(1).max(30), text: str(20000), assemblyNotes: str(4000) });

const instanceBody = z.object({
  id,
  partId: id,
  index: z.number().int().min(1).max(30),
  mode: z.enum(['simple', 'pattern']),
  simple: z.object({
    round: z.number().int().min(1),
    target: z.number().int().min(1).max(999),
    perTap: z.number().int().min(1).max(99),
    count: z.number().int().min(0),
    totalRounds: z.number().int().min(0),
    history: z.array(z.unknown()).max(100),
  }),
  cursor: z.object({
    roundIndex: z.number().int().min(0),
    ptr: z.number().int().min(0),
    mode: z.enum(['action', 'group', 'round']),
    history: z.array(z.unknown()).max(100),
  }),
  workedSeconds: z.number().int().min(0),
  updatedAt: z.number().int().min(0),
  retired: z.boolean().optional(),
});

/** Every part instance of a multi-part project, each with its own tracker (so Arm 1 and Arm 2 never share progress). */
export const multiStateBody = z.object({
  collectionId: id,
  collectionRev: z.number().int().min(1),
  activeInstanceId: id.nullable(),
  snapshots: z.array(snapshotPart).max(30),
  instances: z.array(instanceBody).max(120),
});

export const patternSnapshotBody = z.object({ rev: z.number().int().min(1), name: z.string().min(1).max(120), text: str(20000), terms });

export const projectBody = z.object({
  ...versioned,
  name: z.string().min(1).max(120),
  category: z.enum(['amigurumi', 'clothes', 'accessories', 'home', 'gifts']),
  hookSize: str(10),
  yarnType: z.enum(['cotton', 'acrylic', 'wool', 'velvet', 'blend', 'milk']),
  status: z.enum(['active', 'paused', 'done']),
  patternId: id.nullable(),
  /** Optional: older clients omit it and must never clear an existing link. */
  collectionId: id.nullable().optional(),
  estimatedHours: z.number().min(0).max(100000),
  workedSeconds: z.number().int().min(0),
  lastWorkedAt: z.number().int().min(0),
  createdAt: z.number().int().min(0),
});

export const progressBody = z.object({
  ...versioned,
  mode: z.enum(['simple', 'pattern']),
  round: z.number().int().min(1),
  target: z.number().int().min(1).max(999),
  perTap: z.number().int().min(1).max(99),
  count: z.number().int().min(0),
  totalRounds: z.number().int().min(0),
  patternId: id.nullable(),
  patternRoundIndex: z.number().int().min(0),
  actionPtr: z.number().int().min(0),
  countMode: z.enum(['action', 'group', 'round']),
  history: z.array(z.unknown()).max(100),
  patternHistory: z.array(z.unknown()).max(100),
  /** Optional: older clients omit them and must never clear what another device stored. null clears. */
  multiState: multiStateBody.nullable().optional(),
  patternSnapshot: patternSnapshotBody.nullable().optional(),
});

export const notesBody = z.object({ ...versioned, body: str(10000) });

export const sessionBody = z.object({
  projectId: id,
  startedAt: z.number().int().min(0),
  endedAt: z.number().int().min(0),
  seconds: z.number().int().min(0).max(86400),
  partInstanceId: id.nullable().optional(),
});

export const tutorialBody = z.object({
  ...versioned,
  youtubeUrl: z
    .string()
    .max(500)
    .regex(/^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i)
    .nullable(),
  creatorName: str(120).nullable(),
  projectId: id.nullable(),
  notes: str(10000),
  stamps: z.array(z.object({ id, seconds: z.number().int().min(0).max(86400), note: str(300) })).max(500),
});

export const interestBody = z.object({ email: z.string().max(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/) });

/** Reads a size-limited JSON body and validates it. Failures become structured 400s. */
export async function parseBody<T extends z.ZodType>(c: Context, schema: T, maxBytes = MAX_JSON_BYTES): Promise<z.infer<T>> {
  const len = Number(c.req.header('content-length') ?? '0');
  if (len > maxBytes) throw badRequest('Request body too large');
  const text = await c.req.text();
  if (text.length > maxBytes) throw badRequest('Request body too large');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw badRequest('Body must be valid JSON');
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw badRequest('Invalid request body', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return parsed.data;
}

/** The device clock is only a merge hint: never trust a value further than 5 minutes in the future. */
export const clampClientTime = (ts: number, now: number): number => Math.min(ts, now + 5 * 60_000);
