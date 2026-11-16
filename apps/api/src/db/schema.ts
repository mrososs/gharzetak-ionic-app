import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * D1 (SQLite) schema for Gharzetak. Mapping from the Supabase/PostgreSQL schema:
 *  - uuid            -> text (client-generated UUIDs are kept, so ids are stable across the migration)
 *  - timestamptz     -> integer epoch milliseconds (matches the app's number timestamps)
 *  - boolean         -> integer 0/1 (drizzle `mode: 'boolean'`)
 *  - text[] / jsonb  -> text holding JSON (drizzle `mode: 'json'`)
 *  - numeric(6,1)    -> real
 *  - CHECK constraints are kept 1:1 (SQLite supports them; regex checks are enforced in the API instead)
 *  - RLS             -> every query in the API is scoped by the authenticated user id
 *
 * Concurrency: every mutable synced row carries `revision` (a server-owned counter incremented on
 * every accepted write) and `client_updated_at` (a clamped hint from the device clock). Writes are
 * compare-and-swap on `revision`, so a stale device can never silently overwrite newer data.
 */

const now = sql`(unixepoch() * 1000)`;

/* ------------------------------------------------------------------ */
/* Better Auth core tables (text ids; managed by Better Auth)          */
/* ------------------------------------------------------------------ */

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
});

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [index('account_user_idx').on(t.userId)],
);

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

/** Better Auth database-backed rate limiter (in-memory limiting is useless across Worker isolates). */
export const rateLimit = sqliteTable('rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: integer('last_request').notNull(),
});

/* ------------------------------------------------------------------ */
/* profiles & preferences                                              */
/* ------------------------------------------------------------------ */

export const profiles = sqliteTable(
  'profiles',
  {
    userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull().default(''),
    level: text('level').notNull().default('beginner'),
    terms: text('terms').notNull().default('us'),
    locale: text('locale').notNull().default('ar'),
    interests: text('interests', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    onboarded: integer('onboarded', { mode: 'boolean' }).notNull().default(false),
    /** Bundled preset crochet avatar id (see AVATAR_IDS in validators.ts). NULL = never chosen → clients show their default. */
    avatarId: text('avatar_id'),
    clientUpdatedAt: integer('client_updated_at').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    /** Tools (hooks/yarn/accessories) are a replace-all set with their own revision. */
    toolsRevision: integer('tools_revision').notNull().default(0),
    toolsClientUpdatedAt: integer('tools_client_updated_at').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  () => [
    check('profiles_display_name_len', sql`length(display_name) <= 80`),
    check('profiles_level', sql`level in ('beginner','intermediate','advanced')`),
    check('profiles_terms', sql`terms in ('us','uk')`),
    check('profiles_locale', sql`locale in ('ar','en')`),
    check('profiles_avatar_id', sql`avatar_id is null or avatar_id in ('bunny','cat','bear','sheep','flower','yarn')`),
  ],
);

export const userTools = sqliteTable(
  'user_tools',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    value: text('value').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('user_tools_unique').on(t.userId, t.kind, t.value),
    index('user_tools_user_idx').on(t.userId),
    check('user_tools_kind', sql`kind in ('hook','yarn','accessory')`),
    check('user_tools_value_len', sql`length(value) between 1 and 40`),
  ],
);

/* ------------------------------------------------------------------ */
/* patterns                                                            */
/* ------------------------------------------------------------------ */

export const patterns = sqliteTable(
  'patterns',
  {
    id: text('id').primaryKey(),
    /** null = built-in sample (readable by everyone, writable by nobody through the API). */
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'cascade' }),
    isSample: integer('is_sample', { mode: 'boolean' }).notNull().default(false),
    name: text('name').notNull(),
    nameAr: text('name_ar'),
    nameEn: text('name_en'),
    level: text('level').notNull().default('beginner'),
    terms: text('terms').notNull().default('us'),
    sourceType: text('source_type').notNull().default('text'),
    sourceUrl: text('source_url'),
    attribution: text('attribution'),
    rawText: text('raw_text').notNull().default(''),
    filePath: text('file_path'),
    fileName: text('file_name'),
    fileSize: integer('file_size'),
    fileMime: text('file_mime'),
    readingPosition: integer('reading_position').notNull().default(0),
    clientUpdatedAt: integer('client_updated_at').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
    /** Soft-delete tombstone. */
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    index('patterns_owner_idx').on(t.ownerId),
    check('patterns_owner_or_sample', sql`(is_sample = 1 and owner_id is null) or (is_sample = 0 and owner_id is not null)`),
    check('patterns_name_len', sql`length(name) between 1 and 120`),
    check('patterns_level', sql`level in ('beginner','intermediate','advanced')`),
    check('patterns_terms', sql`terms in ('us','uk')`),
    check('patterns_source_type', sql`source_type in ('sample','text','pdf','image','youtube')`),
    check('patterns_raw_text_len', sql`length(raw_text) <= 20000`),
    check('patterns_file_size', sql`file_size is null or file_size between 0 and 10485760`),
    check('patterns_reading_position', sql`reading_position >= 0`),
  ],
);

