# غرزتك · Gharzetak

Crochet companion app — learn, track stitches, read patterns, organise projects.
Ionic 9 + Angular 22 (standalone, signals, zoneless) + Tailwind CSS v4 + Capacitor 8 + Supabase.
Arabic (RTL, default) and English (LTR). Built from the approved Claude Design artifact
(see `docs/design-handoff/`).

## Requirements (Windows)

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 24.15 (or 22.22.3+) | Angular 22 requirement. This machine uses a portable Node at `D:\mostqel\.tools\node24`. |
| Docker Desktop | running | only for the local Supabase stack |
| Android Studio | with SDK 36 | its bundled JDK 21 (`jbr`) builds the Android project; JDK 25 is too new for Gradle 8.14 |

## Run the web app (PowerShell)

```powershell
cd D:\mostqel\Gharzetak
$env:PATH = "D:\mostqel\.tools\node24;" + $env:PATH   # only if the system Node is older than 24.15
npm ci
npx supabase start            # local backend on :55421 (first run pulls Docker images)
Copy-Item .env.example .env   # then fill GZ_SUPABASE_URL / GZ_SUPABASE_PUBLISHABLE_KEY from `npx supabase status -o env`
npm start                     # http://localhost:4200
```

Without `.env` the app still runs in **guest-only mode** (everything stays on the device).

## Environment variables (`.env`, git-ignored)

| Variable | Meaning |
|---|---|
| `GZ_SUPABASE_URL` | Supabase project URL (dedicated Gharzetak project) |
| `GZ_SUPABASE_PUBLISHABLE_KEY` | publishable / anon key. Secret or service-role keys are **refused** by `scripts/set-env.mjs` |
| `GZ_AUTH_REDIRECT_URL` | where auth emails return (empty = current origin; Android: `com.gharzetak.app://auth/callback`) |
| `GZ_OAUTH_PROVIDERS` | `google,apple` once configured in Supabase; empty hides them behind a "not enabled" message |
| `GZ_AI_FUNCTION` | Edge Function name for the assistant; empty = clearly-labelled demo mode |

## Tests

```powershell
npm test            # unit tests (Vitest): tracker engine, pattern parser, US/UK converter
npm run test:rls    # RLS / storage / last-write-wins integration tests against the LOCAL Supabase
npm run typecheck
npm run build       # production build → www/browser
```

## Android

```powershell
.\scripts\android-debug.ps1          # build → cap sync → gradlew assembleDebug
npx cap open android                 # open in Android Studio (run on device/emulator)
```
The APK is `android\app\build\outputs\apk\debug\app-debug.apk`. A device cannot reach `127.0.0.1`
on your PC — for device testing point `.env` at a hosted Supabase project (or your PC's LAN IP over HTTPS).
iOS: `ios/` is generated; building needs macOS + Xcode (`npx cap open ios`).

## Supabase

Migrations in `supabase/migrations` are the single source of truth. Setup, hosted project and provider
configuration: `docs/implementation/supabase-setup.md`.

## Docs

- `docs/architecture/overview.md`, `folder-structure.md`
- `docs/design-handoff/screen-map.md`, `design-tokens.md`, `asset-manifest.md`, `design-source-audit.md`, `source/`
- `docs/implementation/progress.md`, `supabase-setup.md`
- `docs/testing/test-report.md`, `visual-qa.md`
