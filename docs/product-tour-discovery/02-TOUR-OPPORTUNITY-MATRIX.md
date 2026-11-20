# 02 — Tour Opportunity Matrix

Every candidate location, what it would explain, and the decision. Targets are real elements with file and line; "hook today" says whether a stable selector already exists. The `data-tour` names are proposals; none exists in the code yet.

Priority: **P0** ships in v1 · **P1** next · **P2** later · **No** deliberately excluded.
Type: **Welcome** · **Tour** (multi-step, offered on first visit) · **Hint** (one step) · **Checklist** (task) · **None**.

## 1. Matrix

| Page | Route | User goal | Target element | Suggested explanation | Type | Priority | Preconditions | Guest / Auth | Complexity |
|---|---|---|---|---|---|---|---|---|---|
| Home | `/tabs/home` | Find the pattern library | Quick tile "Pattern reader", `home.page.ts:89` (3rd tile) | Your patterns live here | Welcome 1 | P0 | Store loaded, Home visible, no overlay | Both | Low |
| Home | `/tabs/home` | Find projects | `ion-tab-button#tab-button-projects`, `tabs.layout.ts:30` | Everything you are making; a project is a pattern plus your progress | Welcome 2 | P0 | Tab bar visible | Both | Low |
| Home | `/tabs/home` | Find the counter | `#tab-button-tracker` | Count here; it saves as you go | Welcome 3 | P0 | Tab bar visible | Both | Low |
| Home | `/tabs/home` | Find tutorials | `#tab-button-learn` | Stitch and basics tutorials | Welcome 4 | P0 | Tab bar visible | Both | Low |
| Home | `/tabs/home` | Know Khayoota exists | `#tab-button-assistant` | Ask about any stitch or round (no AI promise) | Welcome 5 | P0 | Tab bar visible | Both | Low |
| Home | `/tabs/home` | Find settings and help | `button.gz-avatar-btn`, `home.page.ts:35` | Settings; replay this tour here | Welcome 6 | P0 | — | Both | Low |
| Home | `/tabs/home` | Know what to do next | New Getting Started card (does not exist yet) | Five first steps, ticked by real actions | Checklist | P0 | Welcome handled, not dismissed | Both | Medium |
| Home | `/tabs/home` | Resume work | Hero card `div.gz-hero`, `home.page.ts:49` | — | None | No | — | — | Self-explanatory: one big "Resume" button |
| Home | `/tabs/home` | Tools, bell, favourites, store | `home.page.ts:40-41, 73, 114` | — | None | No | — | — | Secondary; store is a teaser |
| Pattern library | `/tabs/home/patterns` | Explore a sample | First sample row `button.gz-rcard`, `pattern-library.page.ts:61` | Patterns marked "Sample" are ready to try | Tour 1/3 | P0 | Unfiltered list (samples visible) | Both | Low |
| Pattern library | same | Tell the two kinds apart | Type chips `div[role=tablist]`, `:47` | Standalone = one piece; multi-part = several | Tour 2/3 | P0 | — | Both | Low |
| Pattern library | same | Add a pattern | Header add button `button.gz-icb.pur`, `:38` | Type or paste, then start a project from it | Tour 3/3 | P0 | — | Both | Low |
| Pattern reader | `/tabs/home/patterns/:id` | Read round by round | Reading card `div.gz-card.focus`, `pattern-reader.page.ts:74` | Current round with a plain explanation; place is saved | Tour 1/3 | P0 | Pattern has text | Both | Low |
| Pattern reader | same | Move between rounds | Next round button, `:88` | Next/previous, or tap a round below | Tour 2/3 | P0 | More than one round | Both | Low |
| Pattern reader | same | Count along with it | "Track with this pattern", `:96` | Link to a project, then track (copy differs when the user has no project) | Tour 3/3 | P0 | Pattern has text | Both | Medium (state-dependent copy) |
| New project | `/tabs/projects/new` | Name it | Name field wrapper `div.gz-in`, `new-project.page.ts:36` | Only the name is required | Tour 1/2 | P1 | Tab bar is hidden here | Both | Medium (form, keyboard, unsaved-changes guard) |
| New project | same | Start from a pattern | Source block, `:44-54` | Pick a saved pattern and the tracker follows it; Save is at the bottom | Tour 2/2 | P1 | Block exists (always: samples qualify) | Both | Medium |
| Projects list | `/tabs/projects` | Open or create | — | — | None | No | — | — | Three visible "New project" buttons already |
| Project detail | `/tabs/projects/:id` | Continue | "Resume project" `button.gz-btn`, `project-detail.page.ts:46` | Opens the tracker where you stopped | Hint | P2 | A project | Both | Low |
| Tracker (simple) | `/tabs/tracker` | Read the counter | `gz-ring`, `tracker.page.html:54` | Big number = stitches this round; target under it | Tour 1/4 | P0 | Current project, simple mode | Both | Low |
| Tracker (simple) | same | Count | `button.gz-bigbtn`, `:70` | Each tap counts and saves. Invites one tap. | Tour 2/4 (action) | P0 | Not the last round | Both | Medium (real data) |
| Tracker (simple) | same | Recover from a mistake | Undo `button.gz-icb.lg` (first), `:69` | Takes back the last tap | Tour 3/4 | P0 | — | Both | Low |
| Tracker (simple) | same | Come back later, switch project | Header picker button, `:3` | Progress is saved; switch project here | Tour 4/4 | P0 | — | Both | Low |
| Tracker (pattern) | same | See the rounds | Round pills `div.gz-hs`, `:88` | Highlighted = current; tap to jump | Tour 1/5 | P0 | Pattern mode with a usable pattern | Both | Medium |
| Tracker (pattern) | same | Read the instruction | Instruction card, `:93` | Stitches of this round, with a count check | Tour 2/5 | P0 | — | Both | Medium |
| Tracker (pattern) | same | Know where in the round | Current-step card, `:116` | Which stitch you are on and what is next | Tour 3/5 | P0 | Round not complete | Both | Medium |
| Tracker (pattern) | same | Choose tap size | "Count by" segment, `:127` | A tap can be a stitch, a group or the round | Tour 4/5 | P0 | — | Both | Medium |
| Tracker (pattern) | same | Count and undo | Tap row, `:133` | Big button counts; the one beside it undoes | Tour 5/5 | P0 | — | Both | Low |
| Tracker (multi-part) | same | Switch pieces | Piece switcher `div[role=tablist]`, `:36` | Each piece has its own counter; "1/2" = first of two | Tour 1/2 | P1 | Project made from a multi-part pattern | Both | Medium |
| Tracker (multi-part) | same | See whole-project progress | Completion line, `:25` | Pieces finished out of total | Tour 2/2 | P1 | Same | Both | Low |
| Tracker | same | Timer, settings, mode switch, reset, round stepper | `:9, :13, :45, :73` | — | None | No | — | — | Timer chip and mode labels are readable; the settings round-stepper wipes undo history and must not be advertised |
| Khayoota | `/tabs/assistant` | Understand what is answering | Status line `button.kh-status[data-mode]`, `assistant.page.ts:189` | Copy chosen from `data-mode` | Tour 1/3 | P1 | Server status settled | Both | High (six modes) |
| Khayoota | same | Ask | Composer `div.kh-composer`, `:169` | Nothing is sent until you press Send | Tour 2/3 | P1 | — | Both | Medium |
| Khayoota | same | Control it | Options button, `:68` | Clear chat; testers: turn AI off | Tour 3/3 | P1 | — | Both | Medium |
| Khayoota | same | Photo, suggestion chips, "Explain round" | `:88, :165, :170` | — | None | **No** | — | — | Chips and Explain send immediately; the camera opens the OS picker in every mode |
| Smart paste | `/tabs/home/patterns/import` | Read the result | Status badges `div[role=status]`, `smart-import.page.ts:71`; Confirm, `:157` | Validated / needs review / unsupported; nothing is saved until you confirm, then Save in the editor | Tour (2) | P2 | After the first Convert | Both | High (conditional DOM, long page) |
| Add pattern | `/tabs/home/patterns/new` | Get unstuck on notation | "Fill an example" `:90`, "Smart paste" `:88` | Not sure how to write it? Try an example or paste free text | Hint | P2 | Text source | Both | Medium (keyboard) |
| Multi-part editor | `/tabs/home/collections/new` | Understand parts and quantity | "Add a part" `collection-editor.page.ts:126` | A part is made once or several times; set the quantity | Hint | P2 | — | Both | High |
| Multi-part detail | `/tabs/home/collections/:id` | Start a project | `:43` | — | None | No | — | — | One clear primary button near the top |
| Learn | `/tabs/learn` | Find a tutorial | — | — | None (Checklist item) | No | — | Both | Page already carries an explanatory note |
| Video detail | `/tabs/learn/:id` | Follow along | — | — | None | **No** | — | — | Code rule: never cover the video; primary action leaves the app |
| Terminology | `/tabs/home/terms` | Look up / convert | — | — | None | No | — | — | Pre-filled, local |
| Achievements | `/tabs/home/achievements` | View | — | — | None | No | — | — | — |
| Store | `/tabs/home/store` | — | — | — | None | **No** | — | — | "Coming soon" teaser; pointing at it would mislead |
| Settings | `/tabs/home/settings` | Replay tours | New "Tours & help" section | — | Entry point | P0 | — | Both | Low |
| Onboarding, Auth, Setup, Lock screen, Design System | — | — | — | — | None | **No** | — | — | A tour must never run on these |

