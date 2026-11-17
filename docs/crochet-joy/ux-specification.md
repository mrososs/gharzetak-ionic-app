# Crochet Joy — UX Specification

Reuses existing primitives only: `<gz-sheet>`, `.gz-btn` / `.gz-btn2` / `.gz-btn3` / `.gz-btn-text`, `.gz-note.*`, `.gz-card.*`, `.gz-badge`, `<gz-ring>`, `<gz-crochet-avatar>`, tokens from `src/theme/tokens.css`, fonts Playpen Sans / Playpen Sans Arabic. Arabic copy follows the app's existing voice: warm Egyptian Arabic, addressed in the feminine (as everywhere else in `src/app` — see open question Q1 in `risks-and-decisions.md`). Strings go through `I18nService.q(ar, en)` or `strings.ts`.

Global rules
- **Never block counting.** Levels 1–2 are non-modal and don't take focus; the tap target stays live underneath.
- One celebration on screen at a time; a higher level replaces a lower one.
- Respect `prefers-reduced-motion` (already globally enforced in `components.scss`) **and** the in-app `prefs.joy.motion`. Reduced = no movement, a 150 ms opacity fade only.
- Haptics only for Level ≥ 1 when `prefs.joy.haptics` and only on native: L1 `impact Light`, L2 `impact Medium`, L3/L4 `notification Success`. Never on undo/reset.
- Screen readers: banner text is announced through a single polite live region (`role="status"`); L3/L4 sheets use `<gz-sheet>`'s dialog semantics.
- All layouts use logical properties (`inline-start/end`), work at 320 px width, honour `--gz-safe-top/bottom` and `html.gz-immersive`.
- Numbers: Arabic UI uses Arabic-Indic digits only if the rest of the app does (it currently uses Western digits — keep consistent). Round ordinals 1–10 in Arabic use words (الأول … العاشر), then "الدور ١١" style falls back to "الدور 11".

---

## 1. Level 1 — Round mini-celebration (`<gz-joy-banner>`)

Trigger: `round` event, `prefs.joy.celebrate === 'every'`.
- Placement: floating pill above the tracker's tap ring, inside the content (not the Ionic toast, which anchors to the tab bar and is reserved for system messages). Max width `min(92vw, 420px)`, 56 px tall, `.gz-card soft` background, avatar 32 px at inline-start.
- Motion: avatar "hop" (translateY −6 px, 2 × 280 ms) + pill scale-in 0.92→1 (200 ms). Auto-dismiss 1.8 s; swipe/tap dismisses. No confetti at L1.
- Rate limit: ≤ 1 per 20 s; suppressed ones roll into the next: "٣ أدوار خلصوا ورا بعض! 🔥" / "3 rounds in a row! 🔥".
- Copy pool (rotate, never same line twice in a row; `{n}` = ordinal):

| Arabic | English |
|---|---|
| شطورة يا فنانة! خلصتي الدور {n}! 🧶 | Brilliant! Round {n} is done! 🧶 |
| غرزة ورا غرزة، تحفتك الصغيرة بتاخد شكلها 💗 | Stitch by stitch, your little masterpiece is taking shape 💗 |
| يا جمال إيدك! دور كمان وقربنا 🌸 | Lovely work! One more round and we're closer 🌸 |
| الدور {n} خلص — كمّلي على رواقة ✨ | Round {n} done — keep going at your own pace ✨ |
| برافو! إيدك بقت خفيفة 🧶 | Bravo! Your hands are flying 🧶 |

When `prefs.joy.messages === false`: banner shows only "✓ الدور {n}" / "✓ Round {n}".

## 2. Level 2 — Milestone card

