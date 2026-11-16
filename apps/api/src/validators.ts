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

export const profileBody = z.object({
  ...versioned,
  displayName: str(80),
  level,
  terms,
  locale: z.enum(['ar', 'en']),
  interests: z.array(str(32)).max(20),
  onboarded: z.boolean(),
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

export const projectBody = z.object({
  ...versioned,
  name: z.string().min(1).max(120),
  category: z.enum(['amigurumi', 'clothes', 'accessories', 'home', 'gifts']),
  hookSize: str(10),
  yarnType: z.enum(['cotton', 'acrylic', 'wool', 'velvet', 'blend', 'milk']),
  status: z.enum(['active', 'paused', 'done']),
  patternId: id.nullable(),
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
});

export const notesBody = z.object({ ...versioned, body: str(10000) });

export const sessionBody = z.object({
  projectId: id,
  startedAt: z.number().int().min(0),
  endedAt: z.number().int().min(0),
  seconds: z.number().int().min(0).max(86400),
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
