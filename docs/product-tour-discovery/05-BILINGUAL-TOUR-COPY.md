# 05 — Bilingual Tour Copy

Final proposed wording for every step in `04`. Keys match step ids.

## 1. Voice

The app speaks Egyptian colloquial Arabic, addressed to a woman, warm and short (`core/i18n/strings.ts:1`; e.g. "مش دلوقتي", "ابدئي رحلتك"). The tour uses the same voice so it reads as part of the app.

Rules used below:

- Title: at most 4 words. Body: at most 2 short sentences, about 110 characters in Arabic and 120 in English. If it does not fit, the step is doing too much.
- Say what the thing is for, then what the user can do. No feature names the UI does not use.
- English is written fresh, not translated line by line.
- At most one emoji per tour, and only 🧶, which the app already uses.
- Use the labels the screen really shows. The Home tile is «قارئ الباترن» / "Pattern reader"; multi-part patterns are «باترون بأجزاء» / "Multi-part"; a physical item is «قطعة» / "piece".
- Spelling: **باترون** (the form most pattern screens use), except when quoting a label that is spelled باترن on screen. The app is inconsistent here; that is noted for a separate copy pass.
- Never promise: AI answers, photo reading, perfect import, or anything marked "soon".

### Egyptian and Gulf readers

The current wording is understood across the region, but a few words are distinctly Egyptian. The copy is stored as language-keyed text per step, so a second Arabic variant can be added later without touching tour logic. Candidates if a neutral variant is wanted:

| Egyptian (used now) | Neutral alternative |
|---|---|
| مش دلوقتي | لاحقًا / ليس الآن |
| دلوقتي | الآن |
| عايزة | تريدين / تبغين |
| إزاي | كيف |
| لسه | بعد / ما زال |
| كده | هكذا |
| بتشتغلي عليها | تعملين عليها |

Recommendation: ship v1 in the app's existing voice. Mixing two dialects on one screen would be worse than either.

## 2. Shared labels

| Key | Arabic | English |
|---|---|---|
| `tour.start` | ابدئي الجولة | Start the tour |
| `tour.next` | التالي | Next |
| `tour.prev` | السابق | Back |
| `tour.skip` | تخطّي | Skip |
| `tour.done` | تمام | Done |
| `tour.resume` | كمّلي الجولة | Resume tour |
| `tour.replay` | إعادة الجولة | Replay tour |
| `tour.learnMore` | اعرفي أكتر | Learn more |
| `tour.notNow` | مش دلوقتي | Not now |
| `tour.close` (accessible name of ×) | إغلاق الجولة | Close tour |
| `tour.progress` (spoken) | خطوة {n} من {total} | Step {n} of {total} |
| `tour.hide` | إخفاء | Hide |

"Back" is used in English rather than "Previous": shorter, and it matches the app's own Back.

## 3. Welcome offer (Getting Started card, state A)

| Key | Arabic | English |
|---|---|---|
| `welcome.offer.title` | أهلاً بيكي في غرزتك 🧶 | Welcome to Gharzetak 🧶 |
| `welcome.offer.body` | جولة سريعة تعرّفك كل حاجة فين. ٦ خطوات، أقل من دقيقة. | A quick tour of where everything is. 6 steps, under a minute. |
| primary | ابدئي الجولة | Start the tour |
| secondary | مش دلوقتي | Not now |

## 4. `welcome`

