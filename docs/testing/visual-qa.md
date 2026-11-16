# Visual QA

Method: the running app (Angular dev server, local Supabase) inspected in the built-in browser at phone
sizes, compared against the approved prototype's markup/CSS (`Main.dc.html`), which every artboard renders.
Pixel-diffing against the canvas artboards was **not** possible from this environment (the canvas is a
hosted artifact page); differences below are from side-by-side reading of the design source.

## Checked (2026-11-16)

| Screen | Size / dir | Result |
|---|---|---|
| S01 Welcome | 390×844 AR | Matches layout, type, dots, CTAs. Photo now a real Pexels image (design had a placeholder). Logo = DS mark until the supplied logo file is added. |
| S05 Log in | 390×844 AR | Matches (band, segment, inputs with icons, divider, social, guest, note). Note text changed from "prototype: no server" to an honest real-account note. |
| S06 Sign up → S07 Setup | 390×844 AR | Matches; real sign-up navigates to setup. |
| S08 Interests | 390×844 AR | Matches; real photos for 4/5 categories (accessories = tonal placeholder). |
| S09 Tools | 390×844 AR | Matches after a fix (tone colours were overridden — fixed in `components.scss`). |
| S10 Home (empty + with project) | 390×844 AR | Matches; tab bar with raised pink tracker button matches. |
| S11 Projects | 390×844 AR | Matches. |
| S13 New project | 390×844 AR | Matches; live parser feedback shown. |
| S15 Tracker pattern | 390×844 AR + EN | Matches (round pills, round card, ring, stat tiles, current step, count-by segment, big button). |
| S14 Tracker simple | **320×640** AR | Matches; no horizontal overflow (scrollWidth = 320). |
| T03 Round/pattern complete | 390×844 AR | Mint ring, success note, disabled finish state. |
| T05 Settings sheet | 390×844 EN | Auto-height sheet, 28 px radius. |
| S17 Pattern reader | 390×844 AR | Matches; explanation + in/out badges. |
| S19 Learn | 390×844 AR | Matches; Pexels thumbnails. |
| S21/T04 Assistant | 390×844 EN | Matches; every bot reply labelled "Demo reply". |
| S23 Converter | 390×844 EN | Matches. |
| S25 Settings | 390×844 EN | Matches; adds account + sync status line (new). |

## Second pass (2026-11-16)

| Screen | Size / dir | Result |
|---|---|---|
| S12 Project details | 390 AR, 412 EN | Matches (hero + change-cover, status chips, tracker card, pattern chips, materials, photos, notes) + delete button |
| S16 Pattern library | 390 AR | Matches. **Fixed:** Arabic note rendered "sc hdc dc tr inc dec" reversed — Latin runs now wrapped in LTR isolates (also the converter note) |
| S18 Add pattern | 390 AR | Matches |
| S20 Video detail | 390 AR | Matches (photo, info, YouTube CTA, note, link field, linked project, companion counter, timestamps, notes) |
| S22 Dictionary | 390 AR | Matches (US↔UK table, search, term cards) |
| S24 Store | 390 AR | Matches; Pexels hero + category photos (kits/accessories keep tonal placeholders) |
| T06 Reset sheet | 390 AR | Matches; measured — Cancel ends 26 px above the bottom (not clipped) |
| T07 Tools sheet | 390 AR | Matches |
| T08 Notifications sheet | 390 AR | Matches |
| T09 Erase-data sheet | 390 AR | Matches (opened, not confirmed) |
| Home | 412 EN | Matches |

**Automated overflow sweep:** 14 routes × {360, 412 px} × {Arabic, English} = 56 checks — no page scrolls
sideways and no element (outside intentional horizontal chip rows and sheets) extends past the viewport.
Together with the 320 px tracker check, every main route is covered at 320/360/390/412 px.

**Fixed:** toasts now wait two frames before anchoring, so a toast fired right after leaving a screen without
the tab bar (New project) sits above the re-shown bar instead of over it.

## Known differences / not yet checked

* Photos are 1200 px and show the design's tonal placeholder for a moment on first load (intended fallback);
  smaller variants would load faster on slow networks.
* Long Latin phrases inside Arabic sentences can still wrap mid-phrase (e.g. "(…) × N" across a line break).
* Status bar: the prototype drew none; the app uses the native status bar (cream background, dark icons).
* On a real device the bottom safe area adds height to the tab bar (as intended).
