# Khayoota AI — Agentic UI Design

> Design only; nothing was implemented. Protocol facts were gathered on 2026-11-18 from the projects' own documentation, repositories and npm metadata (links in §7). Items that could not be confirmed from a primary source are marked **[Unverified]**.

---

## 1. What "agentic UI" has to mean here

Khayoota may **propose** a small, fixed set of things the app already knows how to do — open the current round, open a piece, explain a stitch, prepare a draft, show a count check. The user taps; the app's existing code does it. Khayoota never saves, edits, deletes or changes progress.

Constraints that shape the choice:

- Angular **22.2**, Ionic **9**, Capacitor 8, standalone components + signals, running in an Android WebView [Verified `package.json`].
- A hand-built design system (`gz-*` components, Playpen Sans Arabic, RTL-first). Generic generated layouts would look foreign.
- One agent, one conversation, about ten actions. No multi-agent orchestration, no shared long-lived agent state, no long-running jobs.
- The model's output is untrusted. Nothing it emits may become code, markup, a route or a query.

---

## 2. The three options

### Option A — Typed actions + existing components

The server returns a reply envelope containing up to two `ActionProposal` objects from a server-owned allowlist. The client validates each, renders it with an existing component (a button row, a `.gz-card`, a `gz-sheet`), and runs a hand-written executor on tap.

- New dependencies: **none**.
- UI: 100 % the app's own components, RTL and theming for free.
- Security: the attack surface is the allowlist and its validators — small enough to test exhaustively.
- Cost: adding an action is a code change (schema + executor + card). For ~10 actions that is a feature, not a burden.

### Option B — A2UI (Google's declarative generative-UI payload)

What it is: the agent streams JSON messages (`createSurface`, `updateComponents`, `updateDataModel`, …) describing a UI tree bound to a data model; a client renderer maps component names to a **catalogue** the client owns. Declarative data, not code; functions carry `allowedCallers` / `requiresUserActivation`.

| Question | Finding |
|---|---|
| Version / stability | Spec **1.0** announced as the first stable version on **2026-11-11** — one week before this document. 1.1 is already collecting requirements. 0.9.1 → 1.0 was breaking (`@`-prefixed keys, renamed function call, `theme` removed, 0.9 catalogues unusable directly). |
| Angular renderer | Official `@a2ui/angular` **0.14.0** (2026-11-02). Peer dependency `@angular/core ^21.2.5` — a caret range that **does not include Angular 22**, which this app uses. Whether it works on 22 is **[Unverified]**; it would at minimum need a peer-dependency override. |
| Maturity of the renderer | 23 versions in 11 months; breaking changes in 0.10, 0.11, 0.12 and 0.14. v1.0 surfaces currently render through a selector still named `<a2ui-v09-surface>`; there is no `./v1_0` export. |
| Signals / standalone | Yes — uses Angular signals and standalone components. |
| Custom design-system components | Supported (`createComponentImplementation`, `AngularCatalog`, `provideA2UI({ catalogs })`). A catalogue made **only** of app components, without the bundled BasicCatalog, is **[Unverified]** — every documented example includes the basic one. |
| Ionic | No Ionic renderer or example found **[Unverified that none exists]**. Catalogue entries can be custom elements, so `ion-*` could plausibly be wrapped. |
| Streaming | JSONL / SSE / WebSocket; transport-agnostic. The model would have to emit valid A2UI JSON — more output tokens and a harder structured-output task than a 3-field action. |
| Bundle | Adds `@a2ui/angular` + `@a2ui/web_core` (which pulls in `lit` and `@preact/signals-core`) + `zod ^3`. No official min+gzip figure **[Unverified]**; unpacked npm sizes are 1.3 MB and 8.6 MB. A second reactive runtime (Lit/Preact signals) inside an Angular WebView app is a real cost. |
| Security | Good model (client-owned catalogue). But the catalogue is a *composition grammar*: the agent decides layout and which widgets appear, which is a larger space to reason about and test than "one of ten actions". |

What it would buy: agent-composed layouts (forms, lists, cards assembled on the fly). Khayoota does not need that — every surface it shows is one we design once.