export const patternRounds = sqliteTable(
  'pattern_rounds',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    patternId: text('pattern_id').notNull().references(() => patterns.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    roundNumber: integer('round_number').notNull(),
    raw: text('raw').notNull(),
    parsedOk: integer('parsed_ok', { mode: 'boolean' }).notNull(),
    consumed: integer('consumed').notNull().default(0),
    produced: integer('produced').notNull().default(0),
    declaredTotal: integer('declared_total'),
  },
  (t) => [uniqueIndex('pattern_rounds_unique').on(t.patternId, t.position), check('pattern_rounds_position', sql`position >= 0`)],
);

/* ------------------------------------------------------------------ */
/* projects & progress                                                 */
/* ------------------------------------------------------------------ */

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: text('category').notNull().default('amigurumi'),
    hookSize: text('hook_size').notNull().default('3.0'),
    yarnType: text('yarn_type').notNull().default('cotton'),
    status: text('status').notNull().default('active'),
    patternId: text('pattern_id').references(() => patterns.id, { onDelete: 'set null' }),
    coverPath: text('cover_path'),
    estimatedHours: real('estimated_hours').notNull().default(0),
    workedSeconds: integer('worked_seconds').notNull().default(0),
    lastWorkedAt: integer('last_worked_at').notNull().default(now),
    clientUpdatedAt: integer('client_updated_at').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    index('projects_owner_idx').on(t.ownerId, t.updatedAt),
    check('projects_name_len', sql`length(name) between 1 and 120`),
    check('projects_category', sql`category in ('amigurumi','clothes','accessories','home','gifts')`),
    check('projects_hook_len', sql`length(hook_size) <= 10`),
    check('projects_yarn', sql`yarn_type in ('cotton','acrylic','wool','velvet','blend','milk')`),
    check('projects_status', sql`status in ('active','paused','done')`),
    check('projects_hours', sql`estimated_hours >= 0`),
    check('projects_worked', sql`worked_seconds >= 0`),
  ],
);

/** Schema parity with Supabase. The current app does not sync parts yet; no API route uses this table. */
export const projectParts = sqliteTable(
  'project_parts',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    patternId: text('pattern_id').references(() => patterns.id, { onDelete: 'set null' }),
    clientUpdatedAt: integer('client_updated_at').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [index('project_parts_project_idx').on(t.projectId), check('project_parts_name_len', sql`length(name) between 1 and 80`)],
);

