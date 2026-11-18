# Khayoota AI — Product, UX & Branding

> Specification only; no screen was built or changed. Every component named below already exists in the app unless marked **new**. Arabic copy follows the app's existing voice (Egyptian colloquial, feminine address — `src/app/core/i18n/strings.ts`).

---

## 1. Name

| Candidate | Reading | For | Against |
|---|---|---|---|
| **Khayoota — خيوطة** | from خيط / خيوط (thread, yarn) with an affectionate feminine ending | Says "yarn" instantly in Arabic; soft and friendly without being babyish; distinct from the app name so it reads as a *character inside* Gharzetak; simple Latin spelling | "Kh" is unfamiliar to English-only speakers (acceptable: the audience is Arabic-first) |
| Gharzoona — غرزونة | from غرزة (stitch), echoing غرزتك | Strong family resemblance to the app brand | So close to "Gharzetak" that the assistant and the app blur; "Gh" + "z" is the hardest of the three in Latin script |
| Fatoola — فتّولة | from فتلة (a strand) | Cute | Least transparent meaning; depends on the shadda to read correctly; easiest to mishear |

**Recommendation: Khayoota (خيوطة).** Before it is locked: an app-store and trademark name search, and a quick check with a few users from other Arabic dialects that the word carries no unwanted meaning **[Unverified — not checked]**.

How it appears:

- Tab label: **خيوطة / Khayoota** (today: "المساعد الذكي / AI Assistant", `tabs.config.ts:18` — two specs assert the label and need updating).
- Screen subtitle: **مساعدة الكروشيه بالذكاء الاصطناعي / Your AI crochet companion.** The words "AI / ذكاء اصطناعي" stay visible on the screen and in the consent sheet.
- **Honest branding:** Khayoota is "the AI companion in Gharzetak". Never "our own AI model", never "trained by Gharzetak", never a human title (teacher, instructor, expert). The About screen names the kind of technology ("a general AI model, guided by Gharzetak's crochet rules and your pattern").
- Face: reuse the existing **yarn-ball avatar** (`gz-crochet-avatar id="yarn"`) with the sparkles badge for the first release — no new art. A dedicated Khayoota character is optional design work (note: `yarn` is also a user-selectable avatar; a distinct mark avoids that overlap later).

---

## 2. Personality

| Trait | In practice |
|---|---|
| Warm | Greets by name once; speaks like a friend who crochets. |
| Cute, not childish | One emoji at most per message; no baby talk; no exclamation chains. |
| Encouraging | Names what is going well *only when there is something specific*. No "amazing!" on every reply. |
| Practical | Leads with the answer or the next step. Numbered steps only when order matters. |
| Patient with beginners | Explains an abbreviation the first time it appears in a conversation, then uses it. |
| Technically accurate | Abbreviations exactly as written (`sc`, `hdc`, `inc`); numbers from the app's calculator. |
| Honest about uncertainty | "من الصورة مش هقدر أعدّ الغرز بالظبط" rather than a confident guess. |

Avoid: repeated catchphrases, pretending to remember past sessions beyond the visible history, pretending to see what was not sent, claiming to have saved or changed anything, medical/legal/other off-topic help.

**Greeting (first open, signed in, consented):**

> أهلًا! أنا خيوطة 🧶 صاحبتك في كل غرزة. ورّيني شغلك أو اسأليني عن الباترون، ونحلها سوا.
>
> Hi! I'm Khayoota 🧶 your companion for every stitch. Show me your work or ask me about your pattern, and we'll figure it out together.

**Out of scope:**

> ده بره شغلي يا جميلة — أنا متخصصة في الكروشيه وغرزتك بس. تحبي أساعدك في الباترون اللي شغالة عليه؟
>
> That's outside what I do — I only help with crochet and Gharzetak. Want a hand with the pattern you're working on?

---

## 3. Screen specifications

Design system reused everywhere: Playpen Sans Arabic / Playpen Sans (`--gz-font`, `--gz-font-latin`), existing colour tokens (`--gz-primary`, lavender / blush / sage / peach tones), `.gz-card`, `.gz-note`, `.gz-chip`, `.gz-badge`, `.gz-btn / .gz-btn2 / .gz-btn3`, `.gz-msg`, `gz-sheet`, `UiFeedback`, `gz-photo`, avatars. RTL for Arabic, LTR for English (driven by `I18nService`); stitch code stays LTR via `.gz-code`. Safe areas via `--gz-safe-top` / `--gz-safe-bottom` / `--gz-tab-float`; nothing new is drawn under the Android gesture area; immersive mode is untouched. **No unrelated screen is redesigned.**

