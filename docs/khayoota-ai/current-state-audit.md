# Khayoota AI — Current-State Audit

Audited tree: branch `feat/khayoota-ai-agentic-planning`, created from `origin/development` @ **`e753481af29d1d0b4ceab09d5f70b985635c3454`** (2026-11-18, "Test: video counter spec no longer depends on the build environment (#7)"). No application file was changed.

Every row is **[Verified]** by reading the file at the cited line unless marked otherwise. Paths are relative to the repo root.

---

## 0. What is merged on `development` (checked in Git history and source, not assumed)

| Feature | Merged? | Evidence |
|---|---|---|
| Pattern Collections, multi-part tracker, pattern editing with revisions, Smart Pattern Parser, durable project timer | yes | merge `4f3b3b6`; `src/app/core/domain/collections.ts`, `revisions.ts`, `smart-parser.ts`; `src/app/core/services/timer.service.ts` |
| Crochet Joy, achievements, local reminders/notifications, share cards | yes | merge `b7c743c`; `src/app/core/joy/*`, `src/app/core/reminders/*`, `src/app/shared/ui/joy/*` |
| Cloudflare auth + sync (Hono Worker, D1, private R2, Better Auth) | yes | `apps/api/**`; client `src/app/core/api`, `core/auth`, `core/sync` |
| A real AI backend | **no** | no AI route, binding, model id or provider key anywhere in the repo (grep for `env.AI`, `@cf/`, `Workers AI`, `AI Gateway`, `gemini`, `llama`: no code hits) |

---

## 1–4. The existing assistant

| # | Topic | Finding |
|---|---|---|
| 1 | Service | `src/app/core/ai/assistant.service.ts` (168 lines). `AssistantService.ask(question, hasImage)` → `AssistantReply { text, demo }` (:12-16, :33). `connected = !!environment.aiEndpoint && api.configured` (:31) — evaluated once, **does not consider guest vs. signed-in**. |
| 2 | Screen + navigation | `src/app/features/ai-assistant/assistant.page.ts` (160 lines, inline template), route **`/tabs/assistant`** (`src/app/app.routes.ts:65`), fifth tab `{ id: 'assistant', icon: 'sparkles', ar: 'المساعد الذكي', en: 'AI Assistant' }` (`src/app/layout/tabs-layout/tabs.config.ts:18`). Other entry: Home quick tile (`home.page.ts:170`). **No entry from Project Details or the Tracker.** The page has no route inputs — it cannot be opened "about project X". |
| 3 | Demo / placeholder replies | Everything users see today is the deterministic bilingual rule set `demoReply()` (:113-167): explain round N, stuffing, inc vs dec, crooked work, checking counts, fallback. Replies are labelled "demo" in the UI (`assistant.page.ts:27-29,56-58`). `explainRound()` (:82-98) does exact stitch arithmetic from the strict parser and is also used by the Pattern Reader (`pattern-reader.page.ts:134,156`). |
| 4 | Configured endpoint | `environment.aiEndpoint` ← `GZ_AI_ENDPOINT` (`scripts/set-env.mjs:58`, `.env.example:24-25`, empty). When set, `ask()` POSTs `{ question, lang, context }` and expects `{ text }` (:36-37); any error silently falls back to demo (:38-40). **Nothing implements that path on the Worker.** |
| — | Context sent | `{ project: name, mode, round: raw }` (:55-60). Built from the **live** pattern (`store.pattern(p.tracker.patternId)`, :68), so it ignores the pinned revision and multi-part projects — see §13. |
| — | Images | The page has a photo input (`<input type="file" accept="image/*">`, `assistant.page.ts:77`) and shrinks to 600 px / q 0.7 (:156), but only a boolean reaches the service (:139). The image is shown in the bubble and **dropped on save** (`AppStore.setChat` strips `img`, `app.store.ts:560-564`). |
| — | History | Local only: last 40 messages, text only, per scope (guest / `user:<id>`), in IndexedDB docs; never synced; no "clear chat" control. |
| — | Tests | **No spec** for the service or the page. `tabs.config.spec.ts` / `tabs.layout.spec.ts` assert the assistant tab's id, order and labels (renaming the tab needs those updated). |

