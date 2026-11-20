# Khayoota hosted AI for the shared test build: access, daily limits, cost and safety

Status: implemented, deployed to the **staging** Worker only (2026-11-20), verified on the live deployment with throw-away accounts.
The public/production backend is untouched: hosted AI stays **off** there (`env.production` unchanged).

## What changed

| Topic | Before | Now (staging / shared test build) |
|---|---|---|
| Who may use hosted AI | one tester e-mail (`AI_ALLOWED_EMAILS` secret), everyone else `403 ai_access_restricted` | **every signed-in account** (email/password or Google): `AI_ALLOWED_USER_IDS="*"` on the staging Worker. Guests have no account, never reach the Worker, and keep the offline helper. |
| Daily limit per account | 60 messages, 10 photos, 6 extractions (UTC day) | **10 messages + 5 images per day**, day = **Africa/Cairo** calendar date |
| What counts | one "request" of a kind | a message = 1 chat unit; each image actually sent = 1 image unit. Text only = 1/0, one photo = 1/1, three photos = 1/3. Reading a pattern from photos is a hosted request too: 1 + one per photo. |
| Exempt account | none | `radwa.ghes@gmail.com`: no per-account daily limit (see Security) |
| Retries | a retry was charged again | idempotent per user action; failed requests are refunded (capped) |

Offline rules-based answers are answered on the phone and never contact the Worker, so they never consume allowance.

## Enforcement (server side, D1)

* `ai_usage_daily` (per account and day) is charged by **one conditional upsert**:
  `chat = chat + c`, `image = image + i` only `WHERE chat + c <= 10 AND image + i <= 5`. Both counters move together or not at all, so concurrent requests can never exceed either cap and a 3-photo message is all-or-nothing. A message with 3 photos when 2 images remain is refused (`429 ai_quota_exceeded`, `kind: "image"`, `remaining`, `requested`) **before any model call**, and nothing is charged.
