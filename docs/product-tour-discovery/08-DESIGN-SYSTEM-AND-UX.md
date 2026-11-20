# 08 — Tour Design System and UX

The tour must look like Gharzetak, not like a library. All values below are existing tokens from `src/theme/tokens.css`; no new colours or fonts are introduced.

Concept previews (real app screens with the real engine and this theme injected in the browser; **not shipped UI**) are in `concepts/`:

| File | Shows |
|---|---|
| `00-unstyled-library-default-ar.jpg` | The engine's default popover over the app, for contrast |
| `01-welcome-tour-home-ar.png`, `01b-…-last-step-ar.png` | Welcome tour, first and last step, Arabic |
| `02-tracker-interactive-step-ar.png`, `02b-tracker-undo-step-ar.png` | Tracker action step and the Undo step that follows a real tap |
| `03-patterns-tour-ar.png` | Patterns tour, step 1 |
| `04-getting-started-checklist-ar.png` | Getting Started card on Home (mock-up injected into the page) |
| `05-popover-arabic-tab-bar.png` | Arabic popover on the tab bar |
| `06-popover-english-tab-bar.png`, `06b-welcome-tour-home-en.png` | English popover and step |
| `ref-tracker-real-screen.png` | The untouched tracker, for reference |

Preview limits: 335×725 px captures from a desktop browser pane; fonts and layout are the app's own, but spacing has not been judged on a phone.

## 1. Tokens used

| Role | Token | Value |
|---|---|---|
| Popover surface | `--gz-surface` | `#ffffff` |
| Popover border | `--gz-border` | `#ebddea` |
| Title text | `--gz-text` | `#35253e` |
| Body text | `--gz-text-2` | `#5b4866` |
| Muted (Skip, close) | `--gz-text-3` | `#73608a` |
| Primary button | `--gz-primary` / pressed `--gz-primary-pressed` | `#813db5` / `#5d2884` |
| Secondary button | `--gz-lavender-100` with `--gz-primary` text | `#f1e8fd` |
| Progress dots | `--gz-lavender-200`, past `--gz-lavender`, current `--gz-primary` | |
| Instruction strip | `--gz-pink-100` background, `--gz-pink-ink` text | `#ffe3ef` / `#a81f5e` |
| Dimmer | `--gz-text` at 58% | plum, not black |
| Getting Started card | `--gz-surface-elevated`, border `--gz-pink-200` | `#fff1f7` / `#fdc2db` |
| Done tick | `--gz-success-bg` / `--gz-success` | `#ddf3ea` / `#17594a` |
| Font | `--gz-font` (Arabic), `--gz-font-latin` (English) | Playpen Sans Arabic / Playpen Sans |
| Radius | popover 24 px; buttons `--gz-r-sm` 16 px; stage 20 px | |
| Shadow | `0 16px 36px rgba(53,37,62,.24)` + 1 px border | softer than `--gz-shadow-big`, same hue |
| Touch target | `--gz-touch` | 44 px |

Contrast, computed from the token values (WCAG relative luminance):

| Pair | Ratio |
|---|---|
| Title `#35253e` on white | 14.1 : 1 |
| Body `#5b4866` on white | 8.2 : 1 |
| Muted `#73608a` on white | 5.6 : 1 |
| White on primary `#813db5` | 6.4 : 1 |
| Primary on lavender-100 (Back button) | 5.4 : 1 |
| Pink-ink on pink-100 (instruction strip) | 5.8 : 1 |
| Text on lavender-100 (pill) | 11.9 : 1 |
| Success on success-bg (tick) | 7.1 : 1 |
| Disabled fg on disabled bg | 3.1 : 1 (disabled controls are exempt, and v1 has none) |

All active text pairs pass 4.5 : 1.

## 2. Popover anatomy

