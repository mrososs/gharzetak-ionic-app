# Crochet Joy — Cloudflare Readiness & Notification Architecture

> Status: **planning only**. Nothing was deployed, migrated, purchased or reconfigured while writing this document.
> All Cloudflare calls made during the audit were read-only (`GET` endpoints, one `SELECT` against `sqlite_master`/`d1_migrations`, and one GraphQL analytics query).

Legend used throughout: **[Verified]** = observed directly (live API, code, official docs fetched 2026-11-17) · **[Recommendation]** · **[Assumption]** · **[Unverified]**.

---

## 1. Live account findings (inspected 2026-11-17 via the Cloudflare API)

| Item | Finding | Source |
|---|---|---|
| Accounts | One standard account is reachable by the connected token. | [Verified] `GET /accounts` |
| Plan / billing | **Could not be read.** `GET /accounts/{id}/subscriptions`, `/user/subscriptions` and `/billing/profile` all returned **403 Authentication error** for this token. Whether the account is on Workers Free or Workers Paid is therefore **unknown**. | [Unverified] — check *Dashboard → Workers & Pages → Plans* |
| Workers | Exactly **one** script: `gharzetak-api-staging` (usage model `standard`, compat date `2026-11-01`, `nodejs_compat`). Single deployment, uploaded by Wrangler **2026-11-16 21:31 UTC**, 100% on one version. | [Verified] |
| Worker handlers | `fetch` only (the default export is the Hono app). **No `scheduled` handler, no queue consumer.** | [Verified] script listing |
| Cron Triggers | `GET …/scripts/gharzetak-api-staging/schedules` → `[]` (none). | [Verified] |
| Queues | `GET /accounts/{id}/queues` → `[]` (none). | [Verified] |
| KV namespaces | none | [Verified] |
| Zones / custom domains | no zones on the account; no Worker custom domains; served on the account's `workers.dev` subdomain (`workers_dev` enabled, previews enabled). | [Verified] |
| Production Worker | **Does not exist.** There is no `gharzetak-api` / production script, and `apps/api/wrangler.jsonc` has no `env.production` block. | [Verified] |
| D1 | One database: `gharzetak-db-staging` (region WEUR, read replication disabled, ~280 KB, 21 tables). | [Verified] |
| D1 applied migrations | `0000_init.sql`, `0001_profile_avatar.sql` (both applied 2026-11-16 21:30:55). **`0002_collections_revisions_time.sql` and `0003_pattern_source_text.sql` are NOT applied.** The live table list confirms it: no `pattern_collections`, `pattern_parts`, `pattern_revisions`. | [Verified] `d1_migrations`, `sqlite_master` |
| R2 | One bucket `gharzetak-media` (WEUR, Standard class). `r2.dev` managed domain **disabled**, no custom domains, no CORS policy, only the default "abort multipart after 7 days" lifecycle rule. Staging isolates its objects with `MEDIA_PREFIX=staging/`. | [Verified] |
| Worker bindings (staging) | `DB` (D1), `MEDIA` (R2), plain vars `APP_ORIGINS`, `AUTH_BASE_URL`, `ENVIRONMENT=staging`, `MEDIA_PREFIX`, `REQUIRE_EMAIL_VERIFICATION=false`; secrets `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ANDROID_CLIENT_ID` (names only — values are not readable and were not requested). | [Verified] |
| Observability | Workers Logs **enabled** (persisted, head sampling 1.0, invocation logs on); traces off; Logpush off; no tail consumers. | [Verified] |
| Usage (last 7 days) | Only 2026-11-16 has traffic: **271 requests, 0 errors, 1 subrequest; CPU p50 ≈ 10.4 ms, p99 ≈ 88.7 ms.** D1: 1,417 read queries / 2,704 rows read, 320 write queries / 1,009 rows written. | [Verified] GraphQL `workersInvocationsAdaptive`, `d1AnalyticsAdaptiveGroups` |

### 1.1 Gaps that exist before Crochet Joy (not caused by it)