* The counter lives in D1 keyed by the account id: signing out, reinstalling, a second phone or calling the Worker directly with the same account all hit the same counter. Nothing is trusted from the app (there is no client-side counter that matters; the app only displays the server's numbers and pre-checks to be kind).
* Order of checks: kill switch → access → consent → body size/Zod → feature flag → image magic bytes → burst window → idempotency ledger → **daily units** + global request cap → Neuron reservation → model. Invalid images, oversized uploads and malformed bodies are rejected before anything is charged.
* Day boundary: `quotaDay()` = the Cairo date from the platform tz database (Egypt observes DST again: UTC+2 winter / UTC+3 summer). `nextQuotaReset()` finds the first instant the date changes by bisection, so it is right on the DST days (spring: the day starts at 01:00 local; autumn: 23:00–24:00 happens twice). Examples tested: winter `2026-01-15T22:00Z`, summer `2026-07-15T21:00Z`, spring `2026-04-23T22:00Z`, autumn `2026-10-29T22:00Z`. The account-wide Workers AI ceilings (global request cap, Neuron budget) stay on the **UTC** day because Cloudflare's free allocation resets at 00:00 UTC.
* **Idempotency / retries.** The app sends `clientRequestId` (one UUID per user action; a "Try again" reuses it). `ai_request_ledger (user_id, request_id, day, chat, image, state)`:
  `reserved` → `done` (reply produced; a retry gets `409 ai_duplicate_request`, never charged twice, the reply is never stored) or `refunded` (no reply; a retry may run and is charged once in total). Two concurrent requests with the same key: one wins, the others get `409 ai_request_in_progress`. A Worker that died mid-request leaves `reserved`; after 3 minutes a retry with the same key re-claims it without a second charge.
* **Refunds** (provider timeout/busy/error/bad output, global ceiling hit after charging) give the account's units back, at most **3 per account per day** (`AI_USER_DAILY_REFUNDS`), so failures cannot be farmed. The Neuron reservation is **never** refunded (a failed call may still have cost something).
* Old fields stay in the v1 responses (`limits`, `remaining`, `resetAt`) for older app builds; the authoritative view is `quota: { unlimited, timezone, chat{used,limit,remaining}, image{…}, resetAt }` (`resetAt` is `null` for the exempt account).

## The unlimited exception: how it is secured

* Config: Worker **secret** `AI_UNLIMITED_EMAILS` (comma list, set with `wrangler secret put`; the address is not in git).
* Decision (`userUnlimited`): read the **stored** e-mail and `email_verified` from D1 for the session's user id (set by `requireUser` from the validated Better Auth session), `trim().toLowerCase()`, exact match, and `email_verified = 1`. Nothing the client sends (body field, header, flag) is consulted; the request schema is `strict()`, so an `email`/`isUnlimited` field is a 400.
* A stranger who simply signs up with `radwa.ghes@gmail.com` and a password is **not** exempt: staging has no mail provider, so that sign-up stays `email_verified = 0`. Google sign-in verifies the address, so the real owner (staging D1: the account exists, `verified = 1`, provider `google`) qualifies. Look-alikes (`radwaghes@`, `radwa.ghes+x@`) do not (no Gmail canonicalisation on purpose). Better Auth's `accountLinking.requireLocalEmailVerified` prevents linking a Google identity onto an unverified password account.
* It is **only** a quota exemption. Authentication, consent, the kill switch, the burst limiter (20 weighted units/minute), the global request cap and the global Neuron budget all still apply to this account, and it gains no administrative capability.
* Even exempt usage is **counted** (visible in D1), it just has no per-account limit.

## Cost and safety controls

Facts re-checked from the deployment (2026-11-20): Workers AI free allocation is 10,000 Neurons/day for the whole Cloudflare account (all Workers, dashboard playground, scripts), reset 00:00 UTC; on the free plan going over is an error with no charge, on Workers Paid overage is $0.011 per 1,000 Neurons for the whole account. Gemma 4 26B A4B: $0.10 / $0.30 per million input / output tokens (9,091 / 27,273 Neurons per million). Nothing else on the account used Workers AI in the previous 30 days.

Measured on staging (D1 global row, same day, including real chats, one image question and pattern readings): 24 requests ≈ 649 Neurons, i.e. **≈ 27 Neurons per request on average** (62k input / 2.3k output tokens).

| Control | Value | Applies to |
|---|---|---|
| Per-account daily | 10 messages, 5 images | everyone except the exempt account |
| Burst limiter | 20 weighted units/min (message 1, +3 per image, pattern read 6) | **everyone** |
| Global request cap | **250 / UTC day** (was 100) | everyone |
| Global Neuron budget (worst-case reservation before every call) | **6,000 / UTC day** (was 3,000) ≈ 220 average requests | everyone |
| Emergency stop | `AI_ENABLED="false"` + redeploy (or set the var in the dashboard): `503 ai_disabled`, the app falls back to the offline helper | everyone, exempt account included |
| Models | allowlisted only (Gemma 4 26B A4B); per-call timeouts; output token caps | everyone |

Worst case: the 6,000-Neuron budget is a hard stop for this Worker, so it can never use more than ~6,000 Neurons/day: inside the free 10,000, leaving 4,000 for anything else. If other consumers on the account push the total over 10,000 on a Workers Paid plan, the overage is billed at $0.011/1,000 Neurons (6,000 Neurons ≈ $0.066). The counter only sees this Worker (it cannot see the playground or scripts) and is based on estimates (they were within 0.2 % of Cloudflare's totals in the pilot); nothing in code can cap the account. **No paid service was purchased or activated.** To go lower, reduce `AI_DAILY_NEURON_BUDGET` / `AI_DAILY_REQUEST_CAP` in `wrangler.jsonc` and redeploy.

Capacity note: with 10 messages per account, 250 requests/day is shared by everyone: about 25 fully active accounts per day. When it runs out, every account (the exempt one too) gets the existing "Khayoota is resting until tomorrow" state until 00:00 UTC.

## App UI (Arabic and English)

Under the composer, from the server's numbers: «الرسائل المتبقية اليوم: 10 من 10» / «الصور المتبقية اليوم: 5 من 5» (English: "Messages remaining today: 10 of 10", "Images remaining today: 5 of 5"); the exempt account sees «استخدام غير محدود» / "Unlimited usage" and no countdown. After a reply the numbers come from the reply's `usage`; after any refusal or failure the app re-reads `/v1/ai/status`. The options sheet shows the same lines plus the reset line («الحصة بتتجدد عند منتصف الليل بتوقيت القاهرة — بعد … ») when something is used up.

* Photos that do not fit today's images are refused **before sending** (draft and tray stay) with the exact numbers; the tray never offers more photos than remain.
* Messages used up: the server is not called; the conversation stays; a labelled error note explains the limit and the reset; text questions still get the labelled offline helper (which costs no allowance). Nothing pretends to be an AI reply.

## Verification

* Backend: 204 tests (176 existing + 28 new `ai-quota.test.ts`) cover: start at 10/5; 10 messages then refusal; 5 images then refusal; N-image accounting; independence of the two counters; all-or-nothing; invalid/oversized/fake images charge nothing; unauthenticated 401; two devices / sign-out / reinstall share one counter; direct API calls limited; concurrency (16 parallel → exactly 10); duplicate keys; refunds and the refund cap; crashed-request re-claim; reset in summer and winter (fake clock) and the four DST cases; exempt account (normalisation, persistence across sessions/devices, spoofing via body/headers, look-alikes, unverified squatter, still subject to auth/consent/kill switch/burst/global caps); kill switch and consent preserved; deny-all in deployed environments without an allowlist.
* App: 1050+ specs (formatting AR/EN, unlimited, reset text, pre-checks, idempotency-key reuse on retry, exhausted flows).
* Live staging: `apps/api/scripts/smoke-ai-quota-remote.mjs` (34 checks, throw-away accounts that are deleted at the end): a brand-new account is enabled; real Gemma replies; a real image question and a real pattern reading from a rendered pattern page (the transcript was compared with the printed text, not trusted because it returned 200); 4 images with 3 left refused before the model; the 11th message refused with `resetAt` = Cairo midnight (`22:00Z`, winter); second device shares the counter; sign-out/in does not reset; duplicate key 409 and charged once; a stranger sending the exempt e-mail by header/body stays limited. The real exempt account was **not** signed in (its owner must do that).

## Limits of what was verified

* Image understanding was tested on a rendered printed-pattern page and the earlier phone QA (`real-android-ai-qa.md`, `real-vision-pattern-qa.md`). A successful model response is **not** proof that a photo of crochet work was interpreted correctly: stitches, rows and counts from photos still need the user's review, and the deterministic parser, not the model, validates counts.
* The `smoke-ai-remote.mjs --stage B` script asserts the old tester-only policy and is superseded by `smoke-ai-quota-remote.mjs` for the shared test staging.
* Daily reset was verified with a fake clock and by checking the live `resetAt`; the live rollover itself (waiting for midnight) has not been observed.