```
        ┌────────────────────────────────────────────┐
        │  Title (700, 17px)                      ×  │   × : 44×44, inline-end, top
        │  Body (400, 14.5px, text-2)                │
        │  ┌──────────────────────────────────────┐  │
        │  │ ● Try it: tap the button once        │  │   instruction strip (action steps only)
        │  └──────────────────────────────────────┘  │
        │  ▬ • • • • •          Skip   [Back] [Next] │   dots inline-start · buttons inline-end
        └───────────────────▽────────────────────────┘
                         target
```

| Part | Spec |
|---|---|
| Width | `min(310px, 100vw − 32px)`; never edge to edge |
| Max height | `min(60dvh, 100dvh − 32px)`; body scrolls inside if text is enlarged |
| Padding | 18 px top and sides, 14 px bottom |
| Title | 17 px / 700; line-height 1.5 Arabic, 1.3 English; `padding-inline-end: 34px` to clear × |
| Body | 14.5 px / 400; line-height 1.7 Arabic, 1.55 English (the app's `--gz-lh-ar` / `--gz-lh-en`) |
| Close × | 44×44, `inset-inline-end: 4px; top: 4px`; replaces the library's physical `right: 0` |
| Progress | Dots, not "3 / 6" text: 7 px dots, current is a 20 px pill, same language as the onboarding slides (`onboarding.page.ts:152-154`). The spoken equivalent is in the dialog's label. |
| Buttons | Height 44 px, padding 0 16 px, radius 16 px, 14.5 px / 700 |
| Next / Done | Filled primary, soft purple shadow |
| Back | Lavender fill, primary text. Hidden on the first step. |
| Skip | Text only, muted. Hidden on the last step. Placed before Back so it is never under the thumb by accident. |
| Disabled Next (if an engine-forced action step is ever used) | `--gz-disabled-bg` / `--gz-disabled-fg`, no shadow. The concept image `02` shows it still purple; that is a known gap in the preview CSS. |
| Arrow | 8 px, same white as the surface |
| Offset from target | 10 px |

## 3. Overlay and stage

| Item | Spec |
|---|---|
| Dimmer | `#35253e` at 0.58. Plum keeps the pink and lavender of the app recognisable underneath; black at 0.7 (library default) turns the screen grey. |
| Cut-out | Padding 6 px, radius 20 px (matches `--gz-r-md` cards). Tracker tab button: radius 24 px. |
| Tap on dimmer | Ignored |
| Highlighted element | Fully visible, not tinted. No extra glow ring: the cut-out is enough. |
| Blocking | Everything outside the popover is inert. On an action step the highlighted control is live. |

## 4. Motion

| Item | Spec |
|---|---|
| Step change | Cut-out glides to the next target in 250 ms (`duration: 250`); popover fades in 150 ms |
| Reduced motion | `animate: false` when `prefers-reduced-motion: reduce` **or** the user's Crochet Joy setting "reduce motion" is on (`core/joy/joy.models.ts:13`). The library does not do this by itself. |
| No bounce, no pulse, no confetti | The app already celebrates real achievements; a tour is not one |
| Instruction strip | A small static dot. The library's pulsing dot is switched off under reduced motion by its own CSS; keep it that way. |

## 5. RTL and LTR

Verified in the probe with `html[dir]` switched live from Settings (`concepts/05`, `06`).

| Aspect | Behaviour | Source |
|---|---|---|
| Text alignment, dot order, button order | Follow `direction` automatically (flex) | Probe |
| Close × | Needs `inset-inline-end`; the library uses physical `right` | Probe + theme |
| Popover side | Only `top` / `bottom` are used | Design rule |
| Alignment `start` / `end` | The library computes these physically; the renderer swaps them when `dir` is `rtl` | Source |
| Arrow | Positioned from rectangles; correct in both directions | Probe |
| Arrow keys | Library: Right = next in both directions. Renderer remaps in RTL (Left = next), or disables arrow keys. | Source |
| Fonts | `html[dir=ltr] .gz-tour` switches to `--gz-font-latin` | Theme |
| Numbers and notation | Isolated left-to-right (`.gz-ltr`) | `05` §15 |

## 6. Component specs

### 6.1 Welcome tour

- 6 steps, dots show 6.
- Step 1 points at a Home tile (popover above); steps 2–5 sit just above the tab bar; step 6 is at the top of the page (popover below).
- Steps 2–5 keep the popover in almost the same place, so the eye only follows the cut-out moving along the tab bar.
- Ends with a toast in the app's existing toast style, anchored above the tab bar.

### 6.2 Contextual tooltip (feature tours)

Same popover. Differences: 2–5 dots; no end toast; title carries the screen's own vocabulary.

### 6.3 Interactive action step

- Adds the instruction strip under the body: pink-100 background, radius 12 px, 13.5 px / 600, pink-ink text, a 6 px dot at inline-start.
- The highlighted control is live and keeps its own pressed state.
- Next remains enabled (`04` §4).
- After the tap the tour moves on without a "well done" step; the changed counter is the feedback.
- Do not set the library's `popover.instruction` or `advanceOn`: on the phone they made Next inert (Phase 0, F3). The adapter renders the strip and listens for the tap itself.

### 6.4 Getting Started card

| Item | Spec |
|---|---|
| Position | Home, between the hero card and "My tools", in normal flow |
| Container | `gz-card`, background `--gz-surface-elevated`, 1.5 px `--gz-pink-200` border, no shadow, radius 20 px |
| Header | 44 px tile (`t-blush`) with a star icon, title 16 px / 700, progress line 12 px muted, "Hide" link at inline-end |
| Progress bar | Existing `gz-bar thin` |
| Rows | Min height 46 px; 24 px circle (empty: 2 px `--gz-border-strong`; done: `--gz-success-bg` with a tick), label 14.5 px / 600, chevron at inline-end on open rows |
| Done rows | Muted and struck through; not tappable |
| State A (offer) | Same card, body text and two buttons: `gz-btn` "Start the tour" and `gz-btn-text` "Not now"; no rows |
| State C (complete) | Single line with 🧶 and a sub-line pointing to Settings |
| Collapsing | Not collapsible; it is either shown or hidden, to avoid a third state to explain |

### 6.5 Offer pill

| Item | Spec |
|---|---|
| Position | First element inside the page's scroll content, below the header; pushes content down by its own height |
| Size | Full content width, min height 48 px, radius 16 px |
| Style | `--gz-lavender-100` background, `--gz-text` text 13.5 px / 600, a small sparkle icon at inline-start |
| Actions | "Start" as `gz-btn3`-style small button (44 px tall) at inline-end, then a 44 px × |
| Motion | Height and opacity in, 200 ms; none under reduced motion |
| Never | Floating, overlapping content, or stacked with another pill |

### 6.6 Completion state

- Welcome: toast only.
- Feature tours: nothing.
- Getting Started: state C for the rest of the session.

### 6.7 Replay / help entry point

Settings section "Tours & help": a `gz-lbl` heading and `gz-btn3 w` rows with a leading icon, matching "Replay app intro" directly beside it (`features/settings/settings.page.ts:129`). No floating help button is added to any screen.

## 7. Mobile layout rules

| Rule | Detail |
|---|---|
| Never cover the target | The engine flips top/bottom; steps choose a side so the popover lands on the emptier half |
| Keep clear of the tab bar | For targets above the tab bar the popover prefers `top`; for tab buttons it sits directly above the bar |
| Safe areas | The popover keeps 16 px from every viewport edge; the WebView already starts below the status bar |
| Small screens (320×568) | Width becomes 288 px; copy limits in `05` keep the popover under about 60% of the height |
| Landscape | If the viewport is under 420 px tall, tours are not offered and a running tour ends as `interrupted` |
| Keyboard | Tours are not offered while it is open; no step focuses an input |
| Long pages | Targets are scrolled to the centre; the tracker's tap row and the reader's Track button rely on this |
| One thing at a time | Never a pill and a popover together; never a popover and an Ionic overlay together |

## 8. Theme stylesheet (specification, for `src/theme/tour.scss`)

The preview used the following rules; they are the starting point for the real file, to be finished and checked on the phone in Phase 1.

```scss
// Scoped by popoverClass: 'gz-tour'. Loaded after the engine's own CSS.
.driver-popover.gz-tour {
  font-family: var(--gz-font);
  background: var(--gz-surface);
  color: var(--gz-text);
  border-radius: 24px;
  padding: 18px 18px 14px;
  box-shadow: 0 16px 36px rgba(53, 37, 62, 0.24), 0 0 0 1px var(--gz-border);
  width: min(310px, calc(100vw - 32px));
  max-height: min(60dvh, calc(100dvh - 32px));
  overflow-y: auto;
  box-sizing: border-box;
}
html[dir='ltr'] .driver-popover.gz-tour { font-family: var(--gz-font-latin); }

.gz-tour .driver-popover-title { font-weight: 700; font-size: 17px; line-height: 1.5; padding-inline-end: 34px; }
.gz-tour .driver-popover-description { font-size: 14.5px; line-height: var(--gz-lh-ar); color: var(--gz-text-2); margin-top: 4px; }
html[dir='ltr'] .gz-tour .driver-popover-title { line-height: 1.3; }
html[dir='ltr'] .gz-tour .driver-popover-description { line-height: var(--gz-lh-en); }

.gz-tour .driver-popover-close-btn {            // library: top:0; right:0
  top: 4px; right: auto; left: auto; inset-inline-end: 4px;
  width: var(--gz-touch); height: var(--gz-touch); color: var(--gz-text-3);
}
.gz-tour .driver-popover-footer { margin-top: 14px; display: flex; align-items: center; gap: 8px; }
.gz-tour .driver-popover-progress-text { display: none; }   // replaced by dots (aria-hidden) + spoken label
.gz-tour .gz-tour-dots { display: flex; gap: 5px; flex: 1; }
.gz-tour .gz-tour-dots i { width: 7px; height: 7px; border-radius: 7px; background: var(--gz-lavender-200); }
.gz-tour .gz-tour-dots i.past { background: var(--gz-lavender); }
.gz-tour .gz-tour-dots i.on { width: 20px; background: var(--gz-primary); }

.gz-tour .driver-popover-footer button {
  min-height: var(--gz-touch); padding: 0 16px; border: 0; border-radius: var(--gz-r-sm);
  font: inherit; font-weight: 700; font-size: 14.5px; text-shadow: none;
}
.gz-tour .driver-popover-next-btn { background: var(--gz-primary); color: #fff; box-shadow: 0 6px 14px rgba(129, 61, 181, 0.28); }
.gz-tour .driver-popover-next-btn[aria-disabled='true'] { background: var(--gz-disabled-bg); color: var(--gz-disabled-fg); box-shadow: none; }
.gz-tour .driver-popover-prev-btn { background: var(--gz-lavender-100); color: var(--gz-primary); }
.gz-tour .gz-tour-skip { background: none; color: var(--gz-text-3); font-weight: 600; padding: 0 6px; }
.gz-tour .driver-popover-footer button:focus-visible { outline: 3px solid var(--gz-primary); outline-offset: 2px; }
```

Engine configuration that goes with it: `popoverClass: 'gz-tour'`, `overlayColor: '#35253e'`, `overlayOpacity: 0.58`, `stagePadding: 6`, `stageRadius: 20`, `duration: 250`, `overlayClickBehavior: 'none'`, `disableActiveInteraction: true` (blocked steps; `false` only on the one action step), `showProgress: true` (kept for the spoken label), dots and Skip added in `onPopoverRender`.

Selectors above are the engine's class names as of 1.14.0; they are the reason the engine version is pinned.
