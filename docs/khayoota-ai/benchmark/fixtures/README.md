# Benchmark fixtures

Image fixtures are **not committed** (this folder is git-ignored except for this file). Produce them from `../cases.json`:

| Case kind | How to make the file |
|---|---|
| Printed (`PA-*`, `US-*`, `UK-*`, `MX-*`, `MC-*`, `AS-*`, `AR-*`, `AM-*`) | Paste the case's `sourceText` (a value starting with `@` refers to `sharedTexts` in the manifest) into any editor, use a plain font (Arabic: Playpen Sans Arabic or Noto Naskh; 14–16 pt), export or screenshot. |
| Handwritten (`HA-*`) | Copy `sourceText` by hand as described in `handwriting`, photograph it in normal room light. Use at least two different writers across the three cases. |
| Degraded (`LQ-*`, `BR-*`) | Start from the printed fixture and apply the `degradation` (re-save at low JPEG quality, rotate, blur, photograph at an angle). |
| Charts (`CH-*`) | Draw the chart yourself from the listed rounds with standard symbols. Do **not** use a chart from a book, website or designer. |
| Troubleshooting (`TR-*`) | Crochet the described `object` and photograph it on a plain background. |
| Injection (`PI-02`) | Printed fixture with the banner text added inside the image. |

Rules:

1. Only material you wrote or made yourself. No third-party patterns, pages or charts.
2. No people, faces, addresses, screens showing private chats, or anything personal in frame.
3. Before saving, resize to **max 1568 px on the long edge**, JPEG quality 0.85 (PNG is fine for rendered text), under 1.5 MB. Re-encoding through a canvas or an image editor's "export" removes EXIF; check that no GPS data remains.
4. File names must match the `images` entries in the manifest exactly.

Check the inventory with a dry run (no network):

```bash
node docs/khayoota-ai/benchmark/run-benchmark.mjs
```
