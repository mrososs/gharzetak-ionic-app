# Storage strategy (Cloudflare R2)

## Bucket

`gharzetak-media`, verified read-only through the Cloudflare MCP on 2026-11-16:

| Property | Value |
|---|---|
| Location / class / jurisdiction | WEUR / Standard / default |
| `r2.dev` managed public domain | **disabled** (`enabled: false`) |
| Custom domains | none |
| Binding in the Worker | `MEDIA` (`apps/api/wrangler.jsonc`) |

The bucket is **private and stays private**: nothing serves it publicly. The Worker is the only reader/writer. Do **not** enable the
`r2.dev` domain or attach a custom domain to this bucket.

## Sharing one bucket between environments

Staging uses the same bucket with `MEDIA_PREFIX=staging/`. A bucket wrapper (`src/services/prefixed-bucket.ts`) prefixes every R2 key for put/get/head/delete/list;
D1 and API responses keep the unprefixed key. Tested: objects land under `staging/`, are invisible through another prefix and are removed with their project.
This is an **application-level** boundary (the Worker binding can still reach the whole bucket); prefer a separate staging bucket before production shares it.

## Endpoints (all require `Authorization: Bearer`)

| Method | Path | Purpose |
|---|---|---|
| `PUT` | `/v1/media/project-photos/:projectId/:photoId` | upload a progress photo (raw bytes) |
| `PUT` | `/v1/media/project-covers/:projectId` | set the cover (replaces + deletes the previous one) |
| `PUT` | `/v1/media/pattern-files/:patternId` | upload a pattern PDF/image (`X-File-Name` percent-encoded) |
| `GET` | `/v1/media/object?key=...` | owner-only download (supports `If-None-Match` -> 304) |
| `DELETE` | `/v1/media/object?key=...` | owner-only delete (idempotent) |

Deleting a project or pattern also deletes its R2 objects.

## Security properties (each covered by `apps/api/tests/media.test.ts`)

* **Authorisation by registry row**: every object has a `media_objects` row (`user_id`). Download/delete look up `(key, user_id)`; a missing file and
  someone else's file return the **same 404**. A crafted key (`../`, leading `/`, over-long) is rejected (400/404).
* **Real type validation**: leading bytes are sniffed (JPEG/PNG/WebP/PDF). The client's `Content-Type` is only cross-checked
  (`octet-stream` defers to the sniffed type). HTML disguised as JPEG -> 415; a PNG declared as JPEG -> 415.
* **Size limits enforced while streaming**: photos/covers 8 MiB, pattern files 10 MiB (same as the Supabase buckets); `Content-Length` is checked first,
  then the stream is cut off at the limit (413). Exactly-at-limit succeeds. Empty body -> 400.
* **Nothing leaks on rejection**: rejected uploads write nothing to R2 (object count equals registry rows in the test).
* **Server-managed paths**: `cover_path`, `file_*` and photo rows are only set by upload endpoints; a project `PUT` cannot point `cover_path` at someone
  else's key (tested).
* **Safe responses**: `Cache-Control: private, max-age=0, must-revalidate`, `ETag`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`.
* **Keys keep the Supabase layout** (`<userId>/<projectId|patternId>/<file>`), so migrated objects would map 1:1.

## How the Angular app displays private images

`<img src>` cannot send a bearer header, so `SyncService.mediaUrl(key)` downloads the bytes through the API and exposes a cached `blob:` URL
(revoked when the account changes). `PhotoComponent` is unchanged apart from calling that method. Verified byte-for-byte in `e2e/sync.e2e.ts`.
Presigned/temporary public URLs were deliberately **not** used.

## Existing Supabase Storage objects

None exist (no hosted project). A migration script was **not written**: it would be dead code. If objects are ever found, copy
`<bucket>/<uid>/<id>/<file>` with the same key, register a `media_objects` row per object, and verify counts/sizes before any deletion; never delete the source.
