import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { schema } from '../db';
import { ApiError, badRequest, notFound } from '../errors';
import type { AppBindings } from '../env';
import {
  MAX_MULTI_BYTES,
  clampClientTime,
  collectionBody,
  idParam,
  interestBody,
  notesBody,
  parseBody,
  patternBody,
  profileBody,
  progressBody,
  projectBody,
  revisionBody,
  revisionKind,
  sessionBody,
  toolsBody,
  tutorialBody,
} from '../validators';

const {
  profiles, patterns, patternCollections, patternParts, patternRevisions, projects, projectProgress, projectNotes, projectPhotos, workSessions, favorites,
  tutorialBookmarks, tutorialTimestamps, storeInterest, userTools, mediaObjects,
} = schema;

/**
 * Optimistic concurrency contract (all versioned PUTs):
 *   request  { baseRevision, clientUpdatedAt, ...fields }   baseRevision 0 = create
 *   200/201  { revision, clientUpdatedAt, updatedAt }       write accepted, revision incremented
 *   409      { error: { code: 'conflict' }, current: { revision, clientUpdatedAt, deleted? } }
 * The write is a single compare-and-swap in SQL (`WHERE revision = :baseRevision`), so two devices
 * can never both win; the loser receives the winner's revision and decides how to merge.
 * Retrying an already-applied write yields 409 with `current.clientUpdatedAt` equal to the retry's,
 * which clients treat as "already applied" (idempotent retry).
 */
const accepted = (c: Context, revision: number, clientUpdatedAt: number, updatedAt: number, created = false) =>
  c.json({ revision, clientUpdatedAt, updatedAt }, created ? 201 : 200);

const conflict = (current: Record<string, unknown>): never => {
  throw new ApiError(409, 'conflict', 'The server holds a different revision of this item', undefined, { current });
};

export const entities = new Hono<AppBindings>();

/* ------------------------------------------------------------------ */
/* profile + tools                                                     */
/* ------------------------------------------------------------------ */

entities.put('/profile', async (c) => {
  const b = await parseBody(c, profileBody);
  const db = c.get('db');
  const userId = c.get('userId');
  const now = Date.now();
  const cts = clampClientTime(b.clientUpdatedAt, now);
  const values = { displayName: b.displayName, level: b.level, terms: b.terms, locale: b.locale, interests: b.interests, onboarded: b.onboarded, ...(b.avatarId ? { avatarId: b.avatarId } : {}) };

  if (b.baseRevision === 0) {
    const ins = await db.insert(profiles).values({ userId, ...values, clientUpdatedAt: cts, revision: 1, createdAt: now, updatedAt: now }).onConflictDoNothing().returning({ revision: profiles.revision });
    if (ins[0]) return accepted(c, 1, cts, now, true);
  } else {
    const upd = await db
      .update(profiles)
      .set({ ...values, clientUpdatedAt: cts, updatedAt: now, revision: sql`${profiles.revision} + 1` })
      .where(and(eq(profiles.userId, userId), eq(profiles.revision, b.baseRevision)))
      .returning({ revision: profiles.revision });
    if (upd[0]) return accepted(c, upd[0].revision, cts, now);
  }
  const cur = await db.select({ revision: profiles.revision, clientUpdatedAt: profiles.clientUpdatedAt }).from(profiles).where(eq(profiles.userId, userId)).get();
  if (!cur) throw notFound('Profile');
  return conflict(cur);
});

/** Tools are a replace-all set versioned by profiles.tools_revision; parent CAS + child replace run in ONE D1 batch (atomic). */
entities.put('/tools', async (c) => {
  const b = await parseBody(c, toolsBody);
  const userId = c.get('userId');
  const d1 = c.env.DB;
  const now = Date.now();
  const cts = clampClientTime(b.clientUpdatedAt, now);
  const next = b.baseRevision + 1;
  const items = JSON.stringify([...b.hooks.map((value) => ({ kind: 'hook', value })), ...b.yarns.map((value) => ({ kind: 'yarn', value })), ...b.accessories.map((value) => ({ kind: 'accessory', value }))]);
  const guard = `EXISTS (SELECT 1 FROM profiles WHERE user_id = ?1 AND tools_revision = ?2 AND tools_client_updated_at = ?3)`;

  const res = await d1.batch([
    d1.prepare('UPDATE profiles SET tools_revision = tools_revision + 1, tools_client_updated_at = ?1, updated_at = ?2 WHERE user_id = ?3 AND tools_revision = ?4').bind(cts, now, userId, b.baseRevision),
    d1.prepare(`DELETE FROM user_tools WHERE user_id = ?1 AND ${guard}`).bind(userId, next, cts),
    d1
      .prepare(
        `INSERT OR IGNORE INTO user_tools (id, user_id, kind, value) SELECT lower(hex(randomblob(16))), ?1, json_extract(j.value, '$.kind'), json_extract(j.value, '$.value') FROM json_each(?4) AS j WHERE ${guard}`,
      )
      .bind(userId, next, cts, items),
  ]);
  if (res[0]?.meta.changes === 1) return accepted(c, next, cts, now);
  const cur = await c.get('db').select({ revision: profiles.toolsRevision, clientUpdatedAt: profiles.toolsClientUpdatedAt }).from(profiles).where(eq(profiles.userId, userId)).get();
  if (!cur) throw notFound('Profile');
  return conflict(cur);
});

