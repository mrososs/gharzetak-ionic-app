# Design tokens

Exact values from the approved Design System (`source/design-tokens.json`, `source/theme-variables.scss`).
No token was invented; the "provisional" palette in the brief was **not** needed because the approved
tokens were recovered from the artifact.

| Layer | File | Purpose |
|---|---|---|
| CSS custom properties | `src/theme/tokens.css` | `--gz-*` brand, ramps, surfaces, text, semantic, shadows, type scale, radius, spacing, layout, motion, safe-area |
| Ionic theme | `src/theme/variables.scss` | `--ion-color-*` (primary purple, secondary pink with **dark** contrast text, …), font, backgrounds, tab bar |
| Typography | `src/theme/typography.scss` | `gz-h1/h2/h3/title/body/sm/xs`, `gz-num` (tabular, heavy, LTR), `gz-code` (LTR stitch code) |
| Components | `src/theme/components.scss` | `gz-card`, `gz-btn/btn2/btn3`, `gz-bigbtn`, `gz-chip`, `gz-badge`, `gz-pill`, `gz-seg`, `gz-in`, `gz-ta`, `gz-note`, `gz-ph`, `gz-bar`, `gz-dots`, `gz-msg`, tones `t-lav/blush/sage/peach/cream/plum` — ported 1:1 from the prototype CSS |
| Ionic overrides | `src/theme/ionic-overrides.scss` | Only CSS variables + shadow parts (`::part(native)`), no `::ng-deep` |
| Tailwind v4 | `src/theme/tailwind.css` | `@theme inline` maps tokens → `bg-primary`, `text-ink`, `rounded-md`, `shadow-card`, … Preflight sits in `@layer base`, so Ionic's un-layered CSS always wins |

## Key values

| Token | Value |
|---|---|
| Primary Purple | `#813DB5` (hover `#6F3199`, pressed `#5D2884`, tint `#F3E8FB`) |
| Joyful Pink | `#F56FA8` — carries dark text only (white on pink = 2.7:1) |
| Soft Lavender | `#C5A4F4` (100 `#F1E8FD`, 200 `#E2D0FA`) |
| Peach | `#FFCCAA` (100 `#FFEADB`, ink `#8A3F12`) |
| Mint | `#A6DCC9` (100 `#DDF3EA`, 200 `#C6EBDD`, ink `#17594A`) |
| Cream background | `#FFF9F5` · surface `#FFFFFF` · blush surface `#FFF1F7` |
| Text | `#35253E` / `#5B4866` / `#73608A` |
| Type | Playpen Sans Arabic (variable 100–800, self-hosted via `@fontsource-variable`) + Playpen Sans for Latin; 12/13/14/15/16/18/20/24 px; numerals 28/36/68 px weight 800 |
| Line height | Arabic 1.7, English 1.55, headings 1.45; never letter-spacing on Arabic |
| Radius | 12 / 16 / 20 / 28 / pill |
| Spacing | 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48; screen padding 20 |
| Shadows | card `0 6px 22px rgba(53,37,62,.10)`, raised `0 8px 18px rgba(129,61,181,.30)`, sheet `0 -6px 20px rgba(53,37,62,.08)` |
| Touch target | 44 px minimum; tab bar 78 px + safe area |
| Motion | fade 300 ms, sheet 280 ms, pop 600 ms, glow 1400 ms; all disabled under `prefers-reduced-motion` |

Icons: the design's 56 original single-path 24 px stroke icons (`core/data/icons.ts`, + one `cloud` icon
for the sync status) rendered by `<svg gzIcon="…">`. Direction-aware icons use `[flip]` in RTL.