## 2. Summary by decision

| Decision | Screens |
|---|---|
| Tour in v1 (P0) | Home (welcome, 6), Pattern library (3), Pattern reader (3), Tracker simple (4), Tracker pattern (5) |
| Tour next (P1) | New project (2), Tracker multi-part (2), Khayoota (3) |
| Later (P2) | Smart paste (2), hints on Add pattern, Multi-part editor, Project detail |
| Task in the Getting Started card | Explore a sample pattern, Create a project, Try the tracker, Open a tutorial, Ask Khayoota |
| No guidance | Projects list, Multi-part detail, Learn, Video detail, Terminology, Achievements, Store, Settings rows, Onboarding, Auth, Setup, Design System |

## 3. Why some screens get nothing

- **Projects list** is already the simplest screen in the app.
- **Learn** explains itself with an inline note, and the action that matters (open a topic) is covered as a Getting Started task.
- **Video detail** must not be covered, and its main button leaves the app.
- **Store** is not a feature yet.
- **Settings**: a tour of settings rows teaches nothing a label does not. What Settings lacks is a help entry, which this feature adds.
- **Khayoota's chips, camera and "Explain round"**: highlighting them invites a tap that sends a message or opens the OS picker. They are left alone.
- **Tracker settings sheet**: lives in an overlay (not tourable in v1) and contains a control that wipes undo history.