### 3.1 Khayoota main chat (`/tabs/assistant` — existing page, extended)

```
┌──────────────────────────────────────────────┐
│ (yarn avatar) خيوطة            [⋯]           │  header: title + subtitle; ⋯ = Clear chat · Privacy · Limits
│               مساعدة الكروشيه بالذكاء الاصطناعي │
│ ┌──────────────────────────────────────────┐ │
│ │ [photo] بتتكلمي عن: أرنوبة بفستان          │ │  context card (existing) — now from trackerView:
│ │         الايد 2/2 · R7 · 9sc [9]   [تغيير] │ │  piece + round of the PINNED revision; "Change" picks project/none
│ └──────────────────────────────────────────┘ │
├──────────────────────────────────────────────┤
│                              (user bubble)   │  .gz-msg.u
│ (assistant bubble)                           │  .gz-msg.a  — plain text
│   [card: stitch / count check / preview]     │  .gz-card
│   [ افتحي الدور ]  [ اشرحي الغرزة ]            │  action buttons (≤ 2), gz-btn2 / gz-btn3
│   R7 · الايد                                 │  citation chip
├──────────────────────────────────────────────┤
│ chips: اشرحيلي الدور · عدد الغرز كام؟ · صوّري شغلك │  suggestion chips, context-aware
│ [📷] [ اكتبي سؤالك…                    ] [➤] │  existing composer
│ خيوطة ممكن تغلط — راجعي على الباترون · 17/20   │  disclaimer + remaining today
└──────────────────────────────────────────────┘
```

- Without a project: the context card reads "من غير مشروع — أسئلة عامة" and no project data is sent.
- The "demo" badge and the per-message "demo reply" label remain for the offline helper, renamed **"رد بدون نت / Offline helper"**.
- Messages keep `aria-live="polite"` (already present). Buttons ≥ 44 px.

### 3.2 "Ask Khayoota" in Project Details (**new entry point**)

A `gz-btn3` with the sparkles icon in the project header actions: **اسألي خيوطة / Ask Khayoota**. Opens `/tabs/assistant?project=<id>` (the page gains optional route inputs; `withComponentInputBinding` is already enabled). The context card shows that project and its active piece. For multi-piece projects, a first chip offers **"إيه اللي فاضل؟ / What's left?"** (Flow D).

### 3.3 "Ask Khayoota" in the Tracker (**new entry point**)

A small sparkles icon button (`gz-icb flat`) in the tracker's top bar, next to the existing controls — never over the counter button. It opens Khayoota with the tracker's project + piece and three intent chips pre-shown: **اشرحيلي الدور ده · المفروض أوصل لكام غرزة؟ · صوّري شغلك**. The timer is unaffected (it is durable). Returning is one tap on the Tracker tab; every Khayoota reply about a round carries **"ارجعي للعدّاد / Back to the counter"**.

A bottom-sheet version (chat over the tracker) is a later refinement, not the first release.

### 3.4 Image attachment and camera flow

1. Tap 📷 → the existing file input (on Android: Camera / Gallery / Files).
2. Sheet **"هتعملي إيه بالصورة؟"** (`gz-sheet`) with two large choices: **شوفي شغلي** (troubleshoot my work) · **اقري باترون** (read a pattern). A third, when a project is open: **اختاري من صور المشروع** (existing project photos).
3. Preview with **Retake** and **Use** — plus one tip line per choice ("نور كويس وخلفية سادة" / "صفحة واحدة في الصورة، والكلام واضح").
4. Images are resized on the device (photo 1280 px; pattern 1568 px) and shown as a thumbnail in the bubble. Up to 2 photos per question, up to 4 pages per pattern.

A native camera plugin (`@capacitor/camera`) is **not** needed for the first release; consider it only if device QA shows the WebView picker is awkward.

### 3.5 Photo troubleshooting reply (Flow B)