1. **Staging is behind `development`.** The deployed staging Worker (2026-11-16 21:31 UTC) predates the pattern-collections commits (`60dabe6`, 2026-11-17 00:04 UTC) and its D1 lacks migrations 0002/0003. A build of current `development` pointed at staging will fail on `/v1/collections/*`, `/v1/revisions/*` and multi-part progress columns. **Any Crochet Joy device QA against staging needs staging to be redeployed + migrated first** (a separate, user-approved operation — not done here).
2. **Docs drift.** `docs/cloudflare-migration/staging-readiness.md` still says "PREPARED, NOT DEPLOYED" and lists only `0000_init.sql`; reality is "deployed, two of four migrations applied".
3. **CPU vs. Workers Free.** Workers Free allows **10 ms CPU per HTTP request** (official limits page, with some per-isolate flexibility). Observed p50 ≈ 10.4 ms / p99 ≈ 88.7 ms on staging (mostly auth/test traffic: Better Auth + PBKDF2 hashing, documented at ~12 ms per sign-in). If the account is on Free, password sign-in/sign-up is at risk of `Error 1102` under real load. This is the strongest existing argument for Workers Paid — **independent of Crochet Joy**.
4. **D1 write volume from per-tap progress sync.** `SyncService.schedule(400)` (`src/app/core/sync/sync.service.ts:81`) flushes the outbox ~400 ms after every queued change, so an active counting session produces roughly one `PUT /v1/projects/:id/progress` per tap burst. On Workers Free, D1 allows **100,000 rows written per day** (and since 2026-09-01 queries fail once the daily limit is hit). See §5 — this, not Crochet Joy, is what will hit Free-tier limits first.
5. **Sensitive data in staging logs.** `apps/api/src/services/mailer.ts:25` logs reset/verification links in non-production environments, and staging logs are persisted. Out of scope here; listed in `risks-and-decisions.md`.

---

## 2. Does Crochet Joy need Cloudflare at all?

| Capability | Needs Cloudflare? | Why |
|---|---|---|
| Round / milestone / part / project celebrations | **No** | Detected on-device from the tracker transition (see `architecture.md` §3). |
| Avatar reactions | **No** | Bundled assets in `public/`. |
| Achievement unlocks (MVP, single device) | **No** | Local ledger in IndexedDB. |
| Achievement unlocks across devices | *Optional* | One additive table + one PUT route + pull field (`0004_crochet_joy.sql`). Only if cross-device consistency is required (open question Q2). |
| Share-card PNG generation | **No** | Rendered on-device with Canvas 2D; shared via the OS share sheet. No upload. |
| Local reminders (Option A) | **No** | Scheduled by Android `AlarmManager` through `@capacitor/local-notifications`. Works offline and for guests. |
| Remote push (Option B) | **Yes** | Device-token table, scheduler (Cron Trigger or Queue), FCM/APNs credentials as secrets, retry/dedupe logic. |

**Conclusion [Recommendation]: the Crochet Joy MVP (P0–P5) requires zero Cloudflare changes.** No new Worker, binding, cron, queue, bucket, secret or migration. A backend is **not required for local notifications**.

---

## 3. Option A vs. Option B

### 3.1 Option A — Local notifications (`@capacitor/local-notifications`)

Facts [Verified — capacitorjs.com v8 docs and npm, 2026-11-17]:

- Latest `@capacitor/local-notifications` **8.3.1**, peer `@capacitor/core >=8.0.0` (project is on Capacitor 8.6.x). Official Ionic/Capacitor plugin, actively maintained.
- Android 13+ (`POST_NOTIFICATIONS`): `checkPermissions()` / `requestPermissions()`. **Since 8.3.0, `schedule()` itself requests permission if not granted** — so the app must gate `schedule()` behind its own explainer, otherwise the OS prompt appears at an arbitrary moment.
- Exact alarms: without `SCHEDULE_EXACT_ALARM` notifications are inexact. On Android 14+, `SCHEDULE_EXACT_ALARM` is **denied by default** for new installs targeting API 33+; `USE_EXACT_ALARM` is restricted by Play policy to alarm-clock/calendar apps. Since 8.3.0 the option `isExactNotification` defaults to **true** and opens the "Alarms & reminders" settings screen if not granted, then falls back to inexact with warning `OS-PLUG-LNOT-0017`.
  → **[Recommendation]** Do **not** declare `SCHEDULE_EXACT_ALARM`; pass `isExactNotification: false`. A crochet nudge arriving 5–30 minutes late is acceptable and avoids a second scary permission.
- `allowWhileIdle` fires in Doze but at most once per 9 minutes per app — irrelevant at ≤ 1 reminder/day.
- Scheduling primitives: `at`, `on` (cron-like: weekday/hour/minute), `every`, `count`, `repeats`. Weekly-day reminders map to one notification per selected weekday using `on: { weekday, hour, minute }`.
- Channels: `createChannel` with `importance` (0–5) and `visibility` (-1 secret / 0 private / 1 public). If the `channelId` doesn't exist the notification will not fire. Channel importance/sound cannot be changed after creation (Android 8+) — choose IDs carefully (`gz_reminders_v1`).
- Listeners: `localNotificationActionPerformed` (tap → deep link via `extra`), `localNotificationReceived` (foreground).
- `getPending`, `cancel`, `cancelAll` (8.3.0) — needed for "re-plan on every change".
- Reboot / app update survival: **not documented on the page [Unverified]**. Android clears `AlarmManager` alarms on reboot; the plugin is expected to restore them via a boot receiver, but this must be verified on a physical device (QA matrix N-07/N-08). Mitigation regardless: the app re-plans all reminders on every launch/resume (idempotent "replan").
- Force-stop: Android cancels all alarms of a force-stopped app until it is opened again. Unfixable for any local approach; document it.
- iOS: an Xcode project exists in `ios/` but iOS is not a shipping target today. The plugin supports iOS (64 pending notifications per app is an iOS system limit [Assumption — not stated on the page]); our plan stays well below that (≤ 7 weekly slots + ≤ 2 one-shots).