Trigger: `milestone` (25/50/75 %, or every 10th round in open-ended counting). Shown even when `celebrate === 'milestones'`.
- Inline card that slides in under the ring (pushes content, no overlay), `.gz-card blush`, avatar 48 px with "wiggle" (±6°, 2 cycles), mini progress bar (`.gz-bar`) showing the new percent.
- Title: "نص الطريق! 🎉" / "Halfway there! 🎉" (25 %: "ربع الطريق خلص 🌱" / "A quarter done 🌱"; 75 %: "فاضل حبة صغيرين! 💪" / "Nearly there! 💪"; 10-round: "{x} دور! إنتي جامدة 🧶" / "{x} rounds! You're amazing 🧶").
- Body: part/pattern name + "{done} من {total} دور" / "{done} of {total} rounds".
- Actions (one row): `.gz-btn3` "شاركي التقدّم" / "Share progress" · `.gz-btn-text` "كمّلي" / "Keep going". Auto-collapse after 6 s if untouched.

## 3. Level 3 — Part completion (`PartDoneSheet` in `<gz-sheet>`)

Trigger: `part` event (multi-part). Uses the existing sheet (sticky one-row actions, Android Back closes it).
- Header art: avatar 96 px with "cheer" reaction (hop + 3 floating hearts overlay `overlay-hearts.svg`, 900 ms once) on the avatar's `AVATARS[id].tint` halo.
- Title: "خلصتي {part}! 🎊" / "{part} is finished! 🎊" (e.g. "الإيد التانية للأرنوبة").
- Facts row (chips): ⏱ time on this piece (`PartInstance.workedSeconds`), 🧩 "{doneCount} من {total} قطع" / "{doneCount} of {total} pieces".
- Actions: primary `.gz-btn` "القطعة الجاية" / "Next piece" (→ `nextUnfinished`, `setActiveInstance`); secondary `.gz-btn2` "شاركي" / "Share". Close (×) returns to the tracker on the finished piece.
- If this was the last piece (`allParts`): title "كل القطع خلصت! 🧸" / "All the pieces are done! 🧸", primary becomes "اعتبري المشروع مكتمل" / "Mark project as finished" (→ `origin:'finish'` → Level 4), secondary "لسه هجمّع" / "I'm still assembling" (dismiss).

## 4. Level 4 — Project finale (`ProjectFinale`, full-screen modal)

Trigger: `project` event (explicit finish). Replaces the two existing `ui.say('مبروك…')` toasts.
- Full-screen `ion-modal` (no breakpoints), background `--gz-surface` with a soft radial tint of the avatar colour; safe-area padded; Back = close.
- Content top→bottom: confetti burst of yarn-coloured dots (CSS, 24 particles, 1.4 s once, none in reduced motion) · project photo (`coverLocalUrl` or newest photo; else a "add a photo of your creation" dashed tile) · avatar 72 px "proud" (slow glow ring using existing `gzGlow`) · title "تحفة! خلصتي {project} 🏆" / "A masterpiece! You finished {project} 🏆" · stats: ⏱ recorded time (`Project.workedSeconds`, formatted like `compareTime` output), 🧩 pieces (multi-part), 🔁 rounds counted (ledger) · new badge(s) unlocked (if any) with name.
- Actions: primary `.gz-btn` "اعملي كارت مشاركة" / "Create a share card" → share preview; secondary `.gz-btn2` "ضيفي صورة" / "Add a photo" (only if no photo; reuses project photo picker) ; tertiary `.gz-btn-text` "تمام" / "Done".
- Timer: if running, stop it first (as `finishProject` does today).

## 5. Achievements collection (`/tabs/home/achievements`)

Entry: settings/profile header row "إنجازاتي" / "My achievements" (badge with count), and from L4 badge.
- Grid of 2 columns (3 ≥ 600 px) of `.gz-tile` cards: icon/emoji medallion, name, date unlocked; locked ones greyed with the hint text. "Earned earlier" tag for back-filled.
- Achievements copy:

| id | Arabic name / hint | English name / hint |
|---|---|---|
| first_round | أول دور 🧶 / خلّصي أول دور بالعدّاد | First round 🧶 / Finish your first round with the counter |
| rounds_10 | ١٠ أدوار 🌱 / عشرة أدوار بالعدّاد | 10 rounds 🌱 / Ten counted rounds |
| rounds_50 | ٥٠ دور 🌸 / خمسين دور بالعدّاد | 50 rounds 🌸 / Fifty counted rounds |
| first_project | أول مشروع ✨ / ابدئي أول مشروع | First project ✨ / Start your first project |
| first_multipart | مشروع بقطع 🧩 / ابدئي مشروع من مجموعة قطع | Multi-part maker 🧩 / Start a multi-part project |
| first_piece | أول قطعة 🧸 / خلّصي أول قطعة | First piece 🧸 / Finish your first piece |
| first_finished | أول تحفة 🏆 / خلّصي مشروع كامل | First masterpiece 🏆 / Finish a whole project |
| first_amigurumi | أميجورومي! 🐰 / خلّصي أول أميجورومي | Amigurumi! 🐰 / Finish your first amigurumi |

- Footnote (small): "الأدوار بتتحسب من وقت ما بدأتي تعدّي بغرزتك على الجهاز ده." / "Rounds count from when you started counting with Gharzetak on this device."
- Empty state: avatar + "إنجازاتك هتظهر هنا أول ما تبدئي تعدّي 💗" / "Your achievements will show up here once you start counting 💗" + `.gz-btn3` "ابدئي مشروع" / "Start a project".
- No leaderboards, no comparisons, no streak-loss messaging.

## 6. Share-card preview (`ShareCardSheet` in `<gz-sheet>`)

Open from L2/L3/L4/achievement/project detail ("شاركي التقدّم").
- Preview image (rendered PNG, `aspect-ratio: 4/5`, max-height 55 vh) with a skeleton (`.gz-sk`) while rendering (< 1 s target).
- Toggles (`.gz-chip` multi-select, remembered in `prefs.share`): Photo · Avatar · Time · Pieces · Project name. Defaults: photo on if available, avatar on, time on, pieces on, **name on** (user-typed, not sensitive) — pattern text, notes, email, account name are **never** options.
- Card layout (1080×1350): brand-tinted background; photo top 60 % with rounded corners (or large avatar if no photo); title line (progress: "{percent}% من {project}" / completion: "خلصت {project}! 🏆"); stats row; motivational quote line; footer "غرزتك · Gharzetak" small mark.
- Actions: primary `.gz-btn` "مشاركة" / "Share" (OS share sheet: WhatsApp, Instagram, Drive, …); secondary `.gz-btn2` "مشاركة نص بس" / "Share text only".
- Caption text (sent with the image when the target supports it): "خلصت {project} بغرزتك 🧶💗" / "Just finished {project} with Gharzetak 🧶💗".
- States: rendering error → `.gz-note rose` "معرفناش نجهز الصورة، جربي تاني أو شاركي نص" / "Couldn't prepare the image — try again or share text"; no share targets (`canShare` false) → only "Share text" + copy caption; user cancels the OS sheet → close silently (no error toast).

## 7. Reminders

### 7.1 Settings section "تذكيرات غرزتك" / "Crochet Reminders"