One assistant bubble with a short sentence, followed by one `.gz-card` with three labelled blocks — the structure *is* the honesty:

| Block | Style | Example |
|---|---|---|
| **اللي شايفاه / What I can see** | `.gz-note.sage` | "الإيد التانية أعرض من الأولى عند آخر كام دور." |
| **ممكن يكون السبب / Possible causes** | `.gz-note.lav` | "زيادات زيادة في دور، أو شدّ الخيط أخف، أو إبرة مختلفة." |
| **اللي مقدرش أأكده من الصورة / What I can't confirm from the photo** | `.gz-note` (neutral) | "عدد الغرز بالظبط — لازم تعدّيها." |

Then **جربي كده / Try this** (1–3 safe steps: "عدّي غرز آخر دور — المفروض 9") and one action: **افتحي الدور R7**. No stitch count is ever stated from the image.

### 3.6 Extract Pattern preview

Chat line (numbers filled by the app from the deterministic converter):

> لقيت باترون فيه **12** دور، وفيه **دورين** محتاجين مراجعة. تحبي أجهزهولك في غرزتك؟

Card `card.patternPreview`: title · pieces with quantities · badges **✓ 9 مراجعة تمام** (`gz-badge sage`) · **⚠ 2 محتاج مراجعة** (`peach`) · **✕ 1 مش مدعوم** (`rose`) · source thumbnail. Buttons: **جهّزيه / Prepare it** · **إلغاء**.

"Prepare it" opens the **existing Smart Import review screen**, seeded, with these additions:

- Banner: **"خيوطة قرته من صورتك — راجعيه على الأصل."**
- An "مش متأكدة" marker on lines the model flagged, listing the fragments.
- Tap a round → the source photo (pinch-zoom).
- Buttons: **تعديل** (inline, existing) · **أضيفي للباترونات** (existing Confirm) · **إلغاء**.

For a finished-object photo the card instead says: **"دي صورة شغل جاهز، مش باترون مكتوب. أقدر أوصفلك شكله، أو أقترح طريقة تقريبية — بس مش هتبقى الباترون الأصلي."** with **وصف الشكل** / **اقتراح تقريبي**; any guess carries a permanent **"تخمين خيوطة"** label.

### 3.7 Add Pattern draft confirmation

The real Add Pattern (or Collection) editor opens with the fields filled and the form dirty — exactly as after today's Smart Paste. A one-time toast: **"الباترون جاهز للمراجعة — مش هيتحفظ غير لما تدوسي حفظ."** Save is the editor's own button; leaving triggers the existing unsaved-changes guard. Khayoota never says "I saved it".

### 3.8 Edit Pattern proposal (Flow E)

A proposal card at the top of the existing edit screen:

```
اقتراح من خيوطة — R4
الحالي:   (2sc, inc) x 6 [26]
المقترح:  (2sc, inc) x 6 [24]          ← .gz-code, LTR
ليه: المكتوب 26 والحساب 24.            ← the numbers come from the parser
[ طبّقي في المحرر ]   [ تجاهلي ]
```

"Apply" only fills the form. Saving goes through the existing confirmation for structural changes and creates a revision; projects following the pattern are pinned and later offered "Review the update". If the proposal was computed against an older revision: **"الباترون اتغيّر من ساعة الاقتراح ده"** and Apply is disabled.

### 3.9 Stitch explanation card (Flow C)

`.gz-card` from the existing glossary entry (`TERMS`): Arabic name · abbreviation in the user's term system (and the other system in small text) · two-line how-to · example. Button **شوفي الشرح بالفيديو** when a matching tutorial topic exists (`/tabs/learn/:id`, id validated) — otherwise **افتحي القاموس** (`/tabs/home/terms`).

### 3.10 Validation warning card (stitch-count discrepancy)