| Step | Arabic title | Arabic body | English title | English body |
|---|---|---|---|---|
| `welcome.patterns` | باتروناتك هنا | افتحي باتروناتك المحفوظة، جرّبي باترون جاهز، أو أضيفي باترون جديد. | Your patterns live here | Open saved patterns, try a ready-made sample, or add your own. |
| `welcome.projects` | مشاريعي | كل حاجة بتشتغلي عليها. المشروع = باترون + تقدّمك فيه. | Projects | Everything you're making. A project is a pattern plus your progress on it. |
| `welcome.tracker` | العدّاد | عدّي غرزك وأدوارك هنا. بيتحفظ لوحده، وتكمّلي من آخر مكان وقفتي عنده. | Tracker | Count stitches and rounds here. It saves as you go, so you can pick up where you stopped. |
| `welcome.learn` | تعلّمي | شروحات للغرز والأساسيات، خطوة بخطوة. | Learn | Stitch and basics tutorials, step by step. |
| `welcome.khayoota` | خيوطة | اسأليها عن أي غرزة أو دور في الباترون. | Khayoota | Ask about any stitch or pattern round. |
| `welcome.settings` | الإعدادات والمساعدة | اللغة والتذكيرات وكل الإعدادات من هنا. وتقدري تعيدي الجولة دي في أي وقت. | Settings & help | Language, reminders and everything else. You can replay this tour here any time. |
| `welcome.done` (toast) | — | خلصت الجولة. ابدئي بأول خطوة من القايمة 🧶 | — | That's the tour. Pick your first step from the list 🧶 |

Notes:

- `welcome.projects` is where "pattern" and "project" are told apart, in one line.
- `welcome.khayoota` is true in every mode: the built-in rules also answer stitch questions. It says nothing about AI.

## 5. `patterns`

| Step | Arabic title | Arabic body | English title | English body |
|---|---|---|---|---|
| `patterns.sample` | جرّبي باترون جاهز | الباترونات اللي عليها «نموذج» جاهزة للتجربة. افتحي واحد وشوفيه دور بدور. | Try a ready-made pattern | Patterns marked "Sample" are ready to explore. Open one and read it round by round. |
| `patterns.kinds` | بأجزاء ولا منفرد؟ | الباترون المنفرد قطعة واحدة. الباترون بأجزاء فيه كذا قطعة، زي دمية ليها راس وإيدين. | Multi-part or standalone? | A standalone pattern is one piece. A multi-part pattern has several, like a doll with a head and two arms. |
| `patterns.add` | أضيفي باترونك | اكتبي الباترون أو الصقيه. بعد كده اعملي منه مشروع وابدئي العدّ. | Add your own | Type or paste a pattern, then start a project from it and begin counting. |

## 6. `pattern-reader`

| Step | Arabic title | Arabic body | English title | English body |
|---|---|---|---|---|
| `reader.read` | اقري دور بدور | الكارت ده بيعرض الدور اللي إنتي فيه وشرحه بكلام بسيط. ومكانك بيتحفظ. | One round at a time | This card shows your current round with a plain-language explanation. Your place is saved. |
| `reader.move` | التالي والسابق | اتنقّلي بين الأدوار من هنا، أو اضغطي أي دور من القايمة تحت. | Next and previous | Move between rounds here, or tap any round in the list below. |
| `reader.track` (has a project) | عدّي على الباترون ده | اربطي الباترون بمشروع من فوق، وبعدين اضغطي هنا والعدّاد يمشي معاكي دور بدور. | Count along with it | Link the pattern to a project above, then tap here and the tracker follows it round by round. |
| `reader.track` (no project) | عايزة تعدّي عليه؟ | اعملي مشروع جديد واختاري الباترون ده، والعدّاد هيمشي معاكي دور بدور. | Want to count along? | Create a new project and choose this pattern. The tracker will follow it round by round. |

## 7. `tracker-simple`

| Step | Arabic title | Arabic body | English title | English body |
|---|---|---|---|---|
| `tracker.read` | إنتي فين دلوقتي | الرقم الكبير هو غرزك في الدور ده، وتحته العدد المطلوب. | Where you are | The big number is your stitches this round, with the round's target under it. |
| `tracker.tap` | اضغطي مع كل غرزة | كل ضغطة بتزوّد العدّ وبتتحفظ في ساعتها. | Tap as you stitch | Each tap adds to the count and is saved right away. |
| `tracker.tap` (instruction line) | — | جرّبي: اضغطي الزرار مرة | — | Try it: tap the button once |
| `tracker.undo` | غلطتي؟ تراجعي | زرار التراجع بيرجّع آخر ضغطة، واحدة واحدة. | Miscounted? Undo | Undo takes back your last tap, one at a time. |
| `tracker.resume` | كمّلي بعدين | تقدّمك محفوظ. ارجعي للعدّاد في أي وقت، وبدّلي المشروع من هنا. | Pick it up later | Your progress is saved. Come back any time, and switch projects from here. |

