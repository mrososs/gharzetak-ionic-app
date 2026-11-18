# Pattern collections, editing, Smart paste, time tracking & mobile UX — architecture

Branch `feat/pattern-collections-editor-parser` (from `development`). Nothing here was deployed: no remote Cloudflare resource
was touched and no remote D1 migration was run (see "Approvals still needed").

## Phase 0 — audit summary (what existed → smallest safe change)

| Area | Existing | Change |
|---|---|---|
| Pattern model | `Pattern {text, terms, level, position…}`, strict parser, `project.tracker.patternId` | additive optional fields `rev`, `sourceText`, `suggestedMinutes` |
| Parser | `parsePattern` — sc/hdc/dc/tr/inc/dec only; hdc shaping impossible | new kinds `hdc-inc/hdc-dec/dc-*/tr-*`, `in <piece>` join references (cons 0, flagged) — old text parses identically |
| Tracker | one `TrackerData` per project | unchanged engine; a **part instance** is exposed as a `TrackerLike`, so the same engine/UI drives it |
| Project | `estimatedHours`, `workedSeconds` | **reused as is** (estimate stored as `minutes/60`, compared in whole minutes) |
| Timer | stop/start only, running segment lost on kill | rewritten: pause/resume, serialised commits, heartbeat + crash recovery, per-part breakdown |
| IndexedDB | v2 (`projects, patterns, docs, outbox, revisions`) | **v3 additive**: `collections`, `patternRevs` |
| D1 | `project_parts` existed but unused | migrations 0002 + 0003, **additive only** |
| Sync | CAS `revision` per entity, outbox, backups on conflict | new entity kinds follow the same rules; piece-by-piece merge for multi-part progress |
| Dialogs | `gz-sheet` + ad-hoc h2/buttons, `AlertController` with 4 styles | one `gz-sheet` (title/description/close/actions/busy) + one `confirm()` look |
| Android | Capacitor 8 `SystemBars` pads the WebView by the inset | native `ImmersiveMode` + `ImmersivePlugin` (WindowInsetsControllerCompat) |

## Data architecture

```
PatternCollection (reusable design, rev N)           ← pattern_collections + pattern_parts (replaced atomically with the parent)
 └ PatternPart  (name, quantity, text, assembly)
Project (created from collection rev N)              ← projects.collection_id (FK, ON DELETE SET NULL)
 ├ partSnapshots[]  frozen copy of every part        ┐
 └ parts[] PartInstance (Arm 1/2, Arm 2/2 …)         ├ project_progress.multi_state (JSON, one CAS row)
     each: own cursor + undo history + workedSeconds ┘
```

* **Why JSON for instances and not rows?** Every tap changes progress; one compare-and-swap row per project keeps conflict handling
  identical to the existing tracker, and a project is self-contained (offline, survives deleting the collection). `project_parts`
  stays unused.
* **Revisions**: when an edit changes instructions, the previous content is appended to `pattern_revisions` (immutable, idempotent by
  `(owner, kind, entity, rev)`, first write wins). Running projects do not read revisions: they hold their own snapshot
  (`multi_state.snapshots` for collections, `project_progress.pattern_snapshot` for standalone patterns, set at edit time).
* **Collection cover** is a ≤200 KB inline data URL in the row (no new R2 object kind ⇒ no destructive CHECK change).
* **Time**: sessions get `part_instance_id`; the project total remains the single sum, the per-part value is a breakdown
  (never added on top).

### Migrations (all additive — `CREATE TABLE` / `ALTER TABLE … ADD COLUMN`, no drop/rebuild/copy)

* `0002_collections_revisions_time.sql`: `pattern_collections`, `pattern_parts`, `pattern_revisions`; `patterns.content_rev`,
  `patterns.suggested_minutes`; `projects.collection_id`; `project_progress.multi_state`, `pattern_snapshot`;
  `work_sessions.part_instance_id`.
* `0003_pattern_source_text.sql`: `patterns.source_text`.
* Old clients: every new request field is optional and an omitted field never clears a stored value (tested).
* Applied to the **local** simulated D1 only.

## Backward-compatibility risks (and mitigations)