**Verdict — extend, do not duplicate.** The page, route, tab, chat bubble styles, local history, typing state and photo input already exist and are the right shell. What gets replaced is the *inside* of `AssistantService.ask()` (the `{text}` contract) and the context builder. The deterministic `explainRound` / `explainCurrent` stay: they are exact, offline, free, and become (a) the offline/guest fallback and (b) the source of the numbers Khayoota quotes.

---

## 5–10. Backend

| # | Topic | Finding |
|---|---|---|
| 5 | Authentication | Better Auth 1.7.25, **bearer tokens, no cookies** (`apps/api/src/auth.ts:85`; client `api.client.ts:49-52`). Email/password (PBKDF2-SHA256, 100,000 iterations — `services/password.ts`) and Google ID-token sign-in. Sessions 30 days. Client state: `AuthService.signedIn`, `guest`, `scope` (`src/app/core/auth/auth.service.ts:88-97`). |
| 6 | Worker architecture | One Worker, `apps/api/src/index.ts`: `secureHeaders` → guard/`requestId`/`db`/media-prefix middleware (:16-32) → CORS allow-list from `APP_ORIGINS` (:35-44) → `/health` → `/api/auth/*` → `/v1/*` behind `requireUser` (:54-58) → JSON 404 / `errorResponse`. Bindings: `DB`, `MEDIA` only (`wrangler.jsonc`, `env.ts`). No `env.production` block. |
| 7 | Hono routes | `routes/entities.ts` (profile, tools, patterns, collections, revisions, projects, progress, notes, sessions, favorites, tutorials, interest, `GET /v1/sync/pull`) and `routes/media.ts` (project photos, covers, pattern files, owner-only object GET/DELETE). **All writes are PUT/DELETE with compare-and-swap on `revision`; there is no POST under `/v1` and no per-entity GET** — reads happen through `/v1/sync/pull`. |
| 8 | D1 models | `apps/api/src/db/schema.ts`; 4 migrations (`0000`–`0003`), all applied on staging (see `cloudflare-readiness.md`). Owner columns on every user table; soft delete on `patterns`, `pattern_collections`, `projects`. Relevant: `patterns` (`raw_text` ≤ 20,000, `source_text`, `source_type` enum includes `image`), `pattern_collections` / `pattern_parts`, `pattern_revisions` (immutable snapshots), `project_progress` (`multi_state`, `pattern_snapshot` JSON), `project_photos`, `media_objects`, `rate_limit`. |
| 9 | R2 photo storage | Private bucket; **raw bytes through the Worker**, buffered in memory (`services/media.ts:33-58`), magic-byte sniffing, 8 MiB images / 10 MiB pattern files, keys `${userId}/${projectId}/${photoId}.${ext}`, staging prefix `staging/`. Reads only via `GET /v1/media/object?key=` after an owner lookup in `media_objects`; same 404 for missing and foreign keys (`routes/media.ts:105-124`). No presigned URLs by design (`docs/cloudflare-migration/storage-strategy.md:53`). |
| 10 | Client upload mechanisms | No `@capacitor/camera`. Every picker is `<input type="file" accept="image/*">`. `readImageFile(file, maxEdge=1280, quality=0.8)` (`src/app/core/utils/image.ts:7-36`) validates (≤ 8 MB; jpeg/png/webp/heic/heif), draws to a canvas and re-encodes as JPEG — which also discards EXIF. Uploads go through the sync outbox (signed-in only). |
| — | Rate limiting | Only Better Auth's limiter on `/api/auth/*` (D1 table `rate_limit`, `auth.ts:71-84`). **No limiter on `/v1/*`.** |
| — | Body limits | Per handler: JSON 256 KB (`validators.ts:5`), 900 KB for collections/revisions/progress (:79); `parseBody` checks `content-length` then the read text (:219-233). |
| — | Validation | Zod 4.6.7 on the Worker. **No Zod (or any schema library) in the client.** |
| — | Tests | `apps/api/tests/*` via `@cloudflare/vitest-plugin`, in-process `app.request(...)`; cross-user isolation suites in `sync.test.ts:236-290`, `collections.test.ts:97-108`, `media.test.ts:46-59`. Remote smoke: `scripts/smoke-remote.mjs` (29 checks). Client integration: `e2e/*.e2e.ts` against a local Worker. |

