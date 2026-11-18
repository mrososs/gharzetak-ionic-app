# Khayoota AI — Real Android QA with the real Gemma 4 model

Date: 2026-11-18 (UTC 21:30 → 23:00). Device: HONOR DNY-NX9 (Android 16) over USB, **no emulator**.
Account: the single allowlisted tester (verified Google e-mail, server-side allowlist — see §2).
Path proven for every row marked REAL: **Android app → authenticated `/v1/ai/*` on staging → `WorkersAiProvider` → `env.AI.run('@cf/google/gemma-4-26b-a4b-it')` → validated JSON → Smart Parser / typed actions → Gharzetak UI.**

Evidence per request: the app's own network traffic recorded read-only over WebView DevTools (no headers stored) **and** the
Worker's allowlisted log line (`provider: workers-ai`, `model`, tokens, Neurons, latency — no content), plus account-level
Workers AI analytics. Raw transcripts and screenshots stay local (not committed). Fake provider: **never** used for any row here.

## 1. Staging changes made for this test (approved controlled tester rollout)

| Step | Result |
|---|---|
| Target check | Only resources on the account: Worker `gharzetak-api-staging`, D1 `gharzetak-db-staging`. No production resources exist. |
| Backup | D1 Time Travel bookmark `0000001f-00000000-00005127-bd85f10757a05648d7ac5b1eab4a1e0f` + SQL export (outside the repo). The raw export did **not** replay (tables are exported alphabetically, `account` before `user`); a restore-ordered copy was made and **verified**: local restore row counts = staging row counts for every table. |
| Migration | `0004_ai_usage.sql` applied remotely (3 tables + 1 index, additive). Users/projects/sessions unchanged (7/6/17). |
| Stage A | Deployed with `AI_ENABLED=false`: existing smoke 29/29, AI Stage A smoke 10/10. |
| Allowlist | `AI_ALLOWED_EMAILS` stored as a Worker **secret** (not in git, not in the APK). Deny-all for everyone else. |
| Stage B | `AI_ENABLED=true`, Gemma 4 for chat/vision/extract, 3,000-Neuron daily budget, 100 requests/day, per-user chat 60 (QA), image 10, extract 6. Non-allowlisted account: 14/14 denial checks (403 `ai_access_restricted` on chat, photo chat, extract, consent; spoofed headers/body fields still 403; zero inference). |
| Kill switch (live) | Deployed `AI_ENABLED=false` → app showed «خيوطة غير متاحة حاليًا», **0** chat requests reached the API, built-in rules answered (labelled non-AI). Re-enabled afterwards. |

## 2. Access control (tester allowlist)

Server-side, from the Better Auth session's user id → D1 `user` row → **verified** e-mail must be listed (secret). Never from a
client field. Default deny in deployed environments. Kill switch beats the allowlist. Automated: 39+ API tests incl. unverified
e-mail rejected, spoofed headers/body, account switching, sign-out → 401, no inference on denial. Live: staging smoke above.

## 3. Test matrix (REAL = real Gemma 4 invoked)

