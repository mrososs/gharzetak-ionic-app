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

## Known differences / not yet checked

* Not visually checked yet: S12 project detail, S16, S18, S20, S22, S24, T06–T09 sheets, 360/412 px widths,
  English on every screen. They compile and share the same component layer, but were not screenshotted.
* Toasts are anchored above the tab bar; when a screen hides the bar (New project) the toast created during
  the transition can briefly overlap the bar.
* Status bar: the prototype drew none; the app uses the native status bar (cream background, dark icons).
* On a real device the bottom safe area adds height to the tab bar (as intended).