---

## 11–13. Patterns

| # | Topic | Finding |
|---|---|---|
| 11 | Parser architecture | **Two layers.** (a) Strict parser `src/app/core/domain/pattern-parser.ts` — what the tracker executes. 12 stitch kinds (`sc hdc dc tr inc dec` + `hdc/dc/tr-inc/-dec`, :28), `STITCH_IO` (:31-44), one whole-line repeat group, `[N]` totals, `in MR`, `in <piece>` joins; anything else → `ok:false`. (b) Smart converter `src/app/core/domain/smart-parser.ts` — "deterministic, NO AI, NO network, NO OCR" (:2): free Arabic/English text → strict notation, with per-round status **`'validated' | 'needs-review' | 'unsupported'`** (:28), bilingual messages with stable codes (`total-mismatch`, `chain`, `joins`, `ambiguous`, `assumed-sc`, `loop`, `unsupported`, `each-unknown`, `strict-mismatch`, …), part headings + quantities, assembly notes kept verbatim, UK→US conversion. Its guarantees (:16-20): totals are only ever calculated; shaping keeps its stitch type; unknown text is kept verbatim. Every emitted line is re-parsed by the strict parser (:675-678). |
| — | **Notation gaps that matter for AI extraction** | Not supported by either layer: **chains (`ch`), slip stitches, skips, turning chains**, front/back-loop stitches (explicit `loop` error, :300, :635), `*…* repeat from *`, more than one repeat group per round in strict form, >2 stitches into one stitch. **Confirmed by executing `convertPatternText` on probe lines (2026-11-18):** Arabic magic ring (`في حلقة سحرية`), `في MR`, the plural `غرز قصيرة`, a spaced range (`٥ - ٧`) and `2 sc in each st` all return `unsupported`, while their close variants (`in MR`, `غرزة قصيرة`, `٥-٧`, `inc in each st`) validate. Details and the probe table: `pattern-extraction-pipeline.md` §7. These are parser limits, not AI limits — and they bound what any extraction can ever mark *Validated*. |
| 12 | Collection / part models | `src/app/core/models/models.ts`: `Pattern` (:78-102, `rev`, `sourceText`, `source: 'sample'|'text'|'pdf'|'image'|'youtube'`), `PatternPart { id, name, quantity, text, assemblyNotes }` and `PatternCollection` (:105-132), `PatternRevision` (:135-146), `PatternPin` (:62-67). Limits: 30 parts, quantity ≤ 30 (`collections.ts:26-27`). |
| 13 | Revisions + pinning | `AppStore.savePatternEdit` (`app.store.ts:344`): if text/terms changed → records an append-only revision, **pins every project following the pattern to the old text**, bumps `rev`. `saveCollectionEdit` (:386) likewise. Collection projects freeze `partSnapshots` at creation. `trackerView(p)` (:436-458) is the single correct reader: it returns the pinned/snapshot text, the active instance and an `outdated` flag. Moving a project to a newer revision is always an explicit user action — `mapCursor` (`revisions.ts:108`, levels `safe|warn|unsafe`, :76) never resets progress; UI: "Review the update" sheet (`project-detail.page.ts:197-208`, :294-306, :396-412). |
| — | **Existing inconsistency** | `AssistantService.ctx` (`assistant.service.ts:66-72`), `AssistantPage.ctx` (`assistant.page.ts:105-109`) and `AppStore.progress` (`app.store.ts:599-606`) read the **live** pattern, not `trackerView`. For a pinned project the assistant would explain the wrong text; for a multi-part project it has no pattern at all. Khayoota's context builder must use `trackerView`. |

---

## 14–15. Project and tracker state