| ID | Question / scenario | Provider · model | Request | REAL | Result | Context | Action | Latency | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| T1 | «خيوطة، إيه الفرق بين sc و hdc؟» | workers-ai · gemma-4 | 09d8d797 | YES | Correct: sc = غرزة الحشو/قصيرة, hdc = نص عمود, shorter than dc; Egyptian Arabic | none | 2× learn.explainStitch | 2.6 s | PASS |
| T2 | «لو عندي (2sc, inc) x 6 هيطلعوا كام غرزة؟» | ″ | dfe41292 | YES | 24 stitches (calculator fact used); did not mention the 18 consumed | calc | — | 1.8 s | PASS (partial wording) |
| T3 | Bunny arm bigger than the other — causes? | ″ | 1b8efffa | YES | Tension, round/stitch count, hook/yarn; no photo pretence | none | — | 5.4 s | PASS |
| T4 | «R4: (2sc, inc) x 6 [24] اشرحلي…» | ″ | 1062a97a | YES | Correct explanation, 24 | calc | 2× explainStitch | 4.2 s | PASS — **bug found**: calculator sent the whole sentence as an "unsupported" fact → fixed |
| T5 | «How do I make an invisible decrease…» | ″ | c5f7bb49 | YES | Correct steps but **answered in Arabic** | none | explainStitch | 4.6 s | FAIL → fixed (question language) |
| T5b | same, after fix | ″ | 39c3e9f6 | YES | Correct English: front loops of two sts, yo, pull through | — | explainStitch | 3.4 s | PASS |
| T6 | «In UK crochet terms, what does tr mean?» | ″ | 61ea2e70 | YES | UK tr = US dc ✔ but in Arabic | — | — | 1.1 s | FAIL (language) → fixed |
| T6b | same, after fix | ″ | f01d04da | YES | "UK tr = treble … same as US dc" | — | — | 1.3 s | PASS |
| SA | From the Tracker: «أنا مش فاهمة الدور اللي أنا شغالة عليه…» | ″ | a882757a | YES | Explains R31 «dec [6]», flags calculator mismatch (1 vs 6), refers to R30 | Bunny collection / piece الجسم / R31 / **snapshot rev 3** | tracker.openCurrentRound (correct ids) | 5.9 s | PASS |
| SC | «افتحيلي الدور الحالي.» | ″ | dcdf7c46 | YES | Proposed the allowlisted action; button rendered; tap opened the tracker at الجسم R31; progress unchanged (100 %, 7/7, 1/1, 0:00:00) | same | tracker.openCurrentRound | 3.0 s | PASS — text said «فتحتلك» (claimed an action) → prompt rule; later replies say «دوسي على الزرار تحت» |
| SB | «أنا خلصت الإيد الأولى، أفتح الإيد التانية إزاي؟» | ″ | 8780f48e | YES | Offered project.openPart on the **current finished** piece | all 7 pieces done | project.openPart (wrong piece) | 4.4 s | FAIL → fixed (finishedParts in context + server guard: openPart only for unfinished pieces) |
| L8 | «ليه الإيد أكبر من التانية؟» (project open) | ″ | 686beca5 | YES | Relevant crochet causes | project | stray openPart (now blocked by the guard) | 4.2 s | PASS (content) |
| L9 | «ممكن تشرحيلي الدور ده؟» | ″ | 5ca7ace0 | YES | Explains R31 correctly + mismatch | project | openCurrentRound | 7.0 s | PASS |
| L10 | «الفتحة دي كبيرة، أعمل إيه؟» | ″ | 482601b2 | YES | Smaller hook, tension, amigurumi advice | project | — | 26.2 s | PASS (slow) |
| L11 | «What does this increase mean?» | ″ | dc47a909 | YES | English; R31 has no inc, explains R30 «(sc, dec) x 6 [12]» | project (nearby R30) | — | 4.5 s | PASS |
| D | Pinned revision with an edited pattern | — | — | — | Tester account has no fixture; editing her real pattern was not done. Device shows the frozen piece snapshot (rev 3) reaching the model (SA). Edited-vs-pinned covered by automated tests with the real AppStore. | — | — | — | BLOCKED on device / FAKE TEST PASS |
| E | Switch between two projects | — | — | — | The tester has one project on this device; no projects were created in her account. General ↔ project mode switch showed no leak (no context, no action in general mode). | — | — | — | PARTIAL |
| KS | Kill switch with the allowlisted tester | — | — | — | 0 requests; «خيوطة غير متاحة حاليًا»; rules answer labelled — label said «بدون نت» → fixed | — | — | — | PASS |

Out-of-domain and image rows: see `model-domain-evaluation.md` and `real-vision-pattern-qa.md`.

## 4. Defects found on the real device and fixed (all with regression tests)

1. English questions answered in Arabic (UI language sent as `lang`) → question language detection.
2. Calculator sent a whole sentence as an "unsupported" fact → falls back to countable repeat groups.
3. «فتحتلك العداد» (claimed it acted) → prompt rule: say "tap the button".
4. Wrong piece opened for "the second arm" → `finishedParts` + server guard.
5. Off-topic refusals carried action cards; app name misspelt «جرزتك» → prompt v3 + server guard (`inScope:false` strips actions).
6. Chat opened on the oldest message → scrolls to the latest on enter.
7. Badge said «Offline» while only consent was missing → real-state status line.
8. Composer: Send clipped off-screen, chips overflowing, huge footer (user screenshot) → responsive composer/rail/status.
9. Extraction 504 at 45 s → 120 s extract timeout, 4000 output tokens.
10. Preview: colour notes became parts; wrapped instruction lines became parts; numbered-list rounds lost; source-photo refs lost → transcript-driven structure.
11. Parser vocabulary from a real sheet: «السطر», «تزايد/تناقص», full stop before the total, dual quantity «قطعتان».
12. Photo of chickens described as "the bunny's body" when a bunny project was open → prompt v4 grounding.
13. Rules reply labelled «رد بدون نت» while online → «رد من قواعد غرزتك — مش ذكاء اصطناعي».

## 5. Layout (user's screenshot) — real-device result

Root causes: the input was a `width:100%` flex item without `min-width:0` (pushed Send off-screen in RTL); the chip rail reused
`.gz-hs` negative margins outside a padded container; the full disclaimer sat under the composer. Now: one flexible auto-growing
field between two fixed 46 px buttons, a contained RTL-safe rail hidden while typing/attaching, a one-line real-state status
(details in the options sheet), a collapsible project card (remembered), short-viewport mode for landscape/keyboard.
Verified: browser at 320/360/800×360 (0 px horizontal overflow; Send/camera fully visible) and on the HONOR (screens
01/02/04/23 local). Keyboard: native resize, tab bar hides (Ionic), composer stays visible; landscape + keyboard remains tight.

## 6. Usage (no-charge allocation)

See `real-vision-pattern-qa.md` §6 for the final account-level Neuron read. Every request in this report used Workers AI's free
daily allocation; staging's own ledger stayed inside its 3,000-Neuron budget; no paid inference, no plan change.