The copy says "Undo", never "minus" or "decrease": the tracker has no decrement.

## 8. `tracker-pattern`

| Step | Arabic title | Arabic body | English title | English body |
|---|---|---|---|---|
| `tracker.rounds` | أدوار الباترون | الدور المميّز هو اللي إنتي فيه. اضغطي أي دور لو عايزة تروحيله. | Pattern rounds | The highlighted round is the one you're on. Tap any round to jump to it. |
| `tracker.instruction` | تعليمات الدور | هنا غرز الدور مكتوبة، وجنبها علامة بتقول لو العدد مظبوط. | This round's instructions | The round's stitches are written here, with a check that the count adds up. |
| `tracker.step` | الخطوة الحالية | بتعرّفك إنتي عند أنهي غرزة في الدور، وإيه اللي بعدها. | Current step | Shows which stitch of the round you're on, and what comes next. |
| `tracker.countby` | عدّي بطريقتك | اختاري الضغطة تحسب غرزة، مجموعة، أو الدور كله. | Count your way | Choose whether one tap counts a stitch, a group, or the whole round. |
| `tracker.count` | اضغطي وكمّلي | الزرار الكبير بيعدّ، واللي جنبه بيتراجع عن آخر ضغطة. كل حاجة بتتحفظ لوحدها. | Tap to count | The big button counts, and the one beside it undoes the last tap. Everything saves by itself. |

## 9. `tracker-parts`

| Step | Arabic title | Arabic body | English title | English body |
|---|---|---|---|---|
| `tracker.pieces` | قطع المشروع | كل قطعة ليها عدّاد لوحدها. «الإيد 1/2» يعني أول إيد من اتنين. | Project pieces | Each piece has its own counter. "Arm 1/2" means the first of two arms. |
| `tracker.whole` | تقدّم المشروع كله | هنا بتشوفي خلصتي كام قطعة من المشروع. | Whole-project progress | See how many pieces of the project you've finished. |

## 10. `project-create`

| Step | Arabic title | Arabic body | English title | English body |
|---|---|---|---|---|
| `project.name` | سمّي مشروعك | الاسم بس هو المطلوب. الباقي اختياري وتقدري تغيّريه بعدين. | Name your project | Only the name is required. Everything else is optional and can be changed later. |
| `project.source` | ابدئي من باترون | اختاري باترون محفوظ والعدّاد هيمشي عليه دور بدور، أو كمّلي من غير باترون بعدّاد بسيط. زرار الحفظ في آخر الصفحة. | Start from a pattern | Pick a saved pattern and the tracker follows it round by round, or go without one and use a simple counter. Save is at the bottom. |

## 11. `khayoota`

`khayoota.status` has one variant per status the screen itself reports.

| Variant | Arabic title | Arabic body | English title | English body |
|---|---|---|---|---|
| `rules`, `offline`, `demo` | خيوطة دلوقتي | الردود حاليًا من قواعد غرزتك الجاهزة، مش ذكاء اصطناعي. اضغطي على السطر ده للتفاصيل. | Khayoota right now | Answers currently come from Gharzetak's built-in rules, not AI. Tap this line for details. |
| `soon` | خيوطة الذكية قريبًا | خيوطة بالذكاء الاصطناعي لسه في التجربة. لحد ما تتفتح، الردود من قواعد غرزتك. | Khayoota AI is coming | Khayoota AI is still in testing. Until it opens, answers come from Gharzetak's built-in rules. |
| `consent` | قبل أول سؤال | خيوطة هتطلب موافقتك وتشرحلك إيه اللي بيتبعت قبل ما ترد. | Before your first question | Khayoota will ask for your OK and explain what is sent before it answers. |
| `ai` | خيوطة متصلة | خيوطة بترد بالذكاء الاصطناعي وممكن تغلط، فراجعي دايمًا على الباترون. وليها حد يومي للأسئلة. | Khayoota is connected | Khayoota answers with AI and can be wrong, so always check against your pattern. There is a daily question limit. |