/* ------------------------------------------------------------------ */
/* patterns                                                            */
/* ------------------------------------------------------------------ */

entities.put('/patterns/:id', async (c) => {
  const pid = idParam(c.req.param('id'));
  const b = await parseBody(c, patternBody);
  const db = c.get('db');
  const d1 = c.env.DB;
  const userId = c.get('userId');
  const now = Date.now();
  const cts = clampClientTime(b.clientUpdatedAt, now);
  const next = b.baseRevision + 1;
  const rounds = JSON.stringify(b.rounds);

  const own = await db.select({ ownerId: patterns.ownerId, deletedAt: patterns.deletedAt }).from(patterns).where(eq(patterns.id, pid)).get();
  if (own && own.ownerId !== userId) throw notFound('Pattern'); // samples and other users' patterns are not writable

  const guard = `EXISTS (SELECT 1 FROM patterns WHERE id = ?1 AND owner_id = ?2 AND revision = ?3 AND client_updated_at = ?4 AND deleted_at IS NULL)`;
  const write =
    b.baseRevision === 0
      ? d1
          .prepare(
            `INSERT INTO patterns (id, owner_id, is_sample, name, level, terms, source_type, source_url, attribution, raw_text, reading_position, client_updated_at, revision, created_at, updated_at, content_rev, suggested_minutes, source_text)
             VALUES (?1, ?2, 0, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12, ?12, COALESCE(?13, 1), COALESCE(?14, 0), COALESCE(?15, '')) ON CONFLICT(id) DO NOTHING`,
          )
          .bind(pid, userId, b.name, b.level, b.terms, b.sourceType, b.sourceUrl, b.attribution, b.rawText, b.readingPosition, cts, now, b.contentRev ?? null, b.suggestedMinutes ?? null, b.sourceText ?? null)
      : d1
          .prepare(
            // content_rev / suggested_minutes: an older client omits them (NULL) and must never reset what a newer client stored.
            `UPDATE patterns SET name = ?3, level = ?4, terms = ?5, source_type = ?6, source_url = ?7, attribution = ?8, raw_text = ?9, reading_position = ?10,
               client_updated_at = ?11, updated_at = ?12, revision = revision + 1, content_rev = COALESCE(?14, content_rev), suggested_minutes = COALESCE(?15, suggested_minutes), source_text = COALESCE(?16, source_text)
             WHERE id = ?1 AND owner_id = ?2 AND revision = ?13 AND deleted_at IS NULL`,
          )
          .bind(pid, userId, b.name, b.level, b.terms, b.sourceType, b.sourceUrl, b.attribution, b.rawText, b.readingPosition, cts, now, b.baseRevision, b.contentRev ?? null, b.suggestedMinutes ?? null, b.sourceText ?? null);

  const res = await d1.batch([
    write,
    d1.prepare(`DELETE FROM pattern_rounds WHERE pattern_id = ?1 AND ${guard}`).bind(pid, userId, next, cts),
    d1
      .prepare(
        `INSERT INTO pattern_rounds (pattern_id, position, round_number, raw, parsed_ok, consumed, produced, declared_total)
         SELECT ?1, CAST(j.key AS INTEGER), json_extract(j.value, '$.n'), json_extract(j.value, '$.raw'), json_extract(j.value, '$.ok'),
                json_extract(j.value, '$.cons'), json_extract(j.value, '$.prod'), json_extract(j.value, '$.declared')
         FROM json_each(?5) AS j WHERE ${guard}`,
      )
      .bind(pid, userId, next, cts, rounds),
  ]);
  if (res[0]?.meta.changes === 1) return accepted(c, next, cts, now, b.baseRevision === 0);

  const cur = await db.select({ revision: patterns.revision, clientUpdatedAt: patterns.clientUpdatedAt, deletedAt: patterns.deletedAt }).from(patterns).where(and(eq(patterns.id, pid), eq(patterns.ownerId, userId))).get();
  if (!cur) throw notFound('Pattern');
  return conflict({ revision: cur.revision, clientUpdatedAt: cur.clientUpdatedAt, deleted: cur.deletedAt !== null });
});