`.gz-card` + `.gz-note.err`: "R3 — المكتوب [20] والمحسوب 18. محدش غيّر حاجة — راجعي السطر." Numbers recomputed on the device. Actions: **افتحي الدور** · **اقترحي تصحيح** (only when the pattern is the user's own, not a sample).

### 3.11 Loading

- Chat/photo: the existing typing bubble, text **"خيوطة بتفكّر…"**; after 6 s add "لسه معاكي…"; a **إيقاف / Stop** text button appears at 3 s.
- Extraction: a progress card with honest stages — "بقرأ الصورة" → "براجع الحساب" (the second stage is the on-device converter) — and Stop.
- No fake token-by-token animation while replies are not streamed.

### 3.12 AI unavailable / offline

| Situation | Copy | What still works |
|---|---|---|
| No network | "مفيش نت دلوقتي. أقدر أشرحلك الدور اللي إنتي فيه من غير نت." | Offline helper (`explainCurrent`, `demoReply`), labelled |
| Guest | "خيوطة محتاجة حساب علشان تحمي خصوصيتك وتمنع سوء الاستخدام. سجّلي دخولك، ولسه تقدري تستخدمي شرح الأدوار من غير حساب." + **تسجيل الدخول** | Offline helper |
| Service off / busy / timeout | "خيوطة مش متاحة دلوقتي. جربي كمان شوية." + **حاولي تاني** | Offline helper |
| Not configured (builds without an API URL) | the existing "demo" presentation | Offline helper |

### 3.13 Privacy and consent

First-use `gz-sheet` with the text in `security-privacy-cost.md` §4, three plain bullets (what is sent · photos are not stored · Khayoota can be wrong), **موافقة ومتابعة** / **مش دلوقتي**. In the ⋯ menu and in Settings: "Khayoota AI" on/off, **مسح المحادثة**, policy link. A lock line under the composer the first three times a photo is attached: "الصورة بتتبعت للتحليل ومش بتتخزن."

### 3.14 Free usage limit reached

> خلّصنا أسئلة النهارده 🌙 خيوطة هترجع بكرة الساعة {time}. لسه تقدري تستخدمي شرح الأدوار والعدّاد عادي.

- The remaining count sits under the composer from the start ("17/20"), so the limit is never a surprise.
- Separate copy when the *service-wide* budget is reached: "خيوطة واخدة راحة لحد بكرة — الضغط كان كبير النهارده." (no blame on the user).
- No upsell in this release.

### 3.15 Tool action failure

| Failure | Behaviour |
|---|---|
| Target no longer exists | Button replaced by "ده مبقاش متاح." (`.gz-note`) |
| Navigation failed / project is finished | `UiFeedback.toast("معرفتش أفتحه — جربي من صفحة المشروع.")`; button stays |
| Draft expired (app restarted) | "المسودة راحت — ابعتي الصورة تاني." + **ابعتي تاني** |
| Converter found no rounds | Review screen opens on the "original" view with the parser's own message; nothing is created |
| Reply failed validation | Text-only reply, no buttons; if nothing usable: "معرفتش أجاوب المرة دي — جربي تاني." (not counted as the user's fault; see quota note in `multimodal-architecture.md` §7) |

---

## 4. User journeys

**Flow A — help with the current round.** Tracker → sparkles → "اشرحيلي الدور ده". Khayoota receives the pinned round and its totals; replies with stitch types, the repeat, the expected total and the one or two mistakes most common for that shape; chip "R7 · الايد"; action **ارجعي للعدّاد**. Works offline through the deterministic explainer.

**Flow B — diagnose from a photo.** Project → Ask Khayoota → 📷 "شوفي شغلي" → question. Reply as in §3.5. Action: open the round.

**Flow C — explain a stitch.** "يعني إيه hdc؟" → stitch card + optional video topic.

**Flow D — suggest the next piece.** "إيه اللي فاضل؟" → the list comes from the context (`unfinishedParts`); action **افتحي: الودن 1/2** (`project.openPart`). Progress is never changed.

**Flow E — pattern revision assistance.** Khayoota (or the count-check card) spots an inconsistency → proposal card (§3.8) → user applies and saves → existing revision/pin flow.

**Flow F — image to pattern.** 📷 "اقري باترون" → 1–4 pages → preview card → review → Add Pattern editor → Save.

---

## 5. Strings and accessibility notes

- All new copy goes into `strings.ts` (both languages), including text that is currently inline in the assistant page (greeting, suggestions) so it can be reviewed in one place.
- Action button labels are **app strings keyed by action id** — the model never writes button text.
- Screen readers: cards have headings; the three photo blocks are a list with labelled items; status badges have text, not colour alone.
- Numbers and stitch code render LTR inside RTL text (`.gz-num`, `.gz-code`).
