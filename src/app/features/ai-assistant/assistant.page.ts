import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { IonContent, IonFooter, IonHeader, NavController } from '@ionic/angular';
import { resolveAction, type ResolvedAction } from '../../core/ai/action-registry';
import { AssistantService } from '../../core/ai/assistant.service';
import { calcFacts } from '../../core/ai/calc';
import { buildKhayootaContext } from '../../core/ai/khayoota-context';
import { KhayootaFailure, KhayootaService } from '../../core/ai/khayoota.service';
import type { InlineImage, KhayootaErrorCode } from '../../core/ai/khayoota.types';
import { previewFromTranscript, type PatternPreview } from '../../core/ai/transcript-draft';
import { AuthService } from '../../core/auth/auth.service';
import { CAT } from '../../core/data/catalog';
import { parsePattern } from '../../core/domain/pattern-parser';
import { displayInTerms } from '../../core/domain/terminology';
import { patternContext } from '../../core/domain/tracker-engine';
import { I18nService } from '../../core/i18n/i18n.service';
import { ChatMessage } from '../../core/models/models';
import { NetworkService } from '../../core/services/network.service';
import { TrackerNavigator } from '../../core/services/tracker-navigator.service';
import { AppStore } from '../../core/state/app.store';
import { uuid } from '../../core/state/factories';
import { readImageFile } from '../../core/utils/image';
import { projectCard } from '../../shared/project-view';
import { SheetComponent } from '../../shared/ui/dialogs/sheet.component';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PhotoComponent } from '../../shared/ui/images/photo.component';
import { ImportDraftService } from '../patterns/import-draft.service';
import { KhayootaReplyComponent } from './khayoota-reply.component';

type PhotoPurpose = 'diagnose' | 'pattern';
/** Base64 cap per image (matches the server contract). */
const MAX_B64 = 950_000;

/**
 * GZ-S21 Khayoota (خيوطة) — Gharzetak's AI-powered crochet companion.
 *
 *  - Hosted replies (signed in + consent + server kill switch on) go through KhayootaService → /v1/ai.
 *  - Everything else (guest, offline, no backend, limits, errors) falls back to the deterministic offline helper, labelled.
 *  - Context: ONLY the chosen project, read from the revision it follows (buildKhayootaContext → trackerView).
 *  - Photos are resized/re-encoded on the device (EXIF dropped), sent inline, and never stored in chat history.
 *  - Actions are re-validated at render and at tap; none changes progress or saves anything.
 */