entities.delete('/patterns/:id', async (c) => {
  const pid = idParam(c.req.param('id'));
  const db = c.get('db');
  const userId = c.get('userId');
  const now = Date.now();
  const row = await db.select({ id: patterns.id }).from(patterns).where(and(eq(patterns.id, pid), eq(patterns.ownerId, userId), isNull(patterns.deletedAt))).get();
  if (!row) return c.body(null, 204); // idempotent
  await deleteMediaWhere(c.env.MEDIA, db, and(eq(mediaObjects.userId, userId), eq(mediaObjects.patternId, pid)));
  await db.batch([
    db.update(projects).set({ patternId: null }).where(and(eq(projects.ownerId, userId), eq(projects.patternId, pid))),
    db.update(projectProgress).set({ patternId: null }).where(and(eq(projectProgress.ownerId, userId), eq(projectProgress.patternId, pid))),
    db.update(patterns).set({ deletedAt: now, updatedAt: now, filePath: null, fileName: null, fileSize: null, fileMime: null, revision: sql`${patterns.revision} + 1` }).where(and(eq(patterns.id, pid), eq(patterns.ownerId, userId))),
  ]);
  return c.body(null, 204);
});

/* ------------------------------------------------------------------ */
/* pattern collections (multi-part designs)                            */
/* ------------------------------------------------------------------ */

/** Same compare-and-swap contract as patterns; the parts are replaced atomically with the parent row (one D1 batch). */
entities.put('/collections/:id', async (c) => {
  const cid = idParam(c.req.param('id'));
  const b = await parseBody(c, collectionBody, MAX_MULTI_BYTES);
  const db = c.get('db');
  const d1 = c.env.DB;
  const userId = c.get('userId');
  const now = Date.now();
  const cts = clampClientTime(b.clientUpdatedAt, now);
  const next = b.baseRevision + 1;
  const parts = JSON.stringify(b.parts);

  const own = await db.select({ ownerId: patternCollections.ownerId }).from(patternCollections).where(eq(patternCollections.id, cid)).get();
  if (own && own.ownerId !== userId) throw notFound('Collection'); // never reveal or touch another user's collection

  const guard = `EXISTS (SELECT 1 FROM pattern_collections WHERE id = ?1 AND owner_id = ?2 AND revision = ?3 AND client_updated_at = ?4 AND deleted_at IS NULL)`;
  const write =
    b.baseRevision === 0
      ? d1
          .prepare(
            `INSERT INTO pattern_collections (id, owner_id, name, description, level, terms, cover_data, content_rev, suggested_minutes, source_text, client_updated_at, revision, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12, ?12) ON CONFLICT(id) DO NOTHING`,
          )
          .bind(cid, userId, b.name, b.description, b.level, b.terms, b.coverData, b.contentRev, b.suggestedMinutes, b.sourceText, cts, now)
      : d1
          .prepare(
            `UPDATE pattern_collections SET name = ?3, description = ?4, level = ?5, terms = ?6, cover_data = ?7, content_rev = ?8, suggested_minutes = ?9, source_text = ?10,
               client_updated_at = ?11, updated_at = ?12, revision = revision + 1
             WHERE id = ?1 AND owner_id = ?2 AND revision = ?13 AND deleted_at IS NULL`,
          )
          .bind(cid, userId, b.name, b.description, b.level, b.terms, b.coverData, b.contentRev, b.suggestedMinutes, b.sourceText, cts, now, b.baseRevision);

  const res = await d1.batch([
    write,
    d1.prepare(`DELETE FROM pattern_parts WHERE collection_id = ?1 AND ${guard}`).bind(cid, userId, next, cts),
    d1
      .prepare(
        `INSERT INTO pattern_parts (collection_id, part_id, position, name, quantity, raw_text, assembly_notes)
         SELECT ?1, json_extract(j.value, '$.id'), CAST(j.key AS INTEGER), json_extract(j.value, '$.name'), json_extract(j.value, '$.quantity'),
                json_extract(j.value, '$.rawText'), json_extract(j.value, '$.assemblyNotes')
         FROM json_each(?5) AS j WHERE ${guard}`,
      )
      .bind(cid, userId, next, cts, parts),
  ]);
  if (res[0]?.meta.changes === 1) return accepted(c, next, cts, now, b.baseRevision === 0);

  const cur = await db
    .select({ revision: patternCollections.revision, clientUpdatedAt: patternCollections.clientUpdatedAt, deletedAt: patternCollections.deletedAt })
    .from(patternCollections)
    .where(and(eq(patternCollections.id, cid), eq(patternCollections.ownerId, userId)))
    .get();
  if (!cur) throw notFound('Collection');
  return conflict({ revision: cur.revision, clientUpdatedAt: cur.clientUpdatedAt, deleted: cur.deletedAt !== null });
});