New `.gz-card` group in `settings.page.ts` placed after Language/Terms (and reachable from the home bell — replacing `NotificationsSheetBody`'s "coming soon").

```
تذكيرات غرزتك                               [ off | on ]  (gz-seg)
 └ when on:
   الوقت المفضّل            7:30 م   (native time input)
   الأيام                  [ح] [ن] [ث] [ر] [خ] [ج] [س]   (chips; default 2 picked)
   كام مرة                 مرتين في الأسبوع · ٣ مرات · كل يوم
   المشروع                 آخر مشروع شغالة فيه ▾  (or a specific unfinished project)
   تذكيرات لطيفة إضافية     ☐ لو المشروع وقف كام يوم  ☐ لو قربتي تخلصي  ☐ اقتراح صورة
   ساعات الهدوء            10:00 م → 8:00 ص
   إظهار اسم المشروع على شاشة القفل   [off]
   [ معاينة الإشعار ]  (.gz-btn3 — shows a local test notification in 5 s)
   إيقاف كل التذكيرات      (.gz-btn-text rose)
```

English labels: Crochet Reminders · Preferred time · Days · How often (Twice a week / 3 times a week / Every day) · Project (My latest project ▾) · Extra gentle nudges (If a project pauses for a few days / When you're close to finishing / Suggest a progress photo) · Quiet hours · Show project name on the lock screen · Preview notification · Turn off all reminders.

- Status line under the switch (`role="status"`): "هنفكرك الأحد والأربع الساعة ٧:٣٠ م 💗" / "We'll remind you Sun & Wed at 7:30 PM 💗"; or permission warnings (§7.3).
- Picking more days than the cadence allows auto-switches cadence to "custom" (cap = number of days).
- Time inside quiet hours → inline `.gz-note peach` "الوقت ده جوه ساعات الهدوء" / "That time is inside quiet hours".

### 7.2 Separate group "الاحتفالات" / "Celebrations"

- احتفالات بعد كل دور / Celebrate: `كل دور · المحطات المهمة بس · إيقاف` (Every round · Milestones only · Off)
- رسائل تشجيع / Encouraging messages: on/off
- اهتزاز خفيف / Haptic feedback: on/off (native only)
- حركة أقل / Reduce motion: on/off (defaults to OS)

### 7.3 Opt-in flow (soft ask → OS ask)

Never at launch, never during onboarding. Offer the soft ask (a `<gz-sheet>`) at most once per 30 days at a positive moment: after the first `part`/`project` celebration closes, or after the 3rd counting session, or when the user opens the bell/settings switch.
- Sheet: avatar "relaxed" + "تحبي نفكرك بوقت الكروشيه؟ 🧶" / "Want a gentle crochet reminder? 🧶" · body "مرتين في الأسبوع بس، في الوقت اللي تختاريه. تقدري تقفليها في أي وقت." / "Just twice a week, at a time you choose. Turn it off anytime." · primary "أيوه، فكّريني" / "Yes, remind me" · secondary `.gz-btn2` "مش دلوقتي" / "Not now".
- On "Yes": set defaults → `checkPermissions()`; if `prompt` → `requestPermissions()` (Android 13+ system dialog). Granted → schedule + toast "تمام! أول تذكير {day} {time}". Denied → keep `enabled=false`, show `.gz-note` "الإشعارات مقفولة من إعدادات الموبايل" / "Notifications are off in your phone settings" + `.gz-btn-text` "افتحي الإعدادات" / "Open settings" (native helper, see implementation plan P4).
- Permission revoked later: on resume, `checkPermissions()`; if denied while `enabled` → status line warns; nothing is scheduled.
- Exact alarms are **not** requested (no "Alarms & reminders" screen ever appears).

### 7.4 Notification copy (generic ↔ detailed)

Generic (default, safe on lock screen):

| Arabic | English |
|---|---|
| 🧶 غرزتك مستنياكي! نكمل الدور اللي وقفنا عنده؟ | 🧶 Your stitches are waiting! Shall we pick up where you left off? |
| 🌸 ربع ساعة كروشيه ممكن تعمل فرق جميل. | 🌸 Fifteen minutes of crochet can make a lovely difference. |
| 💗 مشروعك مستني لمستك الحلوة. | 💗 Your project is waiting for your lovely touch. |
| ☕ وقت هادي + خيط حلو = لحظة كروشيه؟ | ☕ Quiet moment + pretty yarn = crochet time? |

Detailed (only with "Show project name" on):

| Kind | Arabic | English |
|---|---|---|
| almostDone | 🐰 فاضلك شوية وتخلصي {part} لـ{project}! | 🐰 Just a little more and {part} of {project} is done! |
| inactive | 🧶 {project} وحشها شغلك — نكمل الدور {n}؟ | 🧶 {project} misses you — continue round {n}? |
| photo | 📸 {project} اتقدم حلو! تصوّريه؟ | 📸 {project} has grown — snap a progress photo? |

Tone rules: no guilt ("you haven't…", "don't lose your streak"), no countdowns, no ALL CAPS, max 1 emoji at start.

### 7.5 Tapping a notification

Opens Project → active part → current round (tracker). If the app is locked, the lock screen shows first; after unlock the tracker opens. If the project was deleted/finished/belongs to another account: home (or project detail for finished) with an informative toast; never an error page.

## 8. Error, empty, loading summary

| Surface | Loading | Empty | Error |
|---|---|---|---|
| Banner / card / sheets | none (instant, local) | n/a | silent fallback: no celebration, never a toast |
| Achievements | skeleton tiles (`.gz-sk`) | §5 empty state | "معرفناش نحمّل الإنجازات" + retry |
| Share card | skeleton preview | no photo → avatar layout | §6 |
| Reminders | n/a | switch off state shows benefit text | permission denied/revoked notes (§7.3); web build: section hidden ("available in the app") |

## 9. Crochet avatar reactions (`<gz-avatar-reaction [id] [mood]>`)

Wraps the existing `<gz-crochet-avatar>` (same 6 SVGs, unchanged) and adds motion + an optional shared overlay. **No new per-avatar artwork in the MVP.**

| mood | Used for | Motion (CSS transform/opacity only) | Overlay (shared SVG, same for all 6 avatars) |
|---|---|---|---|
| `happy` | L1 round | hop: translateY 0→−6→0, 2×280 ms | none |
| `celebrate` | L2 milestone, L3 part | wiggle ±6° ×2 + hop | `overlay-hearts.svg` (3 hearts float up 900 ms) |
| `proud` | L4 project, achievements | slow scale 1→1.04 + existing `gzGlow` halo, 1 cycle | `overlay-sparkles.svg` |
| `relaxed` | reminder soft-ask, break suggestions | gentle sway ±2°, 3 s, 2 cycles then stop | `overlay-tea.svg` (small cup at inline-end) |

- Overlays: `public/assets/joy/overlay-{hearts,sparkles,tea,confetti}.svg`, viewBox 160×160 (same as avatars so they stack 1:1), flat fills from the existing palette (`--gz-rose`, `--gz-lav`, `--gz-peach` hexes baked in), < 2 KB each after SVGO, `aria-hidden="true"`.
- Animations run **once** (no infinite loops on the tracker screen), only `transform`/`opacity` (compositor-only, no layout), paused when `document.hidden`. Reduced motion: static avatar + overlay faded in.
- Accessibility: reaction is decorative (`[decorative]=true`); meaning is carried by the banner/sheet text.
- **If** dedicated poses are approved later (P5+): extend `scripts/avatars/build-avatars.mjs` to emit `public/assets/avatars/reactions/{id}-{mood}.svg` (6 × 3 = 18 files: `cheer`, `proud`, `sleepy`), same 160 viewBox, ≤ 6 KB each, same face language (closed happy eyes, rosy cheeks) with pose changes only in arms/accessories. SVG, not raster — no WebP/PNG needed.

## 10. Small screens (Android 360×640 and 320 px)

- Banner single line with ellipsis; avatar 28 px under 360 px width.
- L3 sheet fits without scroll at 640 px height (art 72 px under 700 px height).
- Finale scrolls; actions in the existing sticky `.gz-dlg-actions` pattern so primary stays visible above the gesture bar (respects `html.gz-immersive` floor).
- Settings chips wrap; weekday chips use 1-letter labels (Arabic single letters as shown in §7.1) with full names in `aria-label`.