@Component({
  selector: 'gz-assistant',
  imports: [IonHeader, IonContent, IonFooter, IconComponent, PhotoComponent, SheetComponent, KhayootaReplyComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top kh-top" style="padding-top: calc(18px + var(--gz-safe-top))">
        <div class="gz-tile t-lav" style="width: 46px; height: 46px"><svg gzIcon="sparkles" /></div>
        <div class="flex min-w-0 flex-1 flex-col"><h1 class="gz-hd m-0" style="font-size: 18px">{{ t().aiTitle }}</h1><span class="gz-xs gz-mute truncate kh-sub">{{ t().aiSub }}</span></div>
        <span class="gz-badge" [class.rose]="mode() === 'offline'" [class.sage]="mode() === 'ai'" [class.peach]="mode() === 'consent'">{{ badge() }}</span>
        <button type="button" class="gz-icb flat" (click)="sheet.set('menu')" [attr.aria-label]="i18n.q('خيارات خيوطة', 'Khayoota options')"><svg gzIcon="sliders" /></button>
      </div>
      <div class="kh-ctx-wrap" style="padding: 0 20px 8px">
        <div class="gz-card kh-ctx" style="padding: 10px 12px; border: 1.5px solid var(--gz-border); box-shadow: none">
          <div class="flex items-center gap-2.5">
            <gz-photo class="flex-none kh-ctx-photo" [tone]="ctxView().tone" [src]="ctxView().img" [storagePath]="ctxView().path" [alt]="ctxView().name" [showLabel]="false" iconSize="s" height="44px" width="44px" extraClass="r16" />
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="gz-xs gz-mute gz-b kh-ctx-label">{{ i18n.q('بتتكلمي عن', 'Talking about') }}</span>
              <span class="gz-b truncate" style="font-size: 14px">{{ ctxView().name }}</span>
              <span class="gz-xs gz-mute truncate kh-ctx-line">{{ ctxView().line }}</span>
            </div>
            @if (useProject()) {
              <button type="button" class="gz-btn3" style="min-height: 44px; padding: 0 12px; font-size: 13px" (click)="explainCurrent()">{{ t().explainCur }}</button>
            }
          </div>
          @if (activeProject()) {
            <button type="button" class="gz-btn-text gz-xs mt-1 kh-ctx-toggle" (click)="useProject.set(!useProject())">{{ useProject() ? i18n.q('اسألي سؤال عام بدل كده', 'Ask a general question instead') : i18n.q('اسألي عن المشروع ده', 'Ask about this project') }}</button>
          }
        </div>
      </div>
    </ion-header>

    <ion-content class="gz-scroll">
      <div class="flex min-h-full flex-col justify-end gap-2.5" style="padding: 6px 20px 8px" aria-live="polite">
        @for (m of messages(); track m.id) {
          <div class="flex flex-col gap-1" [style.align-items]="(m.role === 'user') === i18n.isAr() ? 'flex-start' : 'flex-end'">
            @if (m.img) {
              <div class="r20 overflow-hidden bg-lavender-200" style="width: 150px; height: 150px"><img [src]="m.img" [alt]="t().attached" class="h-full w-full object-cover" /></div>
            }
            @if (m.text) {
              <div class="gz-msg" [class.u]="m.role === 'user'" [class.a]="m.role !== 'user'">{{ m.text }}</div>
            }
            @if (m.role === 'bot' && m.id !== 'hello') {
              @if (m.error) {
                <div class="gz-note err" role="alert" style="max-width: 92%">
                  <div class="flex-1">{{ errorText(m.error) }}</div>
                  @if (retryable(m.error) && lastQuestion()) { <button type="button" class="gz-btn-text" (click)="retry()">{{ i18n.q('حاولي تاني', 'Try again') }}</button> }
                </div>
              }
              <gz-khayoota-reply [msg]="m" [preview]="m.previewId ? previews()[m.previewId] ?? null : null" (act)="runAction($event)" (watch)="openTopic($event)" (addDraft)="addDraft($event)" (dismissPreview)="dropPreview(m.previewId)" />
              @if (m.source === 'offline' || m.source === 'demo') {
                <span class="gz-xs" style="color: var(--gz-pink-ink); font-weight: 700; padding-inline: 6px">{{ m.source === 'demo' ? t().demoReply : t().offlineReply }}</span>
              }
            }
          </div>
        }
        @if (typing()) {
          <div class="gz-msg a gz-mute" [style.align-self]="i18n.isAr() ? 'flex-end' : 'flex-start'" role="status">{{ busyText() }}</div>
        }
      </div>
    </ion-content>

    <ion-footer class="ion-no-border" style="background: var(--gz-bg)">
      <div style="padding: 4px 0 var(--gz-tab-float)">
        @if (guestHint()) {
          <div class="gz-note lav mx-5 mb-1.5"><svg gzIcon="info" size="s" /><div class="flex-1">{{ i18n.q('خيوطة بالذكاء الاصطناعي محتاجة حساب علشان خصوصيتك. لسه تقدري تستخدمي الشرح بدون نت.', 'Khayoota AI needs an account to protect your privacy. The offline helper still works.') }}</div><button type="button" class="gz-btn-text" (click)="signIn()">{{ i18n.q('تسجيل الدخول', 'Sign in') }}</button></div>
        }
        <!-- Suggestions: one contained, RTL-aware scroll rail (no negative margins), hidden while typing so the
             composer keeps the space. Chips stay single-line; long ones end in an ellipsis and keep a full label. -->
        @if (!input().trim() && !typing()) {
          <div class="kh-rail" role="group" [attr.aria-label]="i18n.q('أسئلة مقترحة', 'Suggested questions')">
            @for (q of suggestions(); track q) {
              <button type="button" class="gz-chip sm tint kh-chip" [attr.title]="q" (click)="send(q)">{{ q }}</button>
            }
          </div>
        }
        <div class="kh-composer">
          <button type="button" class="gz-icb flat" (click)="photoTap()" [attr.aria-label]="t().attachPhoto"><svg gzIcon="camera" /></button>
          <input #file class="gz-sr" type="file" accept="image/*" (change)="onPhoto($event)" />
          <label class="kh-field">
            <span class="gz-sr">{{ t().askPh }}</span>
            <textarea
              rows="1"
              dir="auto"
              [value]="input()"
              (input)="input.set($any($event.target).value)"
              (keydown.enter)="onEnter($any($event))"
              [placeholder]="t().askPh"
              enterkeyhint="send"
              maxlength="2000"
            ></textarea>
          </label>
          <button type="button" class="gz-icb pur" (click)="send(input())" [disabled]="typing() || !input().trim()" [attr.aria-label]="t().send"><svg gzIcon="send" /></button>
        </div>
        <!-- One compact status line from the real backend/provider state; details live in the options sheet. -->
        <button type="button" class="kh-status" [attr.data-mode]="mode()" (click)="sheet.set('menu')" [attr.aria-label]="statusLine() + ' — ' + i18n.q('التفاصيل', 'details')">
          <span class="kh-dot" aria-hidden="true"></span><span class="truncate">{{ statusLine() }}</span><svg gzIcon="info" size="s" aria-hidden="true" />
        </button>
      </div>
    </ion-footer>

    <gz-sheet [open]="sheet() === 'consent'" [title]="i18n.q('قبل ما نبدأ', 'Before we start')" (closed)="sheet.set(null)">
      <div class="flex flex-col gap-2.5">
        <p class="gz-sm m-0">{{ i18n.q('خيوطة رفيقة كروشيه بالذكاء الاصطناعي من غرزتك — مش مدرّسة بشرية ومش نموذج اتدرّب عندنا.', 'Khayoota is Gharzetak’s AI-powered crochet companion — not a human teacher and not a model trained by us.') }}</p>
        <ul class="gz-sm m-0" style="padding-inline-start: 18px; line-height: 1.7">
          <li>{{ i18n.q('لما تسأليها، بنبعت لخدمة ذكاء اصطناعي بتشغّلها Cloudflare علشان ترد عليكي: سؤالك، وآخر كام رسالة في المحادثة، وأي صورة ترفقيها. ولو بتسألي عن مشروع: اسمه، والدور اللي إنتي فيه، والأدوار اللي جنبه أو اللي بتسألي عنها، من نسخة الباترون اللي المشروع ماشي عليها.', 'When you ask, we send to an AI service run by Cloudflare so it can answer: your question, the last few messages of this chat and any photo you attach. If you ask about a project: its name, the round you are on and the rounds next to it or that you ask about, from the pattern version that project follows.') }}</li>
          <li>{{ i18n.q('مش بنبعت مشاريعك التانية ولا ملاحظاتك ولا اسمك ولا إيميلك. إحنا مش بنخزّن أسئلتك ولا صورك ولا الردود؛ المحادثة بتفضل على موبايلك، وبنحسب عدد الأسئلة بس.', 'We do not send your other projects, your notes, your name or your e-mail. We do not store your questions, photos or the replies; the chat stays on your phone and we only count how many questions you ask.') }}</li>
          <li>{{ i18n.q('خيوطة ممكن تغلط — راجعي دايمًا على الباترون. فيه حد يومي للأسئلة، وتقدري تقفلي خيوطة بالذكاء الاصطناعي في أي وقت من قايمة خيوطة.', 'Khayoota can be wrong — always check against your pattern. There is a daily question limit, and you can turn Khayoota AI off at any time from the Khayoota menu.') }}</li>
        </ul>
      </div>
      <ng-container gzActions>
        <button type="button" class="gz-btn" [class.is-busy]="consentBusy()" (click)="acceptConsent()">{{ i18n.q('موافقة ومتابعة', 'Agree and continue') }}</button>
        <button type="button" class="gz-btn-text" (click)="declineConsent()">{{ i18n.q('مش دلوقتي', 'Not now') }}</button>
      </ng-container>
    </gz-sheet>

    <gz-sheet [open]="sheet() === 'photo'" [title]="i18n.q('هتعملي إيه بالصورة؟', 'What should Khayoota do with the photo?')" (closed)="sheet.set(null)">
      <div class="flex flex-col gap-2">
        <button type="button" class="gz-btn2" [disabled]="!kh.features().vision" (click)="pickPhoto('diagnose')"><svg gzIcon="search" size="s" />{{ i18n.q('شوفي شغلي', 'Look at my work') }}</button>
        <button type="button" class="gz-btn2" [disabled]="!kh.features().extract" (click)="pickPhoto('pattern')"><svg gzIcon="notes" size="s" />{{ i18n.q('اقري باترون', 'Read a pattern') }}</button>
        <p class="gz-xs gz-mute m-0">{{ i18n.q('الصورة بتتصغّر على موبايلك، وبتتبعت للتحليل ومش بتتخزن. نور كويس وصفحة واحدة في الصورة.', 'The photo is resized on your phone, sent for analysis and not stored. Good light, one page per photo.') }}</p>
        @if (!kh.features().vision && !kh.features().extract) {
          <p class="gz-xs m-0">{{ i18n.q('تحليل الصور لسه مش متاح.', 'Photo analysis is not available yet.') }}</p>
        }
      </div>
    </gz-sheet>

    <gz-sheet [open]="sheet() === 'menu'" [title]="t().aiTitle" (closed)="sheet.set(null)">
      <div class="flex flex-col gap-2">
        <div class="gz-note lav" role="status"><div class="flex-1">{{ statusDetail() }}</div></div>
        @if (kh.hosted() && kh.status(); as s) {
          @if (s.enabled) {
            <p class="gz-sm m-0">{{ i18n.q('الباقي النهارده', 'Left today') }}: {{ s.remaining.chat }} {{ i18n.q('سؤال', 'questions') }} · {{ s.remaining.image }} {{ i18n.q('صورة', 'photos') }} · {{ s.remaining.extract }} {{ i18n.q('باترون', 'patterns') }}</p>
          }
        }
        <button type="button" class="gz-btn3" (click)="clearChat()"><svg gzIcon="x" size="s" />{{ i18n.q('مسح المحادثة', 'Clear conversation') }}</button>
        @if (kh.hosted() && !kh.needsConsent()) {
          <button type="button" class="gz-btn-text" (click)="withdraw()">{{ i18n.q('إيقاف خيوطة بالذكاء الاصطناعي', 'Turn off Khayoota AI') }}</button>
        }
      </div>
    </gz-sheet>
  `,
  styles: [
    `
      /* Composer: the field is the only flexible item (min-width: 0 lets it shrink below its content); the two round
         buttons never shrink, so nothing can be pushed past the screen edge in RTL or LTR. */
      .kh-composer { display: flex; align-items: flex-end; gap: 8px; padding-inline: var(--gz-screen-pad, 20px); }
      .kh-composer > .gz-icb { flex: none; }
      .kh-field {
        flex: 1 1 auto; min-width: 0; display: flex; align-items: center; min-height: 46px;
        border: 1.5px solid var(--gz-border); border-radius: 23px; background: var(--gz-surface); padding: 0 14px;
      }
      .kh-field:focus-within { border-color: var(--gz-primary); }
      .kh-field textarea {
        flex: 1; min-width: 0; width: 100%; border: 0; outline: 0; background: transparent; resize: none; font: inherit;
        font-size: 15px; line-height: 1.45; color: var(--gz-text); padding: 11px 0; max-height: 7.5em; overflow-y: auto;
        field-sizing: content; /* grows with the text up to max-height, then scrolls inside */
      }
      .kh-field textarea::placeholder { color: var(--gz-text-3); }
      /* Suggestions rail: contained in the footer; edge fade is the scroll affordance (symmetric, so RTL and LTR). */
      .kh-rail {
        display: flex; gap: 8px; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none;
        padding: 2px var(--gz-screen-pad, 20px) 8px; scroll-padding-inline: var(--gz-screen-pad, 20px);
        mask-image: linear-gradient(to right, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%);
      }
      .kh-rail::-webkit-scrollbar { display: none; }
      .kh-chip { flex: none; max-width: min(72vw, 280px); min-height: 40px; overflow: hidden; text-overflow: ellipsis; }
      /* Status: one line, colour from the real state; tap for details. */
      .kh-status {
        display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; min-height: 32px; margin-top: 2px;
        padding: 0 var(--gz-screen-pad, 20px); border: 0; background: transparent; font: inherit; font-size: 12px; color: var(--gz-text-2);
      }
      .kh-status > .truncate { min-width: 0; }
      .kh-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--gz-text-3); }
      .kh-status[data-mode='ai'] .kh-dot { background: var(--gz-mint-ink); }
      .kh-status[data-mode='demo'] .kh-dot,
      .kh-status[data-mode='consent'] .kh-dot,
      .kh-status[data-mode='soon'] .kh-dot { background: var(--gz-warning); }
      .kh-status[data-mode='offline'] .kh-dot { background: var(--gz-error); }
      /* Short viewports (landscape, or the keyboard is open): keep the conversation visible. The project card keeps its
         name and the explain button; the photo, the round line, the label and the subtitle step aside. */
      @media (max-height: 560px) {
        .kh-top { padding-top: calc(8px + var(--gz-safe-top)) !important; padding-bottom: 4px; }
        .kh-sub, .kh-ctx-photo, .kh-ctx-label, .kh-ctx-line { display: none; }
        .kh-ctx { padding: 6px 10px !important; }
        .kh-ctx-toggle { margin-top: 0; }
        .kh-ctx-wrap { padding-bottom: 4px !important; }
        .kh-field textarea { max-height: 4.4em; }
        .kh-status { min-height: 24px; }
      }
      @media (max-width: 340px) {
        .kh-composer { gap: 6px; padding-inline: 12px; }
        .kh-rail { padding-inline: 12px; }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantPage {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(AppStore);
  protected readonly ai = inject(AssistantService);
  protected readonly kh = inject(KhayootaService);
  private readonly auth = inject(AuthService);
  private readonly net = inject(NetworkService);
  private readonly ui = inject(UiFeedback);
  private readonly nav = inject(NavController);
  private readonly trackerNav = inject(TrackerNavigator);
  private readonly drafts = inject(ImportDraftService);

  /** Query params (withComponentInputBinding): ?project=<id> from Project Details / Tracker, ?ask=… from the Pattern Reader. */
  readonly project = input<string | undefined>();
  readonly ask = input<string | undefined>();

  protected readonly t = this.i18n.t;
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('file');
  private readonly content = viewChild(IonContent);
  protected readonly input = signal('');
  protected readonly typing = signal(false);
  protected readonly busyText = signal('');
  protected readonly sheet = signal<'consent' | 'photo' | 'menu' | null>(null);
  protected readonly consentBusy = signal(false);
  protected readonly useProject = signal(true);
  protected readonly previews = signal<Record<string, PatternPreview>>({});
  protected readonly lastQuestion = signal<{ text: string; images?: InlineImage[]; img?: string; purpose?: PhotoPurpose } | null>(null);
  private pendingAfterConsent: (() => void) | null = null;
  /** The question waiting behind the consent sheet (typed OR tapped from a suggestion chip). */
  private pendingQuestion: { text: string; hadImage: boolean } | null = null;
  private photoPurpose: PhotoPurpose = 'diagnose';

  constructor() {
    effect(() => {
      const a = this.ask();
      if (a) untracked(() => this.input.set(a.slice(0, 2000)));
    });
    effect(() => {
      // Re-read the server status whenever sign-in changes.
      this.auth.signedIn();
      untracked(() => void this.kh.refreshStatus());
    });
  }

  ionViewWillEnter(): void {
    void this.kh.refreshStatus();
  }

  /** The project Khayoota talks about: the one passed in the URL, else the current one. */
  protected readonly activeProject = computed(() => {
    const id = this.project();
    return (id ? this.store.project(id) : null) ?? this.store.currentProject();
  });

  /** ai/demo = hosted and consented; consent = hosted but waiting for the user's OK; rules = online without hosted AI (guest, no backend, disabled); offline = no network. */
  protected readonly mode = computed<'ai' | 'demo' | 'consent' | 'soon' | 'rules' | 'offline'>(() => {
    if (this.kh.ready()) return this.kh.demoProvider() ? 'demo' : 'ai';
    if (this.kh.needsConsent()) return 'consent';
    if (this.kh.restricted() && this.net.online()) return 'soon';
    return this.net.online() ? 'rules' : 'offline';
  });
  protected readonly badge = computed(() => {
    const t = this.t();
    return { ai: t.aiBadge, demo: t.demoBadge, consent: t.aiConsentBadge, soon: t.aiSoonBadge, rules: t.aiRulesBadge, offline: t.aiOfflineBadge }[this.mode()];
  });

  protected readonly guestHint = computed(() => this.kh.configured && !this.auth.signedIn());

  protected readonly ctxView = computed(() => {
    const p = this.useProject() ? this.activeProject() : null;
    if (!p) return { name: this.i18n.q('من غير مشروع — أسئلة عامة', 'No project — general questions'), line: '—', tone: CAT.amigurumi.tone, img: '', path: null as string | null };
    const card = projectCard(this.store, this.i18n, p);
    const view = this.store.trackerView(p);
    let line = `${this.i18n.q('الدور ', 'Round ')}${p.tracker.simple.round} · ${p.tracker.simple.count}/${p.tracker.simple.target}`;
    if (view?.source && view.tracker.mode === 'pattern') {
      const c = patternContext(parsePattern(view.source.text), view.tracker.cursor);
      if (c) line = `${view.instance ? view.source.name + ' · ' : ''}R${c.round.n} · ${displayInTerms(c.round.raw, view.source.terms, this.store.viewTerms())}`;
    }
    return { name: p.name, line, tone: card.tone, img: card.img, path: card.storagePath };
  });

  protected readonly messages = computed<ChatMessage[]>(() => {
    const p = this.activeProject();
    const hello: ChatMessage = {
      id: 'hello',
      role: 'bot',
      text: this.i18n.q(
        'أهلًا! أنا خيوطة 🧶 صاحبتك في كل غرزة. اسأليني عن الباترون أو ورّيني الشغل اللي محتاجة مساعدة فيه.' + (p ? ` شايفة إن مشروعك «${p.name}».` : ''),
        'Hi! I’m Khayoota 🧶 your companion for every stitch. Ask me about your pattern or show me the work you need help with.' + (p ? ` I can see your project “${p.name}”.` : ''),
      ),
    };
    return [hello, ...this.store.chat()];
  });

  protected readonly suggestions = computed(() => {
    const ar = this.i18n.isAr();
    const withProject = this.useProject() && !!this.activeProject();
    if (withProject) return ar ? ['اشرحيلي الدور اللي أنا فيه', 'المفروض أوصل لكام غرزة؟', 'إيه اللي فاضل في المشروع؟', 'إيه الفرق بين الزيادة والتنقيص؟'] : ['Explain the round I’m on', 'How many stitches should I have?', 'What’s left in this project?', 'Increase vs decrease?'];
    return ar ? ['إزاي أعمل حلقة سحرية؟', 'إيه الفرق بين الزيادة والتنقيص؟', 'ليه شغلي طالع معوج؟', 'يعني إيه (2sc, inc) x 6؟'] : ['How do I make a magic ring?', 'What’s the difference between increase and decrease?', 'Why is my work crooked?', 'What does (2sc, inc) x 6 mean?'];
  });

  /** One short line under the composer, from the real backend/provider state (never "offline" just because consent is missing). */
  protected readonly statusLine = computed(() => {
    const q = (ar: string, en: string) => this.i18n.q(ar, en);
    const s = this.kh.status();
    switch (this.mode()) {
      case 'ai':
        return s && s.enabled ? `${q('خيوطة متصلة', 'Khayoota is connected')} · ${q('الباقي النهارده', 'left today')} ${s.remaining.chat}` : q('خيوطة متصلة', 'Khayoota is connected');
      case 'demo':
        return q('وضع تجريبي — ردود ثابتة', 'Demo mode — fixed replies');
      case 'consent':
        return q('خيوطة مستنية موافقتك قبل أول سؤال', 'Khayoota needs your OK before the first question');
      case 'soon':
        return this.t().aiSoonNote;
      case 'offline':
        return q('بدون اتصال — شرح من قواعد غرزتك', 'Offline — answers from Gharzetak’s rules');
      default:
        return q('خيوطة غير متاحة حاليًا — شرح من قواعد غرزتك', 'Khayoota is unavailable — answers from Gharzetak’s rules');
    }
  });

  /** The longer explanation, shown in the options sheet when the status line is tapped. */
  protected readonly statusDetail = computed(() => {
    if (this.mode() === 'soon') return `${this.t().aiSoonNote} ${this.t().aiDisclaimer}`;
    if (this.mode() === 'offline' || this.mode() === 'rules') return this.t().aiDisclaimer;
    return this.t().aiHostedNote;
  });

  /** Enter sends (Shift+Enter = new line); an empty draft is never sent. */
  protected onEnter(ev: KeyboardEvent): void {
    if (ev.shiftKey || ev.isComposing) return;
    ev.preventDefault();
    if (this.input().trim()) void this.send(this.input());
  }

  /* ------------------------------------------------------------------ */
  /* sending                                                             */
  /* ------------------------------------------------------------------ */

  protected async send(text: string, img?: { dataUrl: string; image: InlineImage }, purpose: PhotoPurpose = 'diagnose'): Promise<void> {
    const clean = (text || '').trim().slice(0, 2000);
    if ((!clean && !img) || this.typing()) return;
    if (this.kh.needsConsent()) {
      // Ask first; the question is sent only after an explicit "Agree".
      this.pendingAfterConsent = () => void this.send(clean, img, purpose);
      this.pendingQuestion = { text: clean, hadImage: !!img };
      this.sheet.set('consent');
      return;
    }
    this.pendingQuestion = null;
    this.input.set('');
    await this.push({ id: uuid(), role: 'user', text: clean, img: img?.dataUrl });
    this.lastQuestion.set({ text: clean, images: img ? [img.image] : undefined, img: img?.dataUrl, purpose });
    await this.answer(clean, img ? [img.image] : undefined, purpose);
  }

  protected async retry(): Promise<void> {
    const q = this.lastQuestion();
    if (q && !this.typing()) await this.answer(q.text, q.images, q.purpose ?? 'diagnose');
  }

  private async answer(text: string, images: InlineImage[] | undefined, purpose: PhotoPurpose): Promise<void> {
    this.typing.set(true);
    this.busyText.set(images?.length && purpose === 'pattern' ? this.i18n.q('خيوطة بتقرا الصورة…', 'Khayoota is reading the photo…') : this.t().aiThinking);
    try {
      if (this.kh.ready() && (!images?.length || (purpose === 'pattern' ? this.kh.features().extract : this.kh.features().vision))) {
        if (images?.length && purpose === 'pattern') await this.extractPattern(images);
        else await this.hostedChat(text, images);
      } else {
        await this.offline(text, !!images?.length);
      }
    } finally {
      this.typing.set(false);
    }
  }

  private async hostedChat(text: string, images?: InlineImage[]): Promise<void> {
    const p = this.useProject() ? this.activeProject() : null;
    const history = this.store
      .chat()
      .filter((m) => m.text && !m.error)
      .slice(-9, -1)
      .map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), text: m.text.slice(0, 2000) }));
    const calc = calcFacts(text);
    try {
      const res = await this.kh.chat({
        message: text,
        lang: this.i18n.lang(),
        ...(images?.length ? { images, intent: 'diagnose-photo' as const } : {}),
        ...(history.length ? { history } : {}),
        ...(p ? { context: buildKhayootaContext(this.store, p, text) } : {}),
        ...(calc.length ? { calc } : {}),
      });
      const r = res.reply;
      await this.push({
        id: uuid(),
        role: 'bot',
        text: r.text,
        source: this.kh.demoProvider() ? 'demo' : 'ai',
        actions: r.actions,
        observations: r.observations,
        hypotheses: r.hypotheses,
        cannotConfirm: r.cannotConfirm,
        citations: r.citations,
      });
    } catch (e) {
      await this.failed(e, text, !!images?.length);
    }
  }

  private async extractPattern(images: InlineImage[]): Promise<void> {
    try {
      const res = await this.kh.extract({ images }, this.i18n.lang());
      const pv = previewFromTranscript(res.transcript, uuid());
      if (!pv) {
        const cls = res.transcript.sourceClass;
        await this.push({
          id: uuid(),
          role: 'bot',
          source: this.kh.demoProvider() ? 'demo' : 'ai',
          text:
            cls === 'finished-object'
              ? this.i18n.q('دي صورة شغل جاهز، مش باترون مكتوب — مقدرش أطلّع منها الباترون الأصلي. لو عايزة، صوّري صفحة الباترون نفسها.', 'This is a photo of finished work, not a written pattern — I can’t recover the original pattern from it. Photograph the pattern page itself instead.')
              : this.i18n.q('ملقيتش تعليمات باترون أقدر أقراها في الصورة دي. جرّبي صورة أوضح لصفحة الباترون.', 'I couldn’t find pattern instructions to read in this photo. Try a clearer photo of the pattern page.'),
        });
        return;
      }
      this.previews.update((m) => ({ ...m, [pv.id]: pv }));
      const review = pv.counts.needsReview + pv.counts.unsupported;
      // The sentence is filled from the DETERMINISTIC counts, not written by the model.
      await this.push({
        id: uuid(),
        role: 'bot',
        source: this.kh.demoProvider() ? 'demo' : 'ai',
        previewId: pv.id,
        text: this.i18n.q(
          `لقيت باترون فيه ${pv.counts.rounds} دور${review ? `، و${review} منهم محتاجين مراجعة` : ''}. تحبي نجهزه للإضافة؟ 🧶`,
          `I found a pattern with ${pv.counts.rounds} rounds${review ? `; ${review} need review` : ''}. Shall I prepare it for you? 🧶`,
        ),
      });
    } catch (e) {
      await this.failed(e, '', true);
    }
  }

  private async offline(text: string, hasImage: boolean): Promise<void> {
    const reply = text === this.explainText() ? { text: this.ai.explainCurrent() } : await this.ai.ask(text, hasImage);
    await this.push({ id: uuid(), role: 'bot', text: reply.text, source: 'offline' });
  }

  private async failed(e: unknown, text: string, hadImage: boolean): Promise<void> {
    const code: KhayootaErrorCode = e instanceof KhayootaFailure ? e.code : 'unknown';
    if (code === 'ai_consent_required') {
      this.sheet.set('consent');
      return;
    }
    // Friendly error line, then (for text questions) the offline helper so the user is never left without an answer.
    const offline = text && !hadImage ? (await this.ai.ask(text, false)).text : '';
    await this.push({ id: uuid(), role: 'bot', text: offline, error: code, source: offline ? 'offline' : undefined });
  }

  private async push(m: ChatMessage): Promise<void> {
    const follow = m.role === 'user' || (await this.nearBottom());
    await this.store.setChat([...this.store.chat(), m]);
    if (follow) setTimeout(() => void this.content()?.scrollToBottom(220), 30);
  }

  /** True when the reader is within ~1.5 bubbles of the end: someone who scrolled up to read is never yanked down. */
  private async nearBottom(): Promise<boolean> {
    const c = this.content();
    if (!c) return true;
    try {
      const el = await c.getScrollElement();
      return el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    } catch {
      return true;
    }
  }

  /* ------------------------------------------------------------------ */
  /* actions                                                             */
  /* ------------------------------------------------------------------ */

  protected async runAction(a: ResolvedAction): Promise<void> {
    // Re-validate at tap time: the project / piece may have changed since the reply was rendered.
    const again = resolveAction(
      { id: a.kind, v: 1, payload: a.kind === 'learn.explainStitch' ? { stitch: a.stitch } : { projectId: a.projectId, ...(a.instanceId ? { partInstanceId: a.instanceId } : {}) } },
      {
        project: (id) => this.store.project(id) ?? null,
        partLabel: (p, iid) => ((p.parts ?? []).some((i) => i.id === iid && !i.retired) ? iid : null),
      },
    );
    if (!again || a.kind === 'learn.explainStitch') {
      if (!again) await this.ui.say('ده مبقاش متاح.', 'That is no longer available.');
      return;
    }
    const res = await this.trackerNav.open(a.projectId, a.instanceId);
    if (res === 'missing') await this.ui.say('معرفتش أفتحه — المشروع مش موجود.', 'Could not open it — the project no longer exists.');
    if (res === 'done') {
      await this.ui.say('المشروع ده مكتمل — بفتحلك صفحته.', 'This project is finished — opening its page.');
      await this.nav.navigateForward(['/tabs/projects', a.projectId]);
    }
  }

  protected openTopic(topic: string): void {
    void this.nav.navigateForward(['/tabs/learn', topic]);
  }

  /** "إضافة لغرزتك": hands the draft to the REAL editor, unsaved. Nothing is stored until the user presses Save there. */
  protected async addDraft(pv: PatternPreview): Promise<void> {
    this.drafts.offer({
      target: pv.target,
      collectionName: pv.title,
      sourceText: pv.sourceText,
      parts: pv.parts.map((p) => ({ name: p.name, quantity: p.quantity, text: p.text, assemblyNotes: p.notes.join('\n'), status: p.status })),
    });
    await this.nav.navigateForward(pv.target === 'collection' ? '/tabs/home/collections/new' : '/tabs/home/patterns/new');
  }

  protected dropPreview(id: string | undefined): void {
    if (!id) return;
    this.previews.update((m) => {
      const { [id]: _drop, ...rest } = m;
      return rest;
    });
  }

  /* ------------------------------------------------------------------ */
  /* photos                                                              */
  /* ------------------------------------------------------------------ */

  protected photoTap(): void {
    if (this.kh.ready() && (this.kh.features().vision || this.kh.features().extract)) {
      this.sheet.set('photo');
      return;
    }
    if (this.kh.needsConsent()) {
      this.pendingAfterConsent = () => this.sheet.set('photo');
      this.sheet.set('consent');
      return;
    }
    this.photoPurpose = 'diagnose';
    this.fileInput()?.nativeElement.click();
  }

  protected pickPhoto(purpose: PhotoPurpose): void {
    this.photoPurpose = purpose;
    this.sheet.set(null);
    this.fileInput()?.nativeElement.click();
  }

  protected async onPhoto(ev: Event): Promise<void> {
    const el = ev.target as HTMLInputElement;
    const f = el.files?.[0];
    el.value = '';
    if (!f) return;
    // Re-encoded through a canvas: EXIF/GPS metadata is dropped; size is bounded before sending.
    const edge = this.photoPurpose === 'pattern' ? 1568 : 1280;
    let r = await readImageFile(f, edge, this.photoPurpose === 'pattern' ? 0.85 : 0.8);
    if (!('error' in r) && r.dataUrl.length > MAX_B64 + 32) r = await readImageFile(f, 1280, 0.7);
    if ('error' in r) return this.ui.toast(this.t()[r.error]);
    const data = r.dataUrl.slice(r.dataUrl.indexOf(',') + 1);
    if (data.length > MAX_B64) return this.ui.say('الصورة كبيرة قوي — جرّبي صورة تانية.', 'The photo is too large — try another one.');
    const text = this.input().trim();
    await this.send(text, { dataUrl: r.dataUrl, image: { mime: 'image/jpeg', data } }, this.photoPurpose);
  }

  /* ------------------------------------------------------------------ */
  /* consent, menu, misc                                                 */
  /* ------------------------------------------------------------------ */

  protected async acceptConsent(): Promise<void> {
    this.consentBusy.set(true);
    try {
      await this.kh.acceptConsent();
      this.sheet.set(null);
      const next = this.pendingAfterConsent;
      this.pendingAfterConsent = null;
      next?.();
    } catch {
      await this.ui.say('معرفتش أحفظ الموافقة — حاولي تاني.', 'Could not save your choice — try again.');
    } finally {
      this.consentBusy.set(false);
    }
  }

  protected async declineConsent(): Promise<void> {
    this.sheet.set(null);
    const next = this.pendingAfterConsent;
    const q = this.pendingQuestion;
    this.pendingAfterConsent = null;
    this.pendingQuestion = null;
    if (next && q && (q.text || q.hadImage)) {
      // Declined: answer the SAME question with the offline helper (nothing is sent anywhere; a photo is not uploaded).
      if (this.input().trim() === q.text) this.input.set('');
      await this.push({ id: uuid(), role: 'user', text: q.text });
      await this.offline(q.text, q.hadImage);
    }
  }

  protected async withdraw(): Promise<void> {
    this.sheet.set(null);
    await this.kh.withdrawConsent();
    await this.ui.say('اتقفلت خيوطة بالذكاء الاصطناعي. الشرح بدون نت لسه شغال.', 'Khayoota AI is off. The offline helper still works.');
  }

  protected async clearChat(): Promise<void> {
    this.sheet.set(null);
    this.previews.set({});
    await this.store.setChat([]);
  }

  protected signIn(): void {
    void this.nav.navigateForward('/auth/login');
  }

  private explainText(): string {
    return this.i18n.q('اشرحي الدور الحالي', 'Explain my current round');
  }

  protected async explainCurrent(): Promise<void> {
    await this.send(this.explainText());
  }

  protected errorText(code: string): string {
    const q = (ar: string, en: string) => this.i18n.q(ar, en);
    const s = this.kh.status();
    switch (code as KhayootaErrorCode) {
      case 'network':
        return q('مفيش نت دلوقتي — دي إجابة من الشرح بدون نت.', 'No connection right now — here is the offline helper instead.');
      case 'ai_quota_exceeded':
        return s && s.enabled && !s.available
          ? q('خيوطة واخدة راحة لحد بكرة — الضغط كان كبير النهارده.', 'Khayoota is resting until tomorrow — it was a busy day.')
          : q('خلّصنا أسئلة النهارده 🌙 خيوطة هترجع بكرة. العدّاد والشرح بدون نت شغالين عادي.', 'That’s today’s questions 🌙 Khayoota is back tomorrow. The counter and offline helper still work.');
      case 'ai_rate_limited':
        return q('أسئلة كتير ورا بعض — استني دقيقة وجرّبي تاني.', 'Lots of questions in a row — wait a minute and try again.');
      case 'ai_feature_disabled':
        return q('تحليل الصور لسه مش متاح.', 'Photo analysis is not available yet.');
      case 'ai_unsupported_image':
        return q('الصورة دي مش مدعومة — جرّبي JPEG أو PNG.', 'That image type isn’t supported — try a JPEG or PNG.');
      case 'ai_disabled':
        return q('خيوطة مش متاحة دلوقتي.', 'Khayoota isn’t available right now.');
      case 'ai_access_restricted':
        return this.t().aiSoonNote;
      case 'ai_busy':
      case 'ai_timeout':
      case 'ai_upstream_error':
        return q('خيوطة مش قادرة ترد دلوقتي — جرّبي كمان شوية.', 'Khayoota can’t answer right now — try again shortly.');
      case 'ai_bad_output':
        return q('معرفتش أجاوب المرة دي — جرّبي تاني.', 'I couldn’t answer this time — try again.');
      case 'unauthorized':
        return q('انتهت الجلسة — سجّلي الدخول تاني.', 'Your session ended — please sign in again.');
      default:
        return q('حصلت مشكلة — جرّبي تاني.', 'Something went wrong — try again.');
    }
  }

  protected retryable(code: string): boolean {
    return ['network', 'ai_busy', 'ai_timeout', 'ai_upstream_error', 'ai_bad_output', 'unknown'].includes(code);
  }
}