export const projectProgress = sqliteTable(
  'project_progress',
  {
    projectId: text('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull().default('simple'),
    round: integer('round').notNull().default(1),
    target: integer('target').notNull().default(30),
    perTap: integer('per_tap').notNull().default(1),
    count: integer('count').notNull().default(0),
    totalRounds: integer('total_rounds').notNull().default(0),
    patternId: text('pattern_id').references(() => patterns.id, { onDelete: 'set null' }),
    patternRoundIndex: integer('pattern_round_index').notNull().default(0),
    actionPtr: integer('action_ptr').notNull().default(0),
    countMode: text('count_mode').notNull().default('action'),
    history: text('history', { mode: 'json' }).$type<unknown[]>().notNull().default(sql`'[]'`),
    patternHistory: text('pattern_history', { mode: 'json' }).$type<unknown[]>().notNull().default(sql`'[]'`),
    clientUpdatedAt: integer('client_updated_at').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [
    index('project_progress_owner_idx').on(t.ownerId),
    check('project_progress_mode', sql`mode in ('simple','pattern')`),
    check('project_progress_round', sql`round >= 1`),
    check('project_progress_target', sql`target between 1 and 999`),
    check('project_progress_per_tap', sql`per_tap between 1 and 99`),
    check('project_progress_count', sql`count >= 0`),
    check('project_progress_total_rounds', sql`total_rounds >= 0`),
    check('project_progress_round_index', sql`pattern_round_index >= 0`),
    check('project_progress_action_ptr', sql`action_ptr >= 0`),
    check('project_progress_count_mode', sql`count_mode in ('action','group','round')`),
    check('project_progress_count_le_target', sql`count <= target`),
  ],
);

export const projectNotes = sqliteTable(
  'project_notes',
  {
    projectId: text('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    body: text('body').notNull().default(''),
    clientUpdatedAt: integer('client_updated_at').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  () => [check('project_notes_body_len', sql`length(body) <= 10000`)],
);

export const projectPhotos = sqliteTable(
  'project_photos',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    isCover: integer('is_cover', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    index('project_photos_project_idx').on(t.projectId),
    check('project_photos_mime', sql`mime_type in ('image/jpeg','image/png','image/webp')`),
    check('project_photos_size', sql`size_bytes between 1 and 8388608`),
  ],
);

export const workSessions = sqliteTable(
  'work_sessions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at').notNull(),
    seconds: integer('seconds').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    index('work_sessions_project_idx').on(t.projectId),
    check('work_sessions_seconds', sql`seconds between 0 and 86400`),
    check('work_sessions_order', sql`ended_at >= started_at`),
  ],
);

/* ------------------------------------------------------------------ */
/* favourites, tutorials, store interest                               */
/* ------------------------------------------------------------------ */

export const favorites = sqliteTable(
  'favorites',
  {
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    itemType: text('item_type').notNull(),
    itemId: text('item_id').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.itemType, t.itemId] }),
    check('favorites_item_type', sql`item_type in ('tutorial','pattern')`),
    check('favorites_item_id_len', sql`length(item_id) <= 64`),
  ],
);

export const tutorialBookmarks = sqliteTable(
  'tutorial_bookmarks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    tutorialId: text('tutorial_id').notNull(),
    youtubeUrl: text('youtube_url'),
    creatorName: text('creator_name'),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    notes: text('notes').notNull().default(''),
    clientUpdatedAt: integer('client_updated_at').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('tutorial_bookmarks_unique').on(t.userId, t.tutorialId),
    check('tutorial_bookmarks_tid_len', sql`length(tutorial_id) <= 64`),
    check('tutorial_bookmarks_notes_len', sql`length(notes) <= 10000`),
  ],
);

export const tutorialTimestamps = sqliteTable(
  'tutorial_timestamps',
  {
    id: text('id').primaryKey(),
    bookmarkId: text('bookmark_id').notNull().references(() => tutorialBookmarks.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    seconds: integer('seconds').notNull(),
    note: text('note').notNull().default(''),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    index('tutorial_timestamps_bookmark_idx').on(t.bookmarkId),
    check('tutorial_timestamps_seconds', sql`seconds between 0 and 86400`),
    check('tutorial_timestamps_note_len', sql`length(note) <= 300`),
  ],
);

export const storeInterest = sqliteTable('store_interest', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  createdAt: integer('created_at').notNull().default(now),
});

/* ------------------------------------------------------------------ */
/* R2 object registry                                                  */
/* ------------------------------------------------------------------ */

/**
 * Every object stored in the private R2 bucket has a row here. Download/delete authorise against
 * this row (user_id), never by parsing the key, so a crafted key can never reach another user's file.
 */
export const mediaObjects = sqliteTable(
  'media_objects',
  {
    key: text('key').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    patternId: text('pattern_id').references(() => patterns.id, { onDelete: 'cascade' }),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    index('media_objects_user_idx').on(t.userId),
    index('media_objects_project_idx').on(t.projectId),
    index('media_objects_pattern_idx').on(t.patternId),
    check('media_objects_kind', sql`kind in ('project-photo','project-cover','pattern-file')`),
  ],
);

