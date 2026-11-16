# Folder structure

```
Gharzetak/
├─ src/
│  ├─ app/
│  │  ├─ app.ts · app.config.ts · app.routes.ts      root shell, providers, lazy routes
│  │  ├─ core/
│  │  │  ├─ ai/assistant.service.ts                   demo rules + Edge Function boundary
│  │  │  ├─ auth/auth.service.ts · guards.ts          Supabase Auth, guest mode, route guards
│  │  │  ├─ data/catalog.ts · icons.ts · photos.ts    reference data from the prototype, icon set, photo slots
│  │  │  ├─ domain/                                   PURE: pattern-parser, terminology, tracker-engine (+ specs)
│  │  │  ├─ i18n/strings.ts · i18n.service.ts         Arabic (default, RTL) / English (LTR)
│  │  │  ├─ models/models.ts                          Project, Pattern, Profile, TrackerData, …
│  │  │  ├─ services/network · timer                  connectivity, work timer (timestamp based)
│  │  │  ├─ state/app.store.ts · factories · demo-data local-first signal store
│  │  │  ├─ storage/local-db.ts                       IndexedDB (idb) + outbox
│  │  │  ├─ supabase/supabase.client.ts · database.types.ts (generated)
│  │  │  ├─ sync/sync.service.ts · guest-import.service.ts
│  │  │  └─ utils/image.ts                            validate + resize uploads
│  │  ├─ layout/tabs-layout/                          Ionic tabs shell
│  │  ├─ shared/
│  │  │  ├─ project-view.ts                           shared project-card view model
│  │  │  └─ ui/ brand · dialogs (sheet, common sheets) · feedback · icon · images · inputs · progress
│  │  └─ features/  onboarding · auth · home · projects · tracker · patterns · learning ·
│  │                video-tutorials · ai-assistant · terminology · store · settings · design-system
│  ├─ theme/  tokens.css · tailwind.css · variables.scss · typography.scss · components.scss · ionic-overrides.scss
│  ├─ environments/environment.ts (+ env.generated.ts, git-ignored)
│  ├─ styles.scss · index.html · main.ts
├─ public/assets/  brand/ · photos/
├─ supabase/  config.toml · migrations/ · seed.sql · tests/rls.test.mjs
├─ android/ · ios/                                    Capacitor native projects
├─ scripts/set-env.mjs                               .env → env.generated.ts (refuses secret keys)
└─ docs/  architecture · design-handoff (+ source/) · implementation · testing
```

Every feature page is a standalone component loaded with `loadComponent`. Business rules live in
`core/domain` and `core/state`; pages only map state to the design's markup.
