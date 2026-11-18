# Khayoota AI — QA Implementation Report

Branch `feat/khayoota-ai-implementation`. Date 2026-11-18. What was tested, how, and — just as important — what was **not**.

## 1. Automated tests

| Suite | Command | Result |
|---|---|---|
| Frontend unit (Vitest via `ng test`) | `ng test --watch=false` (portable Node 24) | **39 files, 667 tests passed, 0 failed** |
| — new: `src/app/core/ai/khayoota.spec.ts` | | 24 passed: calculator facts, action registry (allowlist, foreign/retired ids, max 2), transcript → preview caps (uncertain, unreadable, chart, no-checksum continuity rule), error mapping, **pinned-revision context with the real AppStore**, offline helper uses the pinned revision |
| — new: `src/app/features/ai-assistant/assistant.page.spec.ts` | | 5 passed: hosted chat sends context + calc facts; consent first (nothing sent before OK); failed request → friendly error + offline answer; not hosted → offline helper, no network call; image → preview → **real editor opens with an unsaved draft** (pattern count unchanged) |
| API (Vitest + Workers pool, local D1) | `npx vitest run` in `apps/api` | **8 files, 121 tests passed** (29 in `ai.test.ts`) |
| API typecheck | `tsc --noEmit` | clean |
| Production web build | `ng build` | OK (templates type-checked; assistant chunk 44.7 kB raw / 13.5 kB transfer) |
| Benchmark harness | `live-pilot.mjs` dry run | caps and stop rules exercised; live part documented in `benchmark-results.md` |

**No automated test calls a real model.** All AI paths in tests use `FakeAiProvider` (API) or a faked `KhayootaService` (app).

## 2. Local browser run (fake provider) — 2026-11-18

Local Worker (`wrangler dev`, local D1, `AI_PROVIDER=fake`) + `ng serve`, mobile viewport 375×812, a throwaway local account created on the local D1 only.

| Step | Observed |
|---|---|
| Open Khayoota tab after sign-up | `GET /v1/ai/status` 200. Badge **"مستنية موافقتك"** (needs your OK). |
| Bug found | Before the fix the badge said **"بدون نت" (Offline)** although the device was online and only consent was missing. Fixed in `8b49d41` (states: AI / Demo / Needs your OK / Built-in rules / Offline). |
| Send "يعني إيه (2sc, inc) x 6؟" | Consent sheet opened; **no chat request was sent** (network log shows only status calls). |
| Accept consent | `PUT /v1/ai/consent` 200, then `POST /v1/ai/chat` 200. Reply: "الحسبة من الآلة الحاسبة بتاعة غرزتك: (2sc, inc) x 6 بتستهلك 18 غرزة وبتطلّع 24." — numbers from the on-device calculator facts. Labelled "رد تجريبي — مش من نموذج ذكاء اصطناعي". Badge "تجريبي". Footer "الباقي النهارده: 19". |
| Worker log | One allowlisted line: `{"khayoota":{"requestId":…,"route":"chat","kind":"chat","status":"reply","images":0,"degraded":false,"repaired":false,"actions":0}}` — no question text. |

Not exercised in the browser (covered by unit tests only): photo upload / image-to-pattern (file picker), project-aware action buttons from a real project, the tracker / project / pattern-reader entry points.

## 3. Live model checks

Only the bounded pilot in `benchmark-results.md` (27 requests, 1,626.5 measured Neurons, synthetic data). No live model call was made from the app, from tests, or from staging.

## 4. Real Android device

See §6 of `implementation-progress.md`: the branch debug build installs and starts on the HONOR phone, but the phone and the app’s fingerprint lock were locked, so **no on-device Khayoota test was done**. Hosted Khayoota **cannot** be tested on the phone yet: the staging Worker does not have `/v1/ai` (not deployed — needs your approval), so the device can only show the fallback path.

## 5. Not tested / open

- Hosted Khayoota with a real model end-to-end (needs staging deploy + migration + `AI_ENABLED=true`, each needing approval).
- Real photographs, handwriting, Arabic dialect quality with human raters — gates in `benchmark-plan.md` §5 are **not** passed.
- iOS.
- Accessibility pass with TalkBack on the new reply cards.
- Load beyond the unit-level concurrency test.
