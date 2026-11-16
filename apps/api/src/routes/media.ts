import { and, eq, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { schema } from '../db';
import type { AppBindings } from '../env';
import { ApiError, badRequest, notFound } from '../errors';
import { MEDIA_RULES, extFor, readLimited, safeSegment, validateUpload, type MediaKind } from '../services/media';
import { idParam } from '../validators';
import { assertOwnProject, deleteMediaWhere } from './entities';

const { mediaObjects, projectPhotos, projects, patterns } = schema;

/**
 * Private media in R2. The bucket has no public access: every byte goes through these endpoints,
 * and every read/write/delete is authorised against the `media_objects` row (user_id), never by
 * trusting a key supplied by the client.
 *
 * Keys keep the Supabase layout so migrated objects map 1:1:  <userId>/<projectId|patternId>/<file>
 */
export const media = new Hono<AppBindings>();

type Ctx = import('hono').Context<AppBindings>;

async function receive(c: Ctx, kind: MediaKind) {
  const bytes = await readLimited(c.req.raw, MEDIA_RULES[kind].maxBytes);
  const mime = validateUpload(kind, bytes, c.req.header('content-type') ?? null);
  return { bytes, mime };
}

/** PUT /v1/media/project-photos/:projectId/:photoId  (raw bytes) */
media.put('/project-photos/:projectId/:photoId', async (c) => {
  const projectId = idParam(c.req.param('projectId'), 'projectId');
  const photoId = idParam(c.req.param('photoId'), 'photoId');
  const db = c.get('db');
  const userId = safeSegment(c.get('userId'));
  await assertOwnProject(db, projectId, userId);
  const existing = await db.select({ ownerId: projectPhotos.ownerId }).from(projectPhotos).where(eq(projectPhotos.id, photoId)).get();
  if (existing && existing.ownerId !== userId) throw notFound('Photo');

  const { bytes, mime } = await receive(c, 'project-photo');
  const key = `${userId}/${projectId}/${photoId}.${extFor(mime)}`;
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime, cacheControl: 'private, no-store' } });
  await db.batch([
    db.insert(mediaObjects).values({ key, userId, kind: 'project-photo', projectId, mime, size: bytes.byteLength }).onConflictDoUpdate({ target: mediaObjects.key, set: { mime, size: bytes.byteLength } }),
    db
      .insert(projectPhotos)
      .values({ id: photoId, projectId, ownerId: userId, storagePath: key, mimeType: mime, sizeBytes: bytes.byteLength, isCover: false })
      .onConflictDoUpdate({ target: projectPhotos.id, set: { storagePath: key, mimeType: mime, sizeBytes: bytes.byteLength } }),
  ]);
  return c.json({ key, mime, size: bytes.byteLength }, 201);
});

/** PUT /v1/media/project-covers/:projectId  (raw bytes) — replaces the previous cover. */
media.put('/project-covers/:projectId', async (c) => {
  const projectId = idParam(c.req.param('projectId'), 'projectId');
  const db = c.get('db');
  const userId = safeSegment(c.get('userId'));
  await assertOwnProject(db, projectId, userId);

  const { bytes, mime } = await receive(c, 'project-cover');
  const key = `${userId}/${projectId}/cover-${crypto.randomUUID()}.${extFor(mime)}`;
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime, cacheControl: 'private, no-store' } });
  await db.batch([
    db.insert(mediaObjects).values({ key, userId, kind: 'project-cover', projectId, mime, size: bytes.byteLength }),
    db.update(projects).set({ coverPath: key, updatedAt: Date.now() }).where(and(eq(projects.id, projectId), eq(projects.ownerId, userId))),
  ]);
  // best-effort removal of superseded covers (the new one is already live)
  await deleteMediaWhere(c.env.MEDIA, db, and(eq(mediaObjects.userId, userId), eq(mediaObjects.projectId, projectId), eq(mediaObjects.kind, 'project-cover'), ne(mediaObjects.key, key)));
  return c.json({ key, mime, size: bytes.byteLength }, 201);
});

