# Play Console worksheet — Gharzetak 1.1.0 (follow it field by field; nothing was submitted)

Prepared 2026-11-20 from the integrated release candidate (branch `release/play-1`) and the verified data-flow inventory (`Gharzetak-showcase/docs/legal-launch/01`, `04`). **You** answer and submit every item. Google's own pages were read on 2026-11-20 (support.google.com/googleplay/android-developer answers 11926878, 14151465, 9842756, 13327111, 9866151, 9859455, 9859152); none shows a last-updated date, so re-read before submitting.

Assumption behind every answer below: the **public** release has **hosted Khayoota AI switched OFF** (`AI_ENABLED="false"` in the production Worker). Then no chat text, project context or photo is ever sent to an AI model. If AI is ever enabled for the public, the Data safety form and the policy must be updated first.

## A. App setup (Test and release > Setup / App content)

| Item | What to enter | Notes |
|---|---|---|
| App name | `غرزتك - Gharzetak` (≤ 30 characters) | |
| Default language | Arabic (العربية) + add English | |
| App or game | App | |
| Free or paid | Free | A paid app cannot become free later in some cases; confirm. |
| Developer contact e-mail (store listing) | `gharzetak.support@gmail.com` | Required; shown publicly. |
| Website (recommended) | the public legal-site URL once it exists | Do not enter a protected Vercel URL. |
| Application id / version | `com.gharzetak.app` · versionName `1.1.0` · versionCode `3` | Never changes after the first upload. |
| Target SDK | 36 (Android 16) · min 24 | Satisfies the "new apps must target API 36 from 2026-08-31" rule. |
| Play App Signing | accept the terms; **upload key** = the keystore you create (runbook section 3) | After the first upload copy the **app-signing SHA-1/SHA-256** into the Android OAuth client in Google Cloud, or Google sign-in will fail in the Play build. |

## B. App content declarations

| Declaration | Answer | Why |
|---|---|---|
| **Privacy policy URL** | the public `https://…/privacy/` page | Public, HTTPS, no login, not a PDF. **Blocked until the legal site is published** (needs the release-candidate fact and your approval, see release-gates). |
| **App access** | "All or some functionality is restricted" → give reviewers a **synthetic test account** (e-mail + password, created on the PRODUCTION backend after it exists) and say that Guest mode needs no login. Up to 5 sets. | Never use a real person's account; rotate/delete it after review. |
| **Ads** | No, the app contains no ads | No ad SDK (dex scan, merged manifest has no AD_ID). Re-check the release manifest after the build. |
| **Target audience and content** | Age groups **13–15, 16–17, 18 and over** (not 5–12) | Matches the policies' minimum age 13. Not designed for children: no Families program. |
| **Content rating (IARC questionnaire)** | Answer truthfully; expected category: utility/reference. No violence, no sexual content, no gambling, no user-to-user communication or sharing, no location. | Users cannot share content with other users (private). |
| **Data safety** | see section C | |
| **Government / News / Financial features / Health** | No to each | |
| **Advertising ID** | App does not use it | Declared in the form; the manifest must not request `AD_ID`. |
| **Permissions** | Merged release manifest (checked 2026-11-20): INTERNET, USE_BIOMETRIC, USE_FINGERPRINT, USE_CREDENTIALS (deprecated, pulled in by the biometric/sign-in plugins), POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED, VIBRATE, WAKE_LOCK, ACCESS_NETWORK_STATE and an internal DYNAMIC_RECEIVER permission. No high-risk or sensitive permission, so no declaration form. No AD_ID, no location, no exact alarms (removed on purpose). | Re-check on the signed build. |

## C. Data safety form (field by field)

**Data collection and security**

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** (accounts transmit data to our Cloudflare backend). Do not answer "no data collected". |
| Is all of the user data collected by your app encrypted in transit? | **Yes**: HTTPS only (the build refuses a non-HTTPS API URL). Do not claim end-to-end encryption: there is none. |
| Do you provide a way for users to request that their data be deleted? | **Yes**: in-app Settings > Privacy & account > Delete account, and the web page with the support-mailbox process. Enter the public `…/delete-account/` URL only after it is published and the e-mail channel is live. |