/**
 * Soft delete. Projects created from the collection are NOT touched: they hold their own pinned copy of every part's
 * instructions and keep working. The collection's revision history is kept.
 */
entities.delete('/collections/:id', async (c) => {
  const cid = idParam(c.req.param('id'));
  const db = c.get('db');
  const userId = c.get('userId');
  const now = Date.now();
  const row = await db.select({ id: patternCollections.id }).from(patternCollections).where(and(eq(patternCollections.id, cid), eq(patternCollections.ownerId, userId), isNull(patternCollections.deletedAt))).get();
  if (!row) return c.body(null, 204); // idempotent
  await db.batch([
    db.delete(patternParts).where(eq(patternParts.collectionId, cid)),
    db
      .update(patternCollections)
      .set({ deletedAt: now, updatedAt: now, coverData: null, revision: sql`${patternCollections.revision} + 1` })
      .where(and(eq(patternCollections.id, cid), eq(patternCollections.ownerId, userId))),
  ]);
  return c.body(null, 204);
});

/**
 * Immutable revision history. PUT is idempotent by (kind, entity, rev): the first write wins and history can never be rewritten.
 * The entity must belong to the caller (404 otherwise, no existence leak).
 */
entities.put('/revisions/:kind/:entityId/:rev', async (c) => {
  const kind = revisionKind.safeParse(c.req.param('kind'));
  if (!kind.success) throw badRequest('Invalid kind');
  const entityId = idParam(c.req.param('entityId'), 'entityId');
  const rev = Number(c.req.param('rev'));
  if (!Number.isInteger(rev) || rev < 1 || rev > 100000) throw badRequest('Invalid rev');
  const b = await parseBody(c, revisionBody, MAX_MULTI_BYTES);
  const db = c.get('db');
  const userId = c.get('userId');

  if (kind.data === 'pattern') {
    if (!b.snapshot.text && b.snapshot.text !== '') throw badRequest('A pattern revision needs snapshot.text');
    const owned = await db.select({ id: patterns.id }).from(patterns).where(and(eq(patterns.id, entityId), eq(patterns.ownerId, userId))).get();
    if (!owned) throw notFound('Pattern');
  } else {
    if (!b.snapshot.parts) throw badRequest('A collection revision needs snapshot.parts');
    const owned = await db.select({ id: patternCollections.id }).from(patternCollections).where(and(eq(patternCollections.id, entityId), eq(patternCollections.ownerId, userId))).get();
    if (!owned) throw notFound('Collection');
  }
  const ins = await db
    .insert(patternRevisions)
    .values({ ownerId: userId, entityKind: kind.data, entityId, rev, name: b.name, snapshot: JSON.stringify(b.snapshot), createdAt: Math.min(b.createdAt || Date.now(), Date.now()) })
    .onConflictDoNothing()
    .returning({ id: patternRevisions.id });
  return c.json({ rev }, ins[0] ? 201 : 200);
});

/* ------------------------------------------------------------------ */
/* projects                                                            */
/* ------------------------------------------------------------------ */

/** The collection must exist and belong to the caller (a soft-deleted one is fine: the project keeps its own pinned copy). */
async function assertOwnCollection(db: AppBindings['Variables']['db'], collectionId: string | null | undefined, userId: string) {
  if (!collectionId) return;
  const row = await db.select({ id: patternCollections.id }).from(patternCollections).where(and(eq(patternCollections.id, collectionId), eq(patternCollections.ownerId, userId))).get();
  if (!row) throw badRequest('Referenced collection is not accessible');
}

async function assertPatternReadable(db: AppBindings['Variables']['db'], patternId: string | null, userId: string) {
  if (!patternId) return;
  const p = await db
    .select({ id: patterns.id })
    .from(patterns)
    .where(and(eq(patterns.id, patternId), isNull(patterns.deletedAt), or(eq(patterns.isSample, true), eq(patterns.ownerId, userId))))
    .get();
  if (!p) throw badRequest('Referenced pattern is not accessible');
}