### 3.2 Option B — Remote push (FCM / APNs via Worker + D1)

What would be required:

1. `@capacitor/push-notifications` 8.1.3 + `google-services.json` + Firebase project (none exist in the repo today).
2. D1 table `device_push_tokens(user_id, device_id, token, platform, locale, tz, created_at, last_seen_at, revoked_at)` with unique `(device_id)`; register/unregister routes; revoke on logout and on account switch.
3. Scheduler: a `scheduled()` handler (Cron Trigger, e.g. every 15 min) selecting due users by **local** time (needs per-user IANA time zone + quiet hours stored server-side) and dedupe keys (`reminder_deliveries(user_id, slot_key)` unique).
4. FCM HTTP v1 requires an OAuth2 access token minted from a service-account JWT (RS256 signing in the Worker) → one more secret (`FCM_SERVICE_ACCOUNT`) and CPU per token refresh.
5. Retry/backoff on 429/5xx, pruning `UNREGISTERED` tokens.
6. Reminder personalization ("you're 2 rounds from finishing the bunny's ear") requires the **server** to compute progress from `project_progress.multi_state` — or ship generic copy only.
7. iOS: APNs key + Apple Developer Program membership.

Facts [Verified]: Firebase pricing page lists **Cloud Messaging (FCM) as "No-cost"** (Spark plan, and Blaze includes Spark no-cost usage); FCM HTTP v1 default quota is **600k messages/minute per project**. Workers Free: **5 Cron Triggers per account, 10 ms CPU per cron invocation, 50 subrequests per invocation** (each FCM send is a subrequest). Queues is available on Workers Free (10,000 operations/day, ≈3 ops per delivered message, 24 h retention).

### 3.3 Evidence-based comparison

| Area | Local notifications (A) | Remote push (B) |
|---|---|---|
| Complexity | Low–medium: 1 plugin, 1 `ReminderPlannerService`, channels, permission UX. ~0 backend. | High: plugin + Firebase project + token lifecycle + cron + time zones + dedupe + retries + secrets + server-side progress logic. |
| Free-tier feasibility | **100% free** — no server calls. | FCM free. Worker side fits Free only at small scale: 10 ms CPU/cron run and 50 subrequests/run cap a single cron at < 50 sends; JWT signing eats CPU. Realistically **Workers Paid ($5/mo)** from ~1k active reminder users. |
| Backend requirements | None. | New D1 tables, 2–3 routes, `scheduled()` handler, FCM secret, optional Queue. |
| Offline support | **Full** — schedules live on the device, fire with no network; guests supported. | Needs network at delivery; guests not reachable (no account). |
| Personalization | **Rich**: planner runs where the progress data is (IndexedDB) → can name the part/round. Re-planned on every relevant change. | Limited to what the server can compute; progress on the server lags until the next sync. |
| Scheduling accuracy | Inexact (≈ minutes, Doze-dependent). Fine for nudges. Lost after force-stop until next launch. | Depends on cron granularity (≥ 1 min) + FCM delivery; high-priority messages are rate-limited for non-urgent content. Also minutes. |
| Cross-device behavior | Each device schedules its own reminders (possible duplicates if a user has 2 phones). Prefs can be per device. | Single source of truth per account; can target the most recent device. |
| Privacy | **Best**: no notification content or schedule leaves the device. | Device tokens + schedule + time zone stored server-side; content passes through Google/Apple. |
| Reliability | Good on stock Android; OEM battery managers (Xiaomi, Huawei, Oppo, Samsung "deep sleep") may delay or drop alarms. Reboot restore must be verified. | Good when the device is online; also subject to OEM restrictions; token churn. |
| Cost | **$0** at any user count. | FCM $0; Cloudflare $0 at 100 users, likely $5/mo Workers Paid base from ~1k–10k reminder users; Apple Developer $99/yr if iOS. |