### Option C — AG-UI (agent ↔ app event transport)

What it is: **not** a UI format. A protocol of events over HTTP/SSE between an agent backend and a front end: run lifecycle, streamed text, tool-call start/args/end/result, state snapshots and JSON-Patch deltas, custom events. It can *carry* A2UI payloads; the two are complementary, not alternatives.

| Question | Finding |
|---|---|
| Version | "AG-UI 1.0"; `@ag-ui/client` / `@ag-ui/core` **1.0.5** (MIT). |
| Angular | **No Angular SDK.** `@ag-ui/client` is framework-neutral (RxJS). The Angular option is `@copilotkit/angular` **0.6.0** — peer Angular `^22` (compatible), maintained by a third party that says to "expect occasional breaking changes", 5.5 MB unpacked, bundling katex, marked, highlight.js, dompurify and an A2UI core. |
| Cloudflare Workers | `@ag-ui/cloudflare-agents` **0.1.0**, published **2026-11-17** (one day old), community integration; needs the `ai` package as a peer. Compatibility with a plain Hono route is an inference, not documented **[Unverified]**. |
| Value for streaming | Standard events for token streaming and tool lifecycle. Our first release does not stream (`multimodal-architecture.md` §7). |
| Value for state sync | Meaningful when agent and UI share evolving state. Here the app owns all state; the model sees a read-only snapshot per request. |
| Value for long-running / multi-step | None today: one request, one reply, no server-side tool loop. |

### Also considered — Vercel AI SDK UI message stream

`@ai-sdk/angular` 3.0.x (peer `@angular/core >= 16`, signal-backed `Chat`, typed `tool-*` parts over SSE). It is the lightest *off-the-shelf* way to stream text plus tool parts to Angular. It would become relevant **if** streaming is added later; even then a 40-line SSE reader may be enough.

---

## 3. Decision

**Option A: typed actions rendered by existing components.** No protocol dependency in the first release.

| Requirement | A typed actions | B A2UI | C AG-UI |
|---|---|---|---|
| ~10 fixed, safe actions | exact fit | over-general | orthogonal |
| App's own look, RTL | native | needs a full custom catalogue | n/a |
| Angular 22 today | yes | peer range excludes 22 | only via CopilotKit 0.6 |
| New runtime dependencies | none | lit, preact-signals, zod 3 | rxjs client + adapter, or CopilotKit bundle |
| Stability | ours | spec 1.0 one week old; renderer breaking ~monthly | SDK 1.0.x; Workers adapter one day old |
| Testability of the safety boundary | enumerate everything | grammar-level | n/a |

Keeping the door open, at no cost now:

- The reply envelope is **transport-neutral JSON** with explicit versions. If streaming is added, the same objects can ride an SSE stream (AG-UI-shaped or AI-SDK-shaped) without changing executors.
- Revisit A2UI only if a real need for *agent-composed* surfaces appears **and** `@a2ui/angular` supports the app's Angular major on a stable line. Revisit AG-UI only if Khayoota grows a server-side multi-step agent.

---

## 4. Secure action contract

### 4.1 Envelope

```ts
interface ActionProposal {
  id: ActionId;            // from the allowlist below
  v: 1;                    // per-action schema version
  label?: never;           // the model does NOT write button text; labels come from strings.ts
  payload: unknown;        // validated against the action's schema
}
```

Rules that apply to every action:

1. **Server-owned schemas.** One Zod schema per action on the Worker. Model output is validated; unknown ids, extra fields and malformed payloads are **dropped** (the text reply still goes out).
2. **Ids must come from context.** For any payload id (`projectId`, `partInstanceId`, `patternId`), the server checks it appears in the `context` the client sent with this request; otherwise the action is dropped. The model cannot introduce an id.
3. **Client re-validation.** The client checks the shape again (small hand-written guards — the app has no schema library and ten actions do not justify adding one) and resolves every id in the **local store for the current scope**. Missing → the button is not rendered.
4. **Nothing runs without a tap.** Proposals render as buttons. No auto-navigation, no auto-open.
5. **No model-authored UI text in controls.** Button labels and card titles are app strings; only the chat bubble contains model text, rendered as plain text (Angular interpolation — no `innerHTML`, no Markdown-to-HTML).
6. **At most two actions per reply.**
7. **Idempotent and re-checkable.** An action can be tapped later from chat history; the executor re-validates at tap time (the project may have been deleted, the revision may have moved on).
8. **Audit.** The device records `{ actionId, v, outcome }` per tap in the local chat message (for support and QA). The server counts proposals per action id in the usage ledger — **no payloads, no content**.