| # | Topic | Finding |
|---|---|---|
| 14 | Project / active part | `Project` (`models.ts:28-59`): three shapes — simple counter, standalone pattern (`tracker.patternId`, optional `patternPin`), collection project (`collectionId`, `parts: PartInstance[]`, `partSnapshots`, `activeInstanceId`). Readers: `store.currentProject` (:81), `store.project(id)`, `store.activeInstance(p)` (:429), `store.trackerView(p)` (:436). Per-part progress helpers in `collections.ts`: `instanceProgress` (:112), `projectCompletion` (:131), `nextUnfinished` (:141), `instanceLabel` (:85). |
| 15 | Tracker + cursor | Route `/tabs/tracker` **takes no params** and always shows `currentProject`. To open a specific project/part: `TrackerNavigator.open(projectId, instanceId = null, allowDone = false)` → `'opened' | 'missing' | 'done'` (`src/app/core/services/tracker-navigator.service.ts:23`). Cursor: `PatternCursor { roundIndex, ptr, mode, history }` (`tracker-engine.ts:120-127`). Read path for "current round + expected total": `trackerView(p)` → `parsePattern(source.text)` → `patternContext(parsed, cursor)` → `ParsedRound { raw, n, declared, prod, cons, mismatch, joins }`; `patternStats` for progress. Mutations only through `AppStore.updateTracker` / `updatePartTracker` (:219, :461) with a `JoyOrigin`. |

---

## 16–19. UI infrastructure

| # | Topic | Finding |
|---|---|---|
| 16 | Error handling | Client `ApiError { status, code, message, current? }` with `isNetwork` (0/408/429/≥502), `isUnauthorized`, `isConflict` (`api.client.ts:9-29`); server envelope `{ error: { code, message, details? } }` (`apps/api/src/errors.ts:20`). No HTTP interceptors. `NetworkService.online` signal. |
| 17 | "Component registry" | There is **no dynamic component registry** and none is needed today. Reusable pieces: `gz-sheet` (the one bottom-sheet/dialog container, actions projected via `gzActions`), `gz-photo`, `gz-crochet-avatar` / `gz-avatar-reaction` (moods `happy | celebrate | proud | relaxed`), `gz-ring`, `gz-stepper`, `svg[gzIcon]`, plus CSS primitives in `src/theme/components.scss`: `.gz-card`, `.gz-note (.lav/.sage/.err)`, `.gz-chip`, `.gz-badge`, `.gz-btn/.gz-btn2/.gz-btn3`, `.gz-msg (.u/.a)`, `.gz-sk` skeleton. Catalogue page: `/design-system`. |
| 18 | Toast / dialog / sheet / forms | `UiFeedback.toast(msg)`, `.say(ar, en)`, `.confirm(header, message, confirmText, destructive, cancelText)` (`src/app/shared/ui/feedback/toast.service.ts`). Sheets via `gz-sheet`. Forms: Angular reactive forms with `unsavedChangesGuard` on the editors. |
| — | Draft hand-off (the key reuse) | `ImportDraftService` (`src/app/features/patterns/import-draft.service.ts`): in-memory, one-shot `offer(draft)` / `take(target)` / `discard()` (:30-42) with `ImportDraft { target: 'collection'|'pattern', collectionName, sourceText, parts: DraftPart[] }`. `AddPatternPage.ionViewWillEnter` (`add-pattern.page.ts:268-279`) and `CollectionEditorPage.ionViewWillEnter` (`collection-editor.page.ts:255-266`) consume it and mark the form dirty — **the editor opens populated and unsaved**. `SmartImportPage` (`/tabs/home/patterns/import?target=`) is the existing paste → convert → preview → confirm flow; it has **no way to be opened with pre-filled text** today. |
| 19 | Tests and mocks | Client unit tests on Vitest/jsdom via `ng test`. Reusable patterns: real `AppStore` + `LocalDb` with a fake `AuthService { scope, signedIn, guest }` (`video-detail.page.spec.ts:33-40`); hand-rolled `ApiClient` fake (`auth.service.spec.ts:63-85`). Specs must pass with and without an API URL configured. |
| — | i18n / theme | `I18nService` (`lang`, `isAr`, `t`, `q(ar, en)`), `strings.ts` (Arabic is Egyptian colloquial, feminine address). Playpen Sans Arabic / Playpen Sans (`src/theme/tokens.css:55-56`), RTL by default, safe-area tokens `--gz-safe-top/bottom`, `--gz-tab-float`, Android immersive mode (`ImmersiveService`). |