**Data types** (collected = leaves the device; *shared* = none: Cloudflare and Google act as service providers processing on our behalf, which Google's definition excludes from "sharing". Confirm that reading yourself, it is the one open classification question.)

| Play category > type | Collected | Shared | Ephemeral | Required / optional | Purposes |
|---|---|---|---|---|---|
| Personal info > **Email address** | Yes (accounts only) | No | No | Optional (Guest mode needs none) | Account management; App functionality |
| Personal info > **Name** (display name) | Yes (accounts only) | No | No | Optional | Account management; Personalization |
| Personal info > **User IDs** | Yes | No | No | Optional | Account management; App functionality |
| Photos and videos > **Photos** (project photos and covers when signed in) | Yes | No | No | Optional | App functionality |
| Files and docs > **Files and docs** (pattern PDFs/images) | Yes | No | No | Optional | App functionality |
| App activity > **Other user-generated content** (patterns, original text, notes, project and collection names, progress) | Yes | No | No | Optional | App functionality |
| App info and performance > **Diagnostics** (sign-in sessions with IP/user agent; rate-limit counters keyed by IP; Cloudflare request logs up to 7 days) | Yes | No | No | Required for accounts | Security, fraud prevention, and compliance |
| Location, Contacts, Calendar, Audio, Health, Financial, Web browsing, Messages, Device or other IDs, Biometric | **No** | | | | Biometric unlock is done by the OS (pass/fail only); the app never receives biometric data. |

Open classification points for you (Google gives no IP-address category): put the session/IP data under *Diagnostics* as above, or under *Device or other IDs* if Google's help text for your console says so. Either is defensible; do not leave it out.

**Third-party processing to keep in mind (not "sharing")**: Cloudflare (Workers, D1, R2) stores/processes account and sync data; Google Sign-In (optional, native) authenticates the user. Hosted AI (Cloudflare Workers AI) is OFF in the public release.

**Retention and deletion statements to stay consistent with:** account data until the user deletes it (no automatic expiry); deletion removes the account, rows and stored files; provider recovery history up to 30 days (7 on the free plan) and request logs up to 7 days; a 35-day deletion record (random id + date). Same text as the public pages.

## D. Store listing (drafts for you to edit; limits from Google: name 30, short 80, full 4,000 characters)

**Short description (AR):** عدّاد غرز وأدوار، باترونات ومشاريع كروشيه في مكان واحد.
**Short description (EN):** Crochet round counter, patterns and project tracker in one place.

**Full description (AR):**
غرزتك رفيقتك في الكروشيه، من أول غرزة لآخر لمسة. تابعي مشاريعك وعدّي الغرز والأدوار بسهولة، واحفظي الباترونات والمجموعات، وكمّلي من حيث وقفتِ.
• عدّاد غرز وأدوار يتذكّر مكانك ويشتغل من غير إنترنت.
• مشاريع متعددة القطع، وملاحظات وصور وتقدّم لكل مشروع.
• باترونات ومجموعات: اكتبي أو الصقي الباترون وسيحوّله التطبيق لخطوات قابلة للعدّ، مع محوّل بين المصطلحات الأمريكية والبريطانية.
• تعلّم: روابط شروحات وتتبّع ما شاهدتيه.
• تذكيرات لطيفة اختيارية على موبايلك.
• وضع الضيفة: كل شيء على جهازك فقط. أو أنشئي حسابًا لحفظ مشاريعك على السحابة والمتابعة من أي جهاز.
• عربي وإنجليزي.
حسابك وبياناتك تحت سيطرتك: يمكنك حذف حسابك من الإعدادات في أي وقت. سياسة الخصوصية والشروط من داخل التطبيق.

**Full description (EN):**
Gharzetak is your crochet companion, from the first stitch to the last touch. Track your projects, count stitches and rounds, keep your patterns and collections, and pick up exactly where you stopped.
• A stitch and round counter that remembers your place and works offline.
• Multi-piece projects with notes, photos and progress.
• Patterns and collections: type or paste a pattern and the app turns it into steps you can count, with a US/UK terminology converter.
• Learn: tutorial links and what you have watched.
• Optional gentle reminders on your phone.
• Guest mode keeps everything on your device; or create an account to save projects in the cloud and continue on any device.
• Arabic and English.
You stay in control of your data: delete your account from Settings at any time. The privacy policy and terms are linked inside the app.

(The descriptions make **no AI claim** because hosted AI is off in the public release; Khayoota's built-in rule answers are not advertised as AI.)

**Graphics:** `docs/play-release/store-assets/icon-512.png` (512×512 PNG, full-bleed brand mark; Play applies its own mask) · `feature-graphic-1024x500.jpg` (1024×500 JPEG, a clean **draft** from the brand mark, replace if you prefer) · **phone screenshots: 2 to 8 required**, PNG/JPEG, 9:16, each side 320–3,840 px, at least four at 1080×1920 or larger recommended. Take them from the release build; do **not** use the marketing images that show the AI assistant or photo recognition (not public). Alt text ≤ 140 characters per image.

## E. What only you can do in Play Console

1. Create the app (name, language, free, accept policies and Play App Signing terms).
2. Provide the **upload key** (create it once, keep it offline and backed up) and upload the **signed** AAB to an **internal** testing track first.
3. Fill App content (section B) and the Data safety form (section C) yourself; paste the final privacy and deletion URLs.
4. **Closed testing (required for a new personal account):** a closed test with **at least 12 testers opted in continuously for 14 days**; then Dashboard > **Apply for production** (3-part questionnaire; Google says review "usually takes seven days or less"; it may ask for more testing). Production stays disabled until then.
5. After the first upload: copy Play's app-signing SHA-1/SHA-256 into the Android OAuth client (Google Cloud) and re-test Google sign-in on the Play build.
6. Provide reviewer test credentials in App access (synthetic account on production).
7. Complete store listing, content rating questionnaire, target audience; submit for review **when you decide**.