/** PUT /v1/media/pattern-files/:patternId  (raw bytes + X-File-Name header) */
media.put('/pattern-files/:patternId', async (c) => {
  const patternId = idParam(c.req.param('patternId'), 'patternId');
  const db = c.get('db');
  const userId = safeSegment(c.get('userId'));
  const pat = await db.select({ id: patterns.id }).from(patterns).where(and(eq(patterns.id, patternId), eq(patterns.ownerId, userId), sql`${patterns.deletedAt} IS NULL`)).get();
  if (!pat) throw notFound('Pattern');

  const { bytes, mime } = await receive(c, 'pattern-file');
  const key = `${userId}/${patternId}/source.${extFor(mime)}`;
  // Header values are ASCII-only, so clients send the name percent-encoded (works for Arabic file names).
  let rawName = c.req.header('x-file-name') ?? `source.${extFor(mime)}`;
  try {
    rawName = decodeURIComponent(rawName);
  } catch {
    /* not percent-encoded: use as is */
  }
  const fileName = rawName.slice(0, 120).replace(/[\u0000-\u001f\u007f\\/]/g, '_');
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime, cacheControl: 'private, no-store' } });
  await db.batch([
    db.insert(mediaObjects).values({ key, userId, kind: 'pattern-file', patternId, mime, size: bytes.byteLength }).onConflictDoUpdate({ target: mediaObjects.key, set: { mime, size: bytes.byteLength } }),
    db.update(patterns).set({ filePath: key, fileName, fileSize: bytes.byteLength, fileMime: mime }).where(and(eq(patterns.id, patternId), eq(patterns.ownerId, userId))),
  ]);
  // a different extension means the old object is superseded
  await deleteMediaWhere(c.env.MEDIA, db, and(eq(mediaObjects.userId, userId), eq(mediaObjects.patternId, patternId), ne(mediaObjects.key, key)));
  return c.json({ key, mime, size: bytes.byteLength, name: fileName }, 201);
});

const keyParam = (c: Ctx): string => {
  const key = c.req.query('key');
  if (!key || key.length > 300 || key.includes('..') || key.startsWith('/')) throw badRequest('Invalid key');
  return key;
};

async function ownedObject(c: Ctx, key: string) {
  const row = await c.get('db').select().from(mediaObjects).where(and(eq(mediaObjects.key, key), eq(mediaObjects.userId, c.get('userId')))).get();
  if (!row) throw notFound('File'); // identical response for "missing" and "someone else's"
  return row;
}

/** GET /v1/media/object?key=...  — authenticated, owner-only streaming download. */
media.get('/object', async (c) => {
  const key = keyParam(c);
  const row = await ownedObject(c, key);
  const obj = await c.env.MEDIA.get(key, { onlyIf: c.req.raw.headers });
  if (!obj) throw notFound('File');
  const headers = new Headers({
    'Content-Type': row.mime,
    'Cache-Control': 'private, max-age=0, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-site',
    ETag: obj.httpEtag,
  });
  if (!('body' in obj)) return new Response(null, { status: 304, headers }); // precondition (If-None-Match) satisfied
  headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { headers });
});

/** DELETE /v1/media/object?key=...  — owner-only; removes the R2 object and every row that references it. */
media.delete('/object', async (c) => {
  const key = keyParam(c);
  const userId = c.get('userId');
  const row = await ownedObject(c, key).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) return null; // idempotent
    throw e;
  });
  if (!row) return c.body(null, 204);
  const db = c.get('db');
  await c.env.MEDIA.delete(key);
  await db.batch([
    db.delete(projectPhotos).where(and(eq(projectPhotos.storagePath, key), eq(projectPhotos.ownerId, userId))),
    db.update(projects).set({ coverPath: null }).where(and(eq(projects.coverPath, key), eq(projects.ownerId, userId))),
    db.update(patterns).set({ filePath: null, fileName: null, fileSize: null, fileMime: null }).where(and(eq(patterns.filePath, key), eq(patterns.ownerId, userId))),
    db.delete(mediaObjects).where(and(eq(mediaObjects.key, key), eq(mediaObjects.userId, userId))),
  ]);
  return c.body(null, 204);
});
