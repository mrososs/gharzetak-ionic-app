# غرزتك · Gharzetak

Crochet companion app — learn, track stitches, read patterns, organise projects.
Ionic 9 + Angular 22 (standalone, signals, zoneless) + Tailwind CSS v4 + Capacitor 8, backed by a
**Cloudflare Worker (Hono) + D1 (Drizzle) + private R2 + Better Auth** API in `apps/api`.
Arabic (RTL, default) and English (LTR). Built from the approved Claude Design artifact
(see `docs/design-handoff/`).

## Requirements (Windows)

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 24.15 (or 22.22.3+) | Angular 22 requirement. This machine uses a portable Node at `D:\mostqel\.tools\node24`. |
| Android Studio | with SDK 36 | its bundled JDK 21 (`jbr`) builds the Android project; JDK 25 is too new for Gradle 8.14 |

No Docker is needed: the local backend runs on Wrangler's simulated D1/R2.

## Run locally (PowerShell)

```powershell
cd D:\mostqel\Gharzetak
$env:PATH = "D:\mostqel\.tools\node24;" + $env:PATH   # only if the system Node is older than 24.15
npm ci
npm run api:install
Copy-Item apps\api\.dev.vars.example apps\api\.dev.vars     # put a random BETTER_AUTH_SECRET in it
npm run api:db:migrate:local; npm run api:db:seed:local     # local D1 schema + sample patterns
Copy-Item .env.example .env                                  # set GZ_API_URL=http://localhost:8787
npm run api:dev      # terminal 1: Worker on :8787 (local D1 + R2, nothing remote)
npm start            # terminal 2: http://localhost:4200
```

Without `GZ_API_URL` the app still runs in **guest-only mode** (everything stays on the device).

## Environment variables (`.env`, git-ignored, PUBLIC values only)

| Variable | Meaning |
|---|---|
| `GZ_API_URL` | Worker API base URL (`http://localhost:8787` locally; **https** otherwise — `set-env.mjs` refuses plain http for remote hosts) |
| `GZ_AUTH_REDIRECT_URL` | where email links return (empty = current origin; native: `com.gharzetak.app://`) |
| `GZ_GOOGLE_WEB_CLIENT_ID` | public Google OAuth **Web** client id (audience of the native Google ID token). Empty = Google sign-in off. The matching client **secret** lives only in the Worker (`apps/api/.dev.vars` / `wrangler secret put GOOGLE_CLIENT_SECRET`) |
| `GZ_GOOGLE_IOS_CLIENT_ID` | optional public iOS client id (iOS Google sign-in stays off while empty) |
| `GZ_AI_ENDPOINT` | API path of the assistant (empty = clearly-labelled demo mode) |

Worker secrets (`BETTER_AUTH_SECRET`) live in `apps/api/.dev.vars` (local) or `wrangler secret put` (deployed) — never in `.env`.

## Tests

```powershell
npm test               # Angular unit tests (Vitest): tracker engine, pattern parser, US/UK converter
npm run api:test       # Worker tests in the Workers runtime (auth, sync, ownership, R2)
npm run api:smoke      # HTTP smoke test against a running `npm run api:dev`
npm run e2e:sync       # real Angular sync services against the running local Worker
npm run typecheck
npm run build          # production build → www/browser
```

## Android

```powershell
.\scripts\android-debug.ps1          # build → cap sync → gradlew assembleDebug
npx cap open android                 # open in Android Studio (run on device/emulator)
```
The APK is `android\app\build\outputs\apk\debug\app-debug.apk`. A device cannot reach `localhost` on your PC: use `http://10.0.2.2:8787`
in the emulator, or a deployed API over https. iOS: `ios/` is generated; building needs macOS + Xcode (`npx cap open ios`).

## Backend

Design, schema mapping, auth/storage/sync strategy, test results and the (approval-gated) cutover/rollback plan:
`docs/cloudflare-migration/`. The previous Supabase backend is archived in `docs/cloudflare-migration/legacy-supabase/`.

## Docs

- `docs/cloudflare-migration/` (start at `README.md`)
- `docs/architecture/overview.md`, `folder-structure.md` (pre-migration: Supabase references are historical)
- `docs/design-handoff/screen-map.md`, `design-tokens.md`, `asset-manifest.md`, `design-source-audit.md`, `source/`
- `docs/implementation/progress.md`, `supabase-setup.md` (superseded)
- `docs/testing/test-report.md`, `visual-qa.md`
