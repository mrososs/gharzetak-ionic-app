# Design source audit (Phase 0)

Date: 2026-11-16.

## What was inspected (actually read, not summarised)

Artifact `https://claude.ai/artifact/E48aywBvYgDag8cLCFN6DZ` (Claude Design canvas *غرزتك — Gharzetak*,
85 files). Read through the Artifact tool:

| File | Content |
|---|---|
| `project/canvas.json` | Pages: Prototype, Design System, All Screens, User Flows, Developer Handoff; 44 artboards |
| `project/Main.dc.html` (2,506 lines) | The interactive prototype — **all** markup, the full CSS component layer, the i18n tables (AR/EN), reference data, the deterministic pattern parser, US↔UK converter, simple & pattern-aware tracker logic, AI demo rules, view-models for every screen. This was the primary implementation source. |
| `project/handoff/design-tokens.json` | Exact colours, ramps, tones + contrast, type scale, weights, line heights, spacing, radii, shadows, sizes, motion, 56 icon paths |
| `project/handoff/screen-manifest.json` | 25 screens + 9 states, proposed routes, components, behaviour, frame heights |
| `project/handoff/navigation-flow.json` | Verified navigation edges |
| `project/handoff/asset-manifest.json` | Photo slots (all placeholders), brand assets, missing assets |
| `project/handoff/brand-guidelines.md`, `typography.css` | Brand, contrast rules, type rules |
| `project/Screen_S01.dc.html`, `Screen_T01.dc.html` | Artboard wrappers (render `Main` with a preview key) |
| Local `D:\Study\Crochet\gharzetak-handoff\` | Same handoff files + `theme-variables.scss` (identical tokens, verified by diff) |

Not separately read: `DS_*`, `HO_*`, `Flows*`, `Gallery` artboards (documentation views of the same
tokens/screens) — the underlying data files above were used instead. Visual comparison screenshots of the
artboards could not be rendered from this environment (the canvas is an artifact page, not a local file);
comparison was done against the prototype's own markup/CSS, which the artboards render.

## Findings

* Approved tokens exist, so the brief's provisional palette was not used.
* Every photo in the design is a labelled placeholder (`asset-manifest.json` status *placeholder*);
  the product owner asked to use free Pexels photos → done, see `asset-manifest.md`.
* The product owner supplied a new logo in chat after the design was made; it is not on disk yet.
* Prototype behaviours that were demo-only and are now real: authentication, cloud persistence, store
  interest. Still demo/not connected (and labelled as such): AI replies, image analysis, PDF/image text
  extraction, YouTube analysis, notifications.
* Two reference images in `D:\Study\Crochet\*.png` are earlier mood-board mockups ("Crochet Buddy"),
  not the approved design; they were not used as a source.