**Decision [Recommendation]: Option A (local notifications) for the initial release.** Every product requirement in the brief (opt-in, preferred time/days, frequency cap, quiet hours, inactive/almost-finished nudges, deep link to project → part → round, private lock-screen content, works when the app is closed) is satisfiable locally. Remote push is justified **only** for: (a) server-originated content (new tutorials, store news), (b) strict one-device-per-account delivery, or (c) re-engaging users who force-stopped/uninstalled — none are MVP requirements. P6 keeps Option B documented but out of scope.

---

## 4. Required backend changes

| Phase | Change | Required? |
|---|---|---|
| P0–P5 (MVP) | **None.** | — |
| P2b (optional, open question Q2) | Additive migration `apps/api/drizzle/0004_crochet_joy.sql`: `user_achievements(user_id TEXT, achievement_id TEXT, unlocked_at INTEGER, source TEXT, PRIMARY KEY(user_id, achievement_id))`; route `PUT /v1/achievements/:id` (idempotent insert-if-absent, 201/200); `achievements` array added to `GET /v1/sync/pull`. ≤ ~10 rows per user lifetime. Works on Workers Free. | Optional |
| P6 (not MVP) | Push tables, routes, cron/queue, FCM secret. | Not planned |

Prerequisite unrelated to Crochet Joy but blocking staging QA: redeploy `gharzetak-api-staging` from `development` and apply `0002`/`0003` to `gharzetak-db-staging` (user-approved operation).

---

## 5. Cost estimates

Prices [Verified, Cloudflare docs fetched 2026-11-17]:

| Product | Workers Free | Workers Paid |
|---|---|---|
| Workers requests | 100,000 / day | 10 M / month included, then $0.30 / M |
| Workers CPU | 10 ms / request | 30 M CPU-ms / month included, then $0.02 / M CPU-ms |
| Subscription | $0 | **$5 / month minimum** |
| D1 rows read | 5 M / day | 25 B / month included, then $0.001 / M |
| D1 rows written | **100,000 / day** (hard-fail since 2026-09-01) | 50 M / month included, then $1.00 / M |
| D1 storage | 5 GB total | 5 GB included, then $0.75 / GB-month |
| R2 (either plan) | 10 GB-month, 1 M Class A, 10 M Class B free per month | then $0.015 / GB-month, $4.50 / M Class A, $0.36 / M Class B; egress free |
| Cron Triggers | 5 per account | 250 per account |
| Queues | 10,000 ops / day | 1 M ops / month included, then $0.40 / M |
| FCM (Firebase) | No-cost | No-cost |

### 5.1 Crochet Joy's own incremental cost

| Users | MVP (local notifications, local celebrations, on-device share cards) | + optional achievement sync (P2b) | Remote push (P6, if ever) |
|---|---|---|---|
| 100 | **$0** (0 requests) | **$0** (< 1,000 lifetime writes) | $0 on Free (fits 1 cron) |
| 1,000 | **$0** | **$0** (≈ 10k lifetime writes, spread over months) | ~$0–5: cron fan-out approaches the 50-subrequest/10 ms Free caps → Workers Paid advisable |
| 10,000 | **$0** | **$0** (well within Paid included / Free daily caps) | **$5/mo** Workers Paid base (usage stays inside included quotas: ≈ 2 pushes/user/week ≈ 2,900 sends/day) |

### 5.2 Baseline app cost (context — the existing sync, not Crochet Joy)

[Assumption-heavy, for planning only] 30% of users active per day; an active day = one 30–45 min counting session ≈ 150 debounced progress PUTs; ≈ 3 D1 rows written per progress PUT (observed staging ratio 1,009 rows / 320 write queries ≈ 3.2); plus ~20 other requests.

| Users | DAU | Requests/day | D1 rows written/day | Fits Workers Free? |
|---|---|---|---|---|
| 100 | 30 | ≈ 5k | ≈ 14k | Yes (if CPU-per-request holds ≤ 10 ms) |
| 1,000 | 300 | ≈ 51k | **≈ 135k** | **No — exceeds 100k rows written/day** |
| 10,000 | 3,000 | ≈ 510k | ≈ 1.35 M | No (requests and writes). On Paid: ≈ 15 M req/mo → ≈ $1.50 over included, ≈ 40 M rows written/mo (inside 50 M) → **≈ $5–8 / month total** |

Two takeaways: (1) Crochet Joy must **never** add per-tap network writes — it doesn't (celebration ledger is local; only rare unlocks would sync). (2) Independently, consider coalescing progress pushes (e.g. 5–10 s debounce + flush on pause/background) before launch; this is out of scope for Crochet Joy and tracked in `risks-and-decisions.md` (R-19).

**Nothing in this plan enables Workers Paid or any paid service.** If/when Paid is chosen, it is for the baseline reasons above (CPU on auth, D1 writes), not for Crochet Joy.