---

## 20. Offline-first data flow

- IndexedDB (`idb`) database `gharzetak` v4, scoped records `guest` / `user:<id>` (`src/app/core/storage/local-db.ts`). `AppStore` is the single state + repository facade.
- Signed-in: outbox → `SyncService` push (CAS, conflict rules, backups) and `GET /v1/sync/pull`.
- **Guest: nothing leaves the device** (`queue()` returns early, `app.store.ts:157-158`). Every feature including Smart Paste, tracker, timers and Joy works locally.
- Consequence for AI: the freshest truth about a project is **on the device**, and for guests it exists nowhere else. The server copy can lag behind taps. This drives the decision to assemble Khayoota's project context on the client (`multimodal-architecture.md` §5).

---

## Knowledge content already in the app

`src/app/core/data/catalog.ts` (static, bilingual): `TERMS` — 15 glossary entries (`ch sl sc hdc dc tr dtr inc dec mr flo blo st sk rnd`) with US/UK names, Arabic/English explanations and examples (:65-89); `ACTN` — names of the 12 tracker stitch kinds (:50-63); `VIDEOS` — 10 tutorial *topics* (`magic-ring`, `sc-basic`, `inc-dec`, `invisible-dec`, `read-pattern`, `amigurumi-assemble`, `granny`, `no-twist`, `sweater`, `basket`) (:96-107). Routes: `/tabs/home/terms` (dictionary + converter, **no per-term deep link**), `/tabs/learn/:id` (an unknown id silently falls back to the first topic — `video-detail.page.ts:47`). Plus the parser's Arabic/English stitch synonym tables (`smart-parser.ts:125-144`).

---

## Reuse map

| Need | Reuse | Change required |
|---|---|---|
| Chat screen, tab, route | `AssistantPage`, `/tabs/assistant` | Rebrand; add optional route inputs (`project`, `part`, `intent`); render reply cards/actions. |
| Local chat history | `AppStore.chat` / `setChat` | Extend `ChatMessage` with optional `actions`, `cards`, `source: 'demo'|'ai'`; add "clear chat". |
| Offline / guest answers | `AssistantService.demoReply`, `explainRound`, `explainCurrent` | Keep as the labelled offline fallback. |
| Project context | `store.trackerView`, `parsePattern`, `patternContext`, `patternStats`, `nextUnfinished`, `instanceLabel` | New pure `buildKhayootaContext(store, projectId?)`; fix the live-pattern inconsistency. |
| Open tracker at a part | `TrackerNavigator.open` | none |
| Image preparation | `readImageFile` | Call with larger edge for extraction (e.g. 1568 px, q 0.85); optional native camera later. |
| Draft review | `SmartImportPage` + `convertPatternText` + `ImportDraftService` | Add a seed entry (pre-filled text + AI line flags + source thumbnails). |
| Populate editors unsaved | `ImportDraftService.offer` → `AddPatternPage` / `CollectionEditorPage` | none for new patterns; small addition for "propose correction" on edit. |
| Stitch explanation | `TERMS`, `ACTN`, `VIDEOS`, `/tabs/learn/:id` | Inline card; validate topic ids before navigating. |
| Dialogs, toasts, cards | `gz-sheet`, `UiFeedback`, `.gz-card`, `.gz-note`, avatars | none |
| HTTP + errors | `ApiClient.post`, `ApiError` | Add AI error codes; optional streaming reader later. |
| Worker auth + validation + errors | `requireUser`, `parseBody` + Zod, `ApiError` envelope, `requestId` | New `/v1/ai` sub-app, usage ledger table, `AI` binding, rate-limit binding. |
| Private images | existing R2 media routes | **Not needed for the MVP** (images are sent inline and not stored). |