## 4. Verified targets and the hooks they need

No target has a language-independent hook today except the tab buttons. The change is one attribute per target, added through a small directive (`07` §5).

| `data-tour` id | Element | File:line | Hook today | Notes |
|---|---|---|---|---|
| `tab.projects`, `tab.tracker`, `tab.learn`, `tab.assistant` | `ion-tab-button` host | `layout/tabs-layout/tabs.layout.ts:30` | `#tab-button-<id>` (Ionic runtime id) | Add the attribute anyway so tests and tours share one convention |
| `home.patterns-tile` | Quick tile for patterns | `features/home/home.page.ts:89` | None (tiles come from a loop) | Add an optional `tour` key to the `QuickTile` item at `:171` and bind it |
| `home.avatar` | Avatar button | `home.page.ts:35` | `.gz-avatar-btn` (also on Settings) | |
| `home.getting-started` | New card | new | — | |
| `patterns.sample-row` | First sample row | `features/patterns/pattern-library.page.ts:61` | None | Bind only on the first row where `isSample` |
| `patterns.kind-filter` | Type chip row | `:47` | `[role=tablist]` | |
| `patterns.add` | Header add button | `:38` | `.gz-icb.pur` | |
| `reader.focus-card` | Reading card | `features/patterns/pattern-reader.page.ts:74` | `.gz-card.focus` | |
| `reader.next-round` | Next round | `:88` | None | |
| `reader.track` | Track button | `:96` | None | |
| `project-new.name` | Name field wrapper | `features/projects/new-project.page.ts:36` | `#np-name` on the inner `ion-input` | Target the wrapper, not the input |
| `project-new.source` | "Start from a saved pattern" block | `:44` | None | Needs a wrapping element around label + chip row |
| `tracker.ring` | Progress ring (simple) | `features/tracker/tracker.page.html:54` | `gz-ring` tag | |
| `tracker.tap` | Big button (both modes) | `:70`, `:135` | `.gz-bigbtn` | Same id in both branches; only one exists at a time |
| `tracker.undo` | Undo | `:69`, `:134` | None | |
| `tracker.tap-row` | Row holding undo, tap, reset (pattern) | `:133` | None | |
| `tracker.project-picker` | Header picker | `:3` | None | |
| `tracker.round-pills` | Round pill strip | `:88` | None | |
| `tracker.instruction` | Instruction card | `:93` | None | |
| `tracker.current-step` | Current-step card | `:116` | None | Absent when the round is complete; step is optional |
| `tracker.count-by` | Count-by segment | `:127` | None | |
| `tracker.piece-tabs` | Piece switcher | `:36` | `[role=tablist]` (not unique with the mode switch) | |
| `tracker.completion` | Completion line | `:25` | None | |
| `khayoota.status` | Status line | `features/ai-assistant/assistant.page.ts:189` | `.kh-status[data-mode]` | Keep `data-mode`; the tour reads it |
| `khayoota.composer` | Composer row | `:169` | `.kh-composer` | |
| `khayoota.menu` | Options button | `:68` | None | |

Total for v1 (P0): 21 target ids across 5 templates (23 placements, because the tracker's tap and undo buttons exist once in each mode branch). For P1: 7 more ids across 3 templates.
