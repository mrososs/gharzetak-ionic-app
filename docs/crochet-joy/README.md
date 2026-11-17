# Crochet Joy — Celebrations, Achievements, Sharing & Smart Reminders

**Status:** architecture and product decisions **approved 2026-11-17**; full MVP (P0–P4) implemented on `feat/crochet-joy-implementation`; P5 automated checks done, **physical-Android QA pending** (see `qa-report.md`). The planning branch (`feat/crochet-joy-planning`, `d8f465f`) touched no application code. **No Cloudflare changes** are part of this work; achievements are device-local (cross-device sync deferred); guest achievements and round counts are migrated on guest → account import (see `risks-and-decisions.md` §0).
**Branch:** `feat/crochet-joy-planning` · **Base:** `origin/development` @ `f616ee9da19a994009b1b808749c22690e4ed36d` (2026-11-17, "fix(ui): real-device QA fixes …"), which includes Pattern Collections, multi-part tracker, durable timer, avatars and Android immersive navigation.

## Documents

| File | Contents |
|---|---|
| [architecture.md](architecture.md) | Codebase findings (tracker engine, stores, sync, UI, native), event model, data models, offline design, planner & router |
| [cloudflare-readiness.md](cloudflare-readiness.md) | Live Cloudflare audit, Local vs Remote push comparison, backend changes, cost estimates |
| [ux-specification.md](ux-specification.md) | Celebration levels, avatar reactions, achievements, share cards, reminder settings & opt-in, AR/EN copy |
| [implementation-plan.md](implementation-plan.md) | Phases P0–P6 with files, dependencies, acceptance criteria, tests, estimates |
| [qa-test-matrix.md](qa-test-matrix.md) | Celebration, achievement, sharing, notification and regression test plan |
| [qa-report.md](qa-report.md) | What was actually verified (automated / browser / device), what is pending or blocked, known limitations |
| [risks-and-decisions.md](risks-and-decisions.md) | Decisions, risk register, open questions, unverified items |

## Executive summary

Gharzetak already has everything Crochet Joy needs to *know* when something is finished (`tracker-engine.ts`, `collections.ts` completion maths), but it never *records* completion — rounds and parts are derived from state, and sync/merge/restart replace state wholesale. So the core of this feature is a small **origin-gated detector + idempotent local ledger**: only a user's counting tap (or an explicit "mark finished") can produce an event, and each event key can be stored only once. Everything else — celebrations, avatar reactions, achievements, share cards, reminders — sits on top of that and runs **entirely on the device**.

**Cloudflare is not needed for the MVP.** Local notifications (`@capacitor/local-notifications` 8.3.x) satisfy every reminder requirement offline, for free, with better privacy than push. The live Cloudflare account was audited: one staging Worker, D1 and private R2 bucket, no crons/queues; nothing new is required. (Two pre-existing issues were found and are flagged separately: staging lags `development` by two D1 migrations, and Free-tier CPU/D1-write limits are at risk from auth hashing and per-tap progress sync — neither is caused by Crochet Joy.)

## Feature scope

1. **Round celebrations** in 4 levels — L1 mini-banner per round (non-blocking, rate-limited), L2 milestone card (25/50/75 %), L3 part-completion sheet with avatar cheer, L4 full-screen project finale.
2. **Avatar reactions** — the 6 existing crochet avatars + CSS motion + 4 shared overlay SVGs (no new character art for MVP).
3. **Achievements** — 8 personal, non-competitive badges; never re-locked; round counts only from real taps.
4. **Share cards** — on-device PNG (1080×1350), privacy toggles + preview, OS share sheet (WhatsApp etc.), text fallback.
5. **Smart reminders** — opt-in, ≤ 2/week by default, quiet hours, generic lock-screen text by default, deep link to project → part → current round behind auth/biometric gates.

## Recommended MVP

P0 → P1 → P2 → P3, with P4 in parallel after P0, then P5 hardening (≈ 13–17.5 AI-assisted days). P2b (cross-device achievements, additive D1 migration) and P6 (remote push) are optional/deferred.

**Implement first: P0 — the event foundation** (pure `detectJoy` + `joy` ledger + `origin` plumbing in `AppStore.updateTracker/updatePartTracker`, including the second tap surface in `VideoDetailPage`). It is small, fully unit-testable, invisible to users, and every other phase depends on it.

## Evidence labels

Documents mark statements as **[Verified]** (code read, live API, official docs fetched 2026-11-17), **[Recommendation]**, **[Assumption]** or **[Unverified]**. No test results are claimed — the QA matrix is a plan.