/** The project must exist, belong to the caller and not be deleted. Returns 404 either way (no existence leak). */
export async function assertOwnProject(db: AppBindings['Variables']['db'], projectId: string, userId: string) {
  const p = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.ownerId, userId), isNull(projects.deletedAt))).get();
  if (!p) throw notFound('Project');
}

entities.put('/projects/:id', async (c) => {
  const pid = idParam(c.req.param('id'));
  const b = await parseBody(c, projectBody);
  const db = c.get('db');
  const userId = c.get('userId');
  const now = Date.now();
  const cts = clampClientTime(b.clientUpdatedAt, now);
  await assertPatternReadable(db, b.patternId, userId);
  await assertOwnCollection(db, b.collectionId, userId);

  // cover_path is server-managed (set by the cover upload endpoint), never taken from this body.
  const fields = { name: b.name, category: b.category, hookSize: b.hookSize, yarnType: b.yarnType, status: b.status, patternId: b.patternId, ...(b.collectionId !== undefined ? { collectionId: b.collectionId } : {}), estimatedHours: b.estimatedHours, workedSeconds: b.workedSeconds, lastWorkedAt: b.lastWorkedAt };

  if (b.baseRevision === 0) {
    const ins = await db
      .insert(projects)
      .values({ id: pid, ownerId: userId, ...fields, clientUpdatedAt: cts, revision: 1, createdAt: Math.min(b.createdAt || now, now), updatedAt: now })
      .onConflictDoNothing()
      .returning({ revision: projects.revision });
    if (ins[0]) return accepted(c, 1, cts, now, true);
  } else {
    const upd = await db
      .update(projects)
      .set({ ...fields, clientUpdatedAt: cts, updatedAt: now, revision: sql`${projects.revision} + 1` })
      .where(and(eq(projects.id, pid), eq(projects.ownerId, userId), eq(projects.revision, b.baseRevision), isNull(projects.deletedAt)))
      .returning({ revision: projects.revision });
    if (upd[0]) return accepted(c, upd[0].revision, cts, now);
  }
  const cur = await db.select({ revision: projects.revision, clientUpdatedAt: projects.clientUpdatedAt, deletedAt: projects.deletedAt }).from(projects).where(and(eq(projects.id, pid), eq(projects.ownerId, userId))).get();
  if (!cur) throw notFound('Project');
  return conflict({ revision: cur.revision, clientUpdatedAt: cur.clientUpdatedAt, deleted: cur.deletedAt !== null });
});

entities.delete('/projects/:id', async (c) => {
  const pid = idParam(c.req.param('id'));
  const db = c.get('db');
  const userId = c.get('userId');
  const now = Date.now();
  const row = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, pid), eq(projects.ownerId, userId), isNull(projects.deletedAt))).get();
  if (!row) return c.body(null, 204); // idempotent
  await deleteMediaWhere(c.env.MEDIA, db, and(eq(mediaObjects.userId, userId), eq(mediaObjects.projectId, pid)));
  await db.batch([
    db.delete(projectPhotos).where(and(eq(projectPhotos.projectId, pid), eq(projectPhotos.ownerId, userId))),
    db.update(projects).set({ deletedAt: now, updatedAt: now, coverPath: null, revision: sql`${projects.revision} + 1` }).where(and(eq(projects.id, pid), eq(projects.ownerId, userId))),
  ]);
  return c.body(null, 204);
});

