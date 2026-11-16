# Asset manifest

Status key: **real** = in the app and original/licensed · **placeholder** = labelled tonal slot from the design ·
**missing** = not available, listed so it is not assumed.

## Brand

| Asset | Status | Notes |
|---|---|---|
| Logo (supplied by the product owner in chat, yarn ball + hook + heart + "غرزتك / Gharzetak") | **missing on disk** | Images pasted in chat cannot be saved by the build tooling. Save it as `public/assets/brand/logo.png` (square, transparent, ≥ 1024 px). `gz-brand-mark` uses it automatically; until then the Design System's original SVG mark is shown. Also needed for Android launcher icons / splash (`npx @capacitor/assets generate`). |
| DS mark (purple tile, pink yarn ball, peach hook, mint thread) | real | `public/assets/brand/mark.svg`, inline in `gz-brand-mark`. Used as favicon. |
| Fonts | real | Playpen Sans Arabic + Playpen Sans (OFL), self-hosted via `@fontsource-variable/*` (works offline). |
| Icons | real | 56 + 1 original stroke icons (design-tokens.json). |

## Photos (Pexels — free to use, https://www.pexels.com/license/)

Downloaded from `images.pexels.com` at 1200 px wide and visually checked before use.
Credit is not required by the licence but is recorded here.

| File | Pexels page | Photographer (per Pexels listing) | Used for |
|---|---|---|---|
| `pexels-17357483.jpg` | https://www.pexels.com/photo/stuffed-bunny-against-a-pink-background-17357483/ | Ngoc Tram Nguyen | ob0 (welcome), video "assembling amigurumi" |
| `pexels-3945638.jpg` | https://www.pexels.com/photo/person-holding-purple-crochet-hook-and-white-yarn-3945638/ | Castorly Stock | ob1, video "single crochet" |
| `pexels-5806980.jpg` | https://www.pexels.com/photo/blanket-with-pattern-on-gray-sofa-5806980/ | Ksenia Chernaya | ob2, video "granny square" |
| `pexels-2731820.jpg` | https://www.pexels.com/photo/rabbit-amigurumi-doll-2731820/ | Kristina Paukshtite | ob3, video "inc/dec" |
| `pexels-7738663.jpg` | https://www.pexels.com/photo/purple-teddy-bear-stuffed-toy-near-babys-breath-flowers-7738663/ | see Pexels page | Amigurumi category, video "invisible decrease" |
| `pexels-1374128.jpg` | https://www.pexels.com/photo/woman-wearing-beige-crochet-sweater-and-round-white-analog-watch-closeup-photo-1374128/ | lil artsy | Clothes category, video "sweater" — **looks knitted; replace with a crocheted garment when available** |
| `pexels-29242682.jpg` | https://www.pexels.com/photo/handmade-crochet-baskets-with-positive-messages-29242682/ | Joanna Areal | Home-decor category, video "basket" |
| `pexels-19558765.jpg` | https://www.pexels.com/photo/handmade-wool-flowers-in-vase-19558765/ | Muhammad Haris | Gifts category |
| `pexels-4792084.jpg` | https://www.pexels.com/photo/crochet-needles-and-threads-on-windowsill-4792084/ | see Pexels page | Store hero, store "hooks" |
| `pexels-2767653.jpg` | https://www.pexels.com/photo/purple-yarns-2767653/ | see Pexels page | Store "yarn" (shows knitting needles) |
| `pexels-8826936.jpg` | https://www.pexels.com/photo/crochet-napkin-on-wood-8826936/ | see Pexels page | Store "patterns", video "read a pattern" |
| `pexels-7585792.jpg` | https://www.pexels.com/photo/crop-craftswoman-with-hook-and-crocheted-textile-at-home-7585792/ | see Pexels page | Video "magic ring" |
| `pexels-4792059.jpg` | https://www.pexels.com/photo/pink-yarn-for-knitting-on-sofa-4792059/ | see Pexels page | Video "working in the round" |

Rejected after visual check: `4550653` (felt, not crochet).

## Still placeholders (design's labelled tonal slots)

`cat_accessories` (crochet bag), the six yarn-type tiles, store "kits" and "accessories".
Projects without a cover show their category photo; users replace it with their own upload.

## User content

Project covers and progress photos: resized in the browser (≤ 1280 px JPEG), kept in IndexedDB for offline use,
uploaded to the private `project-photos` bucket under `<uid>/<projectId>/…` when signed in.
Pattern PDFs/images: private `pattern-files` bucket, reference only (no text extraction).