### 4.2 Allowlist v1

Classes: **N** navigation · **C** card (display only) · **D** draft (prepares unsaved UI) · **M** mutation.

| Action id | Class | Payload | Executor (existing code) | Confirmation | Failure state |
|---|---|---|---|---|---|
| `tracker.openCurrentRound` | N | `{ projectId, partInstanceId? }` | `TrackerNavigator.open(projectId, instanceId)` | tap | `'missing'` → toast "project not found"; `'done'` → offer to open details |
| `project.openPart` | N | `{ projectId, partInstanceId }` | `TrackerNavigator.open(...)` — this already switches the active piece and the timer, exactly as tapping the piece in the app does | tap; button names the piece | as above |
| `project.open` | N | `{ projectId }` | navigate `/tabs/projects/:id` | tap | not found → button hidden |
| `pattern.openReader` | N | `{ patternId }` | navigate `/tabs/home/patterns/:id` | tap | not found → hidden |
| `learn.explainStitch` | C + N | `{ stitch: 'ch'|'sl'|'sc'|'hdc'|'dc'|'tr'|'dtr'|'inc'|'dec'|'mr'|'flo'|'blo'|'sk', topic?: VideoTopicId }` | inline stitch card from `TERMS` (`catalog.ts`); optional "Watch" → `/tabs/learn/:id` **only if `topic` is one of `VIDEOS`' ids** (the page silently falls back to the first topic on an unknown id) | card shown; "Watch" on tap | unknown stitch → no card |
| `card.stitchCountCheck` | C | `{ roundN }` | discrepancy card whose numbers are **recomputed on the device** from the pinned text (`parsePattern`): written `[N]`, calculated total, consumed vs. previous round | none (display) | round not in context → no card |
| `card.patternPreview` | C | `{ draftRef }` | preview card for an extraction result held in memory (title, parts, rounds, counts by status) | none | draft expired → "extract again" |
| `pattern.createDraft` | D | `{ draftRef, target: 'pattern' | 'collection' }` | seed Smart Import review → `ImportDraftService.offer` → Add Pattern / Collection editor, **dirty and unsaved** | tap "Prepare in Gharzetak", then the editor's own Save | converter finds nothing → stays on review with the message |
| `pattern.proposeCorrection` | D | `{ target: { kind: 'pattern', patternId } | { kind: 'collection', collectionId, partId }, roundN, proposedLine, reason }` | opens the existing edit screen with a proposal card (old line / new line / deterministic check of the new line); the user applies it into the form and saves through `savePatternEdit` / `saveCollectionEdit` — which creates a revision and pins following projects | tap, then "Apply to editor", then Save (+ the editor's existing structural-change confirmation) | `proposedLine` not parseable by the strict parser → shown as text suggestion only, "Apply" disabled |
| `project.reviewPatternUpdate` | N | `{ projectId }` | open Project Details at the existing "Review the update" sheet (only when `trackerView(p).outdated`) | tap, then the sheet's own explicit confirm | not outdated → hidden |

**There is no class-M action in v1.** Every change to stored data happens on an existing screen behind that screen's own Save / Confirm, with its existing validation (revision creation, pinning, `mapCursor`, unsaved-changes guard). If a mutation action is ever added (for example "mark piece finished"), it must: be explicitly approved as a product decision; show a confirmation naming exactly what changes; call the existing store method with a `JoyOrigin`-style origin; be undoable where the screen is; and never be available for delete.

### 4.3 Read access

"Read actions" in the brief = *what context the model may see*. In this design that is the client-built `KhayootaContextV1` (`multimodal-architecture.md` §5): the model has **no tools to fetch more**. It cannot query D1, list projects, or read a pattern it was not given. That is the strongest possible form of "authorization before each context retrieval": there is no retrieval to authorise.

### 4.4 Never

- No SQL, no D1 access, no R2 keys, no URLs from the model.
- No AI-generated HTML, JavaScript, CSS, Angular templates, route strings or deep links.
- No delete action, no counter/progress action, no profile or auth action.
- No action targeting an id outside the current request's context.
- Text extracted from images or pasted patterns is **material**, never instructions (`security-privacy-cost.md` §2).

---

## 5. Lifecycle of a proposal

```
model output ─► server: Zod per action ─► ids ⊆ request context? ─► trimmed to ≤ 2
            ─► client: shape guard ─► ids resolve in local store? ─► render button/card
user taps   ─► executor re-validates now ─► state: idle → running → done | failed | stale
            ─► local audit entry { actionId, v, outcome }
```

| State | UI |
|---|---|
| `idle` | button (`gz-btn2`) or card |
| `running` | `is-busy` button; navigation actions resolve immediately |
| `done` | for navigation: nothing (the screen changed). For drafts: the editor is open. |
| `failed` | toast via `UiFeedback` + the button stays for a retry |
| `stale` | "This is no longer available" inline note (project deleted, revision moved, draft expired) |
| cancelled | any draft/editor step can be left; the unsaved-changes guard on the editors already asks before discarding |

Stale pattern revisions: `pattern.proposeCorrection` carries the `rev` it was computed against (from context). If the pattern's `rev` differs at tap time, the proposal is shown as stale and not applied.

---

## 6. Rendering map (existing components only)

| Reply part | Rendered with |
|---|---|
| Text | `.gz-msg.a` bubble (already exists) |
| Observations / hypotheses / cannot-confirm (photo turns) | three labelled blocks inside one `.gz-card` using `.gz-note.sage` / `.gz-note.lav` / `.gz-note` — design in `product-ux-and-branding.md` |
| Citations | small `gz-chip` "R7 · الايد" that opens the reader/tracker at that round |
| Action buttons | `gz-btn2` / `gz-btn3` row under the bubble |
| Stitch card | `.gz-card` with the `TERMS` entry (US/UK names, Arabic/English text, example) |
| Count-check card | `.gz-card` + `.gz-note.err` when written ≠ calculated |
| Pattern preview | `.gz-card` with status badges (`gz-badge sage` / `peach` / `rose`) → opens the review screen |
| Confirmation | `gz-sheet` or `UiFeedback.confirm` (existing) |

---

## 7. Sources

A2UI: [specification v1.0](https://a2ui.org/specification/v1.0-a2ui/) · [roadmap](https://a2ui.org/roadmap/) · [Google announcement](https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/) · [`@a2ui/angular` on npm](https://registry.npmjs.org/@a2ui/angular) · [renderer changelog](https://raw.githubusercontent.com/a2ui-project/a2ui/main/typescript/renderers/angular/CHANGELOG.md) · [defining a catalogue](https://a2ui.org/guides/defining-a-catalog/) · [client integration](https://a2ui.org/guides/client-integration/) · [0.9.1 → 1.0 evolution guide](https://a2ui.org/specification/v1.0-evolution-guide/)

AG-UI: [repository](https://github.com/ag-ui-protocol/ag-ui) · [events](https://docs.ag-ui.com/concepts/events) · [architecture](https://docs.ag-ui.com/concepts/architecture) · [generative-UI specs relation](https://docs.ag-ui.com/concepts/generative-ui-specs) · [`@ag-ui/client`](https://registry.npmjs.org/@ag-ui/client/latest) · [`@ag-ui/cloudflare-agents`](https://registry.npmjs.org/@ag-ui/cloudflare-agents) · [`@copilotkit/angular`](https://registry.npmjs.org/@copilotkit/angular/latest)

AI SDK: [`@ai-sdk/angular`](https://registry.npmjs.org/@ai-sdk/angular/latest) · [stream protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)