entities.put('/projects/:id/progress', async (c) => {
  const pid = idParam(c.req.param('id'));
  const b = await parseBody(c, progressBody, MAX_MULTI_BYTES);
  if (b.count > b.target) throw badRequest('count cannot exceed target');
  const db = c.get('db');
  const userId = c.get('userId');
  await assertOwnProject(db, pid, userId);
  await assertPatternReadable(db, b.patternId, userId);
  if (b.multiState) await assertOwnCollection(db, b.multiState.collectionId, userId);
  const now = Date.now();
  const cts = clampClientTime(b.clientUpdatedAt, now);
  const fields = {
    mode: b.mode, round: b.round, target: b.target, perTap: b.perTap, count: b.count, totalRounds: b.totalRounds, patternId: b.patternId,
    patternRoundIndex: b.patternRoundIndex, actionPtr: b.actionPtr, countMode: b.countMode, history: b.history, patternHistory: b.patternHistory,
    // undefined = an older client that does not know these columns: leave what is stored untouched.
    ...(b.multiState !== undefined ? { multiState: b.multiState } : {}),
    ...(b.patternSnapshot !== undefined ? { patternSnapshot: b.patternSnapshot } : {}),
  };

  if (b.baseRevision === 0) {
    const ins = await db.insert(projectProgress).values({ projectId: pid, ownerId: userId, ...fields, clientUpdatedAt: cts, revision: 1, updatedAt: now }).onConflictDoNothing().returning({ revision: projectProgress.revision });
    if (ins[0]) return accepted(c, 1, cts, now, true);
  } else {
    const upd = await db
      .update(projectProgress)
      .set({ ...fields, clientUpdatedAt: cts, updatedAt: now, revision: sql`${projectProgress.revision} + 1` })
      .where(and(eq(projectProgress.projectId, pid), eq(projectProgress.ownerId, userId), eq(projectProgress.revision, b.baseRevision)))
      .returning({ revision: projectProgress.revision });
    if (upd[0]) return accepted(c, upd[0].revision, cts, now);
  }
  const cur = await db
    .select({
      revision: projectProgress.revision, clientUpdatedAt: projectProgress.clientUpdatedAt, mode: projectProgress.mode, round: projectProgress.round, count: projectProgress.count,
      patternRoundIndex: projectProgress.patternRoundIndex, actionPtr: projectProgress.actionPtr, multiState: projectProgress.multiState,
    })
    .from(projectProgress)
    .where(and(eq(projectProgress.projectId, pid), eq(projectProgress.ownerId, userId)))
    .get();
  if (!cur) throw notFound('Progress');
  // The 409 carries the server's position so a stale device can compare progress, not just clocks, before deciding what to do.
  const { revision, clientUpdatedAt, multiState, ...state } = cur;
  const multi = multiPosition(multiState);
  return conflict({ revision, clientUpdatedAt, state: multi === null ? state : { ...state, multi } }); // `multi` only for multi-part projects (unchanged shape otherwise)
});

entities.put('/projects/:id/notes', async (c) => {
  const pid = idParam(c.req.param('id'));
  const b = await parseBody(c, notesBody);
  const db = c.get('db');
  const userId = c.get('userId');
  await assertOwnProject(db, pid, userId);
  const now = Date.now();
  const cts = clampClientTime(b.clientUpdatedAt, now);

  if (b.baseRevision === 0) {
    const ins = await db.insert(projectNotes).values({ projectId: pid, ownerId: userId, body: b.body, clientUpdatedAt: cts, revision: 1, updatedAt: now }).onConflictDoNothing().returning({ revision: projectNotes.revision });
    if (ins[0]) return accepted(c, 1, cts, now, true);
  } else {
    const upd = await db
      .update(projectNotes)
      .set({ body: b.body, clientUpdatedAt: cts, updatedAt: now, revision: sql`${projectNotes.revision} + 1` })
      .where(and(eq(projectNotes.projectId, pid), eq(projectNotes.ownerId, userId), eq(projectNotes.revision, b.baseRevision)))
      .returning({ revision: projectNotes.revision });
    if (upd[0]) return accepted(c, upd[0].revision, cts, now);
  }
  const cur = await db.select({ revision: projectNotes.revision, clientUpdatedAt: projectNotes.clientUpdatedAt }).from(projectNotes).where(and(eq(projectNotes.projectId, pid), eq(projectNotes.ownerId, userId))).get();
  if (!cur) throw notFound('Notes');
  return conflict(cur);
});

/* ------------------------------------------------------------------ */
/* work sessions (immutable, idempotent by id)                         */
/* ------------------------------------------------------------------ */

entities.put('/sessions/:id', async (c) => {
  const sid = idParam(c.req.param('id'));
  const b = await parseBody(c, sessionBody);
  if (b.endedAt < b.startedAt) throw badRequest('endedAt must not precede startedAt');
  const db = c.get('db');
  const userId = c.get('userId');
  await assertOwnProject(db, b.projectId, userId);
  const ins = await db.insert(workSessions).values({ id: sid, projectId: b.projectId, ownerId: userId, startedAt: b.startedAt, endedAt: b.endedAt, seconds: b.seconds, partInstanceId: b.partInstanceId ?? null }).onConflictDoNothing().returning({ id: workSessions.id });
  if (!ins[0]) {
    const existing = await db.select({ id: workSessions.id }).from(workSessions).where(and(eq(workSessions.id, sid), eq(workSessions.ownerId, userId))).get();
    if (!existing) throw notFound('Session');
  }
  return c.json({ id: sid }, ins[0] ? 201 : 200);
});

/* ------------------------------------------------------------------ */
/* favourites, tutorials, store interest                               */
/* ------------------------------------------------------------------ */