1. *Old app builds against the new Worker* — new fields optional, omitted ≠ cleared (API tests).
2. *New app against an old Worker* — `/v1/collections`, `/v1/revisions` would 404; the outbox retries then keeps a backup (no data loss). Deploy the Worker first.
3. *IndexedDB v2 → v3* — additive object stores only.
4. *Existing projects* — no `parts`/`patternPin`; `trackerView` falls back to the old path; progress/timers unchanged.
5. *Strict parser* — new tokens are a superset; existing round text yields identical acts (existing 126 tests unchanged).

## Editing & progress protection

`diffPatterns` (what changed) and `mapCursor` (can the position carry over: `safe` / `warn` / `unsafe`, valid undo steps kept) are pure.
`savePatternEdit` snapshots the old text as a revision, pins every project following the pattern, bumps `rev`. The project page offers
an explicit "Review the update"; `unsafe` mappings need "Update anyway", and the cursor is **never** reset. Collections:
`planCollectionUpdate` (added parts → fresh pieces; removed parts / lower quantity → untouched pieces dropped, worked pieces kept as *retired*).

## Smart parser (no AI)

normalize → classify lines → header (round / range / total) → tokenize → parse → validate → emit → re-parse with the strict parser.
Statuses: `validated`, `needs-review`, `unsupported`. Never invents stitches; wrong totals are flagged, not fixed; joins to other pieces keep
their reference and are never "validated"; `R4 >> R7 (24)` with no stitch type is an explicit flagged assumption. The ambiguous word
«حشو» (stuffing vs stitch) is understood as sc but always sent to review.

Arabic hardening (P5a, 2026-11-18 — details and probe results in `docs/khayoota-ai/p5a-parser-implementation-report.md`):

* **Magic ring** in Arabic (`في حلقة سحرية`, `في الحلقة السحرية`, `بالحلقة السحرية`, `الدائرة السحرية`, `ماجيك رينج`) and `في MR`;
  the ring may also be named first (`magic ring, 6 sc`, `حلقة سحرية، ٦ غرز قصيرة`) when nothing else in the line has a target.
* **Arabic stitch names** in singular, plural and «غرزة …» forms (`غرز قصيرة`, `أعمدة`, `أنصاف أعمدة`, `أعمدة طويلة`, `غرز حشو` …) and duals
  that name their stitch (`غرزتين قصيرتين`, `زيادتين`, `عمودين`). Descriptive Arabic names mean the same stitch in US and UK patterns;
  transliterations (`دبل`, `ترابل`) still follow the terminology system. Every «حشو» form stays `needs-review`.
* **Spaced ranges** (`R5 - 7:`, `الدور ٥ - ٧:`, `Rounds 5 – 7:`, `من الدور ٥ إلى ٧`, `الأدوار …`) — only when the header clearly ends after the
  second number, so `R5 - 12 sc` stays one round. Reversed or longer-than-100-round ranges are one `unsupported` round (`range-invalid`).
* **N stitches in each stitch**: `2 sc in each st` = an increase in every stitch of the previous round (stitch type kept: `2 hdc …` →
  `hdc-inc`); `2 sc in each of next 3 sts` = 3 increases; `في نفس الغرزة` = same stitch. No previous round → `unsupported`; a previous
  round that needs review → `needs-review` (`each-basis`) unless the line's written total confirms the result.
* **Set-up lines** (`Start: ch 43`, `Ch 1, turn`, `Turn`, `سلسلة ٤٣`, `اقلبي الشغل`) are kept as piece notes — never a piece heading, never
  a counted round. Chains, skips, slip stitches, loops and `*…*` repeats inside a round are still `unsupported`.

The strict parser (`pattern-parser.ts`, what the tracker and saved patterns use) was not changed.

## Sync conflict rules added

* progress of a multi-part project: on 409 the server returns its per-piece state; the stale device keeps a **backup**, merges piece by piece
  (newer edit wins per piece, ties → further along, time = max, one-sided pieces kept) and retries with the merged state.
* revisions are append-only; collections follow the pattern rules (pending local change wins and is pushed; server newer ⇒ backup).

## Android immersive display

`ImmersiveMode` hides only the navigation bar (`BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`), re-applies on window focus / configuration change (no
polling ⇒ no flashing), stays off while TalkBack (touch exploration) runs, user toggle in Settings (stored natively so it applies before the
WebView paints). `html.gz-immersive` keeps a 14 px floor under tabs/sheets (gesture area). Limitations: OEM skins may re-show the bar when the
keyboard opens; on API < 30 the compat layer uses the legacy flags; three-button mode relies on the swipe to reveal the buttons — hence the toggle.
