# Screen map — approved design → Angular routes

Source of truth: Claude Design artifact *غرزتك — Gharzetak* (`Main.dc.html` interactive prototype,
`Gallery.dc.html`, `Screen_S01…S25`, `Screen_T01…T09`, `handoff/screen-manifest.json`).
All 25 screens and 9 states are implemented. "Prototype behaviour" = what the design's
interactive prototype did; "Implementation" = what the Angular app does.

| ID | Screen / state | Route | Component | Implementation notes |
|---|---|---|---|---|
| GZ-S01 | Welcome | `/onboarding/welcome` | `features/onboarding/onboarding.page.ts` | Brand lockup (supplied logo if present, else DS mark), language switch, Skip, “I have an account”. |
| GZ-S02 | Learn step by step | `/onboarding/learn` | same | |
| GZ-S03 | Track your stitches | `/onboarding/track` | same | |
| GZ-S04 | Your AI assistant | `/onboarding/assistant` | same | “Let’s go” → sign-up (or Home when already signed in / replaying). |
| GZ-S05 | Log in | `/auth/login` | `features/auth/auth.page.ts` | **Real Supabase Auth** (prototype accepted any credentials). |
| GZ-S06 | Sign up | `/auth/signup` | same | Real sign-up → setup; email-confirmation message when enabled. |
| — | Forgot password | `/auth/forgot` | `forgot-password.page.ts` | New (prototype showed a demo toast). |
| — | Set new password | `/auth/reset` | `reset-password.page.ts` | Recovery link target. |
| GZ-S07 | Experience & terminology | `/setup/experience` | `features/onboarding/setup.page.ts` | |
| GZ-S08 | Interests | `/setup/interests` | same | |
| GZ-S09 | Hooks, yarn & accessories | `/setup/tools` | same | Saved to `profiles` + `user_tools`. |
| GZ-S10 | Home | `/tabs/home` | `features/home/home.page.ts` | Pull-to-refresh sync when signed in. |
| GZ-S11 | My projects | `/tabs/projects` | `features/projects/projects.page.ts` | |
| GZ-T01 | Projects — done tab | `/tabs/projects?status=done` | same | |
| GZ-T02 | Projects — empty | `/tabs/projects` (no projects) | same | |
| GZ-S12 | Project details | `/tabs/projects/:id` | `project-detail.page.ts` | + Delete with confirmation (not in design; required by spec). |
| GZ-S13 | New project | `/tabs/projects/new` | `new-project.page.ts` | Typed reactive form; tab bar hidden as in design. |
| GZ-S14 | Tracker — simple | `/tabs/tracker` | `features/tracker/tracker.page.ts` | Engine: `core/domain/tracker-engine.ts`. |
| GZ-S15 | Tracker — pattern-aware | `/tabs/tracker` (mode = pattern) | same | |
| GZ-T03 | Tracker — round complete | (state) | same | Mint ring + glow, success note. |
| GZ-T05 | Sheet — counter settings | (sheet) | same | `gz-sheet` (ion-modal sheet). |
| GZ-T06 | Sheet — reset confirmation | (sheet) | same | |
| GZ-S16 | Pattern library | `/tabs/home/patterns` | `features/patterns/pattern-library.page.ts` | |
| GZ-S17 | Pattern reader | `/tabs/home/patterns/:id` | `pattern-reader.page.ts` | Reading position saved; attribution shown. |
| GZ-S18 | Add pattern | `/tabs/home/patterns/new` | `add-pattern.page.ts` | PDF/image stored as reference only — no OCR claimed. |
| GZ-S19 | Learn (videos) | `/tabs/learn` (`?saved=1`) | `features/learning/learn.page.ts` | |
| GZ-S20 | Video detail | `/tabs/learn/:id` | `features/video-tutorials/video-detail.page.ts` | + official YouTube privacy embed for a user-supplied YouTube link, creator credit. |
| GZ-S21 | AI assistant | `/tabs/assistant` | `features/ai-assistant/assistant.page.ts` | Demo mode, clearly labelled. |
| GZ-T04 | Assistant — conversation | (state) | same | |
| GZ-S22 | Terminology dictionary | `/tabs/home/terms` | `features/terminology/terminology.page.ts` | |
| GZ-S23 | Terminology converter | `/tabs/home/terms?tab=conv` | same | |
| GZ-S24 | Store (coming soon) | `/tabs/home/store` | `features/store/store.page.ts` | Interest saved to `store_interest` when signed in. |
| GZ-S25 | Settings | `/tabs/home/settings` | `features/settings/settings.page.ts` | |
| GZ-T07 | Sheet — tools | (sheet: Home, Settings) | `shared/ui/dialogs/common-sheets.ts` | |
| GZ-T08 | Sheet — notifications | (sheet: Home) | same | |
| GZ-T09 | Sheet — erase all data | (sheet: Settings) | `settings.page.ts` | Erases *device* data; cloud data untouched. |
| DS | Design system preview | `/design-system` | `features/design-system/design-system.page.ts` | Internal: tokens, type, components, icons; guest-only demo data loader for QA. |

## Navigation (from `navigation-flow.json`)

Each bottom tab keeps its own Ionic navigation stack (`/tabs/<tab>/…`). Screens the prototype
attached to the Home tab (store, patterns, pattern reader, terms, settings) live under `/tabs/home/…`;
project screens under `/tabs/projects/…`; video detail under `/tabs/learn/…`.
After sign-in/sign-up the app uses `navigateRoot(..., { replaceUrl: true })`, and `signedOutGuard`
redirects signed-in users away from onboarding/auth, so Back never returns to the login form.