const itemId = (v: string | undefined) => {
  if (!v || !/^[A-Za-z0-9_.-]{1,64}$/.test(v)) throw badRequest('Invalid item id');
  return v;
};

entities.put('/favorites/:itemId', async (c) => {
  const item = itemId(c.req.param('itemId'));
  await c.get('db').insert(favorites).values({ userId: c.get('userId'), itemType: 'tutorial', itemId: item }).onConflictDoNothing();
  return c.body(null, 204);
});

entities.delete('/favorites/:itemId', async (c) => {
  const item = itemId(c.req.param('itemId'));
  await c.get('db').delete(favorites).where(and(eq(favorites.userId, c.get('userId')), eq(favorites.itemType, 'tutorial'), eq(favorites.itemId, item)));
  return c.body(null, 204);
});

entities.put('/tutorials/:tutorialId', async (c) => {
  const tid = itemId(c.req.param('tutorialId'));
  const b = await parseBody(c, tutorialBody);
  const db = c.get('db');
  const d1 = c.env.DB;
  const userId = c.get('userId');
  if (b.projectId) await assertOwnProject(db, b.projectId, userId);
  const now = Date.now();
  const cts = clampClientTime(b.clientUpdatedAt, now);
  const next = b.baseRevision + 1;
  const stamps = JSON.stringify(b.stamps);
  const guard = `EXISTS (SELECT 1 FROM tutorial_bookmarks WHERE user_id = ?1 AND tutorial_id = ?2 AND revision = ?3 AND client_updated_at = ?4)`;

  const write =
    b.baseRevision === 0
      ? d1
          .prepare(
            `INSERT INTO tutorial_bookmarks (id, user_id, tutorial_id, youtube_url, creator_name, project_id, notes, client_updated_at, revision, updated_at)
             VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8) ON CONFLICT(user_id, tutorial_id) DO NOTHING`,
          )
          .bind(userId, tid, b.youtubeUrl, b.creatorName, b.projectId, b.notes, cts, now)
      : d1
          .prepare(
            `UPDATE tutorial_bookmarks SET youtube_url = ?3, creator_name = ?4, project_id = ?5, notes = ?6, client_updated_at = ?7, updated_at = ?8, revision = revision + 1
             WHERE user_id = ?1 AND tutorial_id = ?2 AND revision = ?9`,
          )
          .bind(userId, tid, b.youtubeUrl, b.creatorName, b.projectId, b.notes, cts, now, b.baseRevision);

  const res = await d1.batch([
    write,
    d1
      .prepare(`DELETE FROM tutorial_timestamps WHERE user_id = ?1 AND bookmark_id = (SELECT id FROM tutorial_bookmarks WHERE user_id = ?1 AND tutorial_id = ?2) AND ${guard}`)
      .bind(userId, tid, next, cts),
    d1
      .prepare(
        `INSERT OR IGNORE INTO tutorial_timestamps (id, bookmark_id, user_id, seconds, note)
         SELECT json_extract(j.value, '$.id'), (SELECT id FROM tutorial_bookmarks WHERE user_id = ?1 AND tutorial_id = ?2), ?1, json_extract(j.value, '$.seconds'), json_extract(j.value, '$.note')
         FROM json_each(?5) AS j WHERE ${guard}`,
      )
      .bind(userId, tid, next, cts, stamps),
  ]);
  if (res[0]?.meta.changes === 1) return accepted(c, next, cts, now, b.baseRevision === 0);
  const cur = await db.select({ revision: tutorialBookmarks.revision, clientUpdatedAt: tutorialBookmarks.clientUpdatedAt }).from(tutorialBookmarks).where(and(eq(tutorialBookmarks.userId, userId), eq(tutorialBookmarks.tutorialId, tid))).get();
  if (!cur) throw notFound('Tutorial bookmark');
  return conflict(cur);
});

entities.put('/interest', async (c) => {
  const b = await parseBody(c, interestBody);
  await c.get('db').insert(storeInterest).values({ userId: c.get('userId'), email: b.email.trim() }).onConflictDoUpdate({ target: storeInterest.userId, set: { email: b.email.trim() } });
  return c.body(null, 204);
});

entities.delete('/interest', async (c) => {
  await c.get('db').delete(storeInterest).where(eq(storeInterest.userId, c.get('userId')));
  return c.body(null, 204);
});

/* ------------------------------------------------------------------ */
/* full pull                                                           */
/* ------------------------------------------------------------------ */