| Step | Arabic title | Arabic body | English title | English body |
|---|---|---|---|---|
| `khayoota.ask` | اكتبي سؤالك | اسألي عن غرزة، دور، أو مشكلة في الشغل. مفيش حاجة بتتبعت غير لما تضغطي إرسال. | Type your question | Ask about a stitch, a round or a problem in your work. Nothing is sent until you press Send. |
| `khayoota.controls` (testers: `ai`, `consent`) | اختياراتك | من هنا تمسحي المحادثة، أو تقفلي خيوطة بالذكاء الاصطناعي في أي وقت. | Your controls | Clear the chat here, or turn Khayoota AI off at any time. |
| `khayoota.controls` (everyone else) | اختياراتك | من هنا تمسحي المحادثة وتشوفي حالة خيوطة. | Your controls | Clear the chat and see Khayoota's status here. |

Not said anywhere: that Khayoota can read photos or extract patterns. Those are tester-only, and the screen's own consent text is the right place to explain them, immediately before a tester's first use.

## 12. Offer pills

| Key | Arabic | English |
|---|---|---|
| `pill.first` | أول مرة هنا؟ جولة {n} خطوات | New here? {n}-step tour |
| `pill.resume` | كمّلي الجولة من مكان ما وقفتي | Resume the tour where you stopped |
| action | ابدئي | Start |
| close (accessible name) | مش دلوقتي | Not now |

`{n}` uses Western digits, isolated left-to-right, like every number in the app (`.gz-ltr`).

## 13. Getting Started card

| Key | Arabic | English |
|---|---|---|
| `gs.title` | أول خطواتك في غرزتك | Your first steps |
| `gs.progress` | خلّصتي {n} من {total} | {n} of {total} done |
| `gs.pattern` | استكشفي باترون جاهز | Explore a sample pattern |
| `gs.project` | اعملي أول مشروع | Create your first project |
| `gs.tracker` | جرّبي العدّاد | Try the tracker |
| `gs.learn` | افتحي أول شرح | Open a tutorial |
| `gs.khayoota` | اسألي خيوطة سؤال | Ask Khayoota a question |
| `gs.hide` | إخفاء | Hide |
| `gs.done.title` | خلّصتي أول خطواتك 🧶 | You've finished your first steps 🧶 |
| `gs.done.body` | القايمة دي موجودة في الإعدادات لو حبيتي ترجعيلها. | You can find this list again in Settings. |

## 14. Settings → Tours & help

| Key | Arabic | English |
|---|---|---|
| `help.section` | الجولات والمساعدة | Tours & help |
| `help.welcome` | جولة التطبيق | App tour |
| `help.tracker` | جولة العدّاد | Tracker tour |
| `help.patterns` | جولة الباترونات | Patterns tour |
| `help.khayoota` | جولة خيوطة | Khayoota tour |
| `help.list` | قايمة أول خطواتك | Getting-started list |
| `help.needsProject` | اعملي مشروع الأول علشان تشوفي جولة العدّاد. | Create a project first to see the tracker tour. |

## 15. Mixed-direction text

| Case | Handling |
|---|---|
| Counts such as `1/2`, `30`, step totals | Wrapped in the app's `.gz-ltr` span (direction isolate), as the app already does for numbers |
| Stitch notation (`sc`, `inc`, `R5`) | Not used in tour copy. The screens show it; the tour points at it. |
| Latin product words inside Arabic (US, UK, PDF) | Avoided in tour copy |
| Quotation marks | Arabic: « » ; English: " " |
| The `tracker.pieces` example | The Arabic line contains `1/2`; it must be isolated or the slash order flips. Verify on device. |

Because the engine writes copy with `innerHTML`, these spans are allowed, and for the same reason copy must stay static text from the definitions file.

## 16. Review checklist before shipping copy

- [ ] Every title ≤ 4 words; every body ≤ 2 sentences
- [ ] Each step fits at 320 px width without the popover exceeding 60% of the screen height at default font size
- [ ] A native Egyptian-Arabic reader and one Gulf reader have read every line aloud
- [ ] No line contradicts text visible on the same screen (the Khayoota menu and Settings → About still contain older "demo" wording; see `01` §4)
- [ ] No claim about AI, photos or import accuracy outside the `ai` variant