/** Everything the signed-in user owns, in one round trip (mirrors the app's existing pull merge). Samples are bundled in the app. */
entities.get('/sync/pull', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');
  const [profile, tools, pats, projs, progs, notes, photos, favs, bms, stamps, interest, cols, colParts, revs] = await Promise.all([
    db.select().from(profiles).where(eq(profiles.userId, userId)).get(),
    db.select({ kind: userTools.kind, value: userTools.value }).from(userTools).where(eq(userTools.userId, userId)),
    db.select().from(patterns).where(and(eq(patterns.ownerId, userId), isNull(patterns.deletedAt))),
    db.select().from(projects).where(and(eq(projects.ownerId, userId), isNull(projects.deletedAt))),
    db.select().from(projectProgress).where(eq(projectProgress.ownerId, userId)),
    db.select().from(projectNotes).where(eq(projectNotes.ownerId, userId)),
    db.select().from(projectPhotos).where(eq(projectPhotos.ownerId, userId)),
    db.select({ itemId: favorites.itemId }).from(favorites).where(and(eq(favorites.userId, userId), eq(favorites.itemType, 'tutorial'))),
    db.select().from(tutorialBookmarks).where(eq(tutorialBookmarks.userId, userId)),
    db.select().from(tutorialTimestamps).where(eq(tutorialTimestamps.userId, userId)),
    db.select({ email: storeInterest.email }).from(storeInterest).where(eq(storeInterest.userId, userId)).get(),
    db.select().from(patternCollections).where(and(eq(patternCollections.ownerId, userId), isNull(patternCollections.deletedAt))),
    db
      .select({ collectionId: patternParts.collectionId, partId: patternParts.partId, position: patternParts.position, name: patternParts.name, quantity: patternParts.quantity, rawText: patternParts.rawText, assemblyNotes: patternParts.assemblyNotes })
      .from(patternParts)
      .innerJoin(patternCollections, eq(patternParts.collectionId, patternCollections.id))
      .where(and(eq(patternCollections.ownerId, userId), isNull(patternCollections.deletedAt))),
    db.select({ entityKind: patternRevisions.entityKind, entityId: patternRevisions.entityId, rev: patternRevisions.rev, name: patternRevisions.name, snapshot: patternRevisions.snapshot, createdAt: patternRevisions.createdAt }).from(patternRevisions).where(eq(patternRevisions.ownerId, userId)),
  ]);
  const live = new Set(projs.map((p) => p.id));
  return c.json({
    serverTime: Date.now(),
    profile: profile ?? null,
    tools,
    patterns: pats,
    projects: projs,
    progress: progs.filter((p) => live.has(p.projectId)),
    notes: notes.filter((n) => live.has(n.projectId)),
    photos: photos.filter((p) => live.has(p.projectId)),
    favorites: favs.map((f) => f.itemId),
    tutorials: bms.map((b) => ({ ...b, stamps: stamps.filter((s) => s.bookmarkId === b.id).sort((a, z) => a.seconds - z.seconds) })),
    interest: interest?.email ?? null,
    collections: cols.map((col) => ({
      ...col,
      parts: colParts.filter((p) => p.collectionId === col.id).sort((a, z) => a.position - z.position).map(({ collectionId: _c, position: _p, partId, ...rest }) => ({ id: partId, ...rest })),
    })),
    revisions: revs.map((r) => ({ ...r, snapshot: safeJson(r.snapshot) })),
  });
});

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * One comparable number for a multi-part progress blob: the sum of every part instance's position (same formula as the app's
 * `position()` in sync.service.ts), so a stale device can tell whose multi-part progress is further along.
 */
function multiPosition(state: unknown): number | null {
  const inst = (state as { instances?: Array<{ mode?: string; simple?: { round?: number; count?: number }; cursor?: { roundIndex?: number; ptr?: number } }> } | null)?.instances;
  if (!Array.isArray(inst)) return null;
  return inst.reduce((sum, i) => sum + (i.mode === 'pattern' ? (i.cursor?.roundIndex ?? 0) * 1_000_000 + (i.cursor?.ptr ?? 0) : (i.simple?.round ?? 0) * 1_000_000 + (i.simple?.count ?? 0)), 0);
}

/** Deletes R2 objects + registry rows matching a filter. R2 first: an orphan row is harmless, an orphan object is a leak. */
export async function deleteMediaWhere(bucket: R2Bucket, db: AppBindings['Variables']['db'], where: ReturnType<typeof and>) {
  const rows = await db.select({ key: mediaObjects.key }).from(mediaObjects).where(where);
  for (let i = 0; i < rows.length; i += 500) await bucket.delete(rows.slice(i, i + 500).map((r) => r.key));
  if (rows.length) await db.delete(mediaObjects).where(where);
}
