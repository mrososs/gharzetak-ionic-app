import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { IonContent, IonFooter, IonHeader } from '@ionic/angular';
import { AssistantService } from '../../core/ai/assistant.service';
import { CAT } from '../../core/data/catalog';
import { parsePattern } from '../../core/domain/pattern-parser';
import { patternContext } from '../../core/domain/tracker-engine';
import { displayInTerms } from '../../core/domain/terminology';
import { I18nService } from '../../core/i18n/i18n.service';
import { ChatMessage } from '../../core/models/models';
import { AppStore } from '../../core/state/app.store';
import { uuid } from '../../core/state/factories';
import { readImageFile } from '../../core/utils/image';
import { projectCard } from '../../shared/project-view';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PhotoComponent } from '../../shared/ui/images/photo.component';

/** GZ-S21 assistant · GZ-T04 conversation — demo mode unless an Edge Function is configured. */
@Component({
  selector: 'gz-assistant',
  imports: [IonHeader, IonContent, IonFooter, IconComponent, PhotoComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top" style="padding-top: calc(18px + var(--gz-safe-top))">
        <div class="gz-tile t-lav" style="width: 46px; height: 46px"><svg gzIcon="sparkles" /></div>
        <div class="flex min-w-0 flex-1 flex-col"><h1 class="gz-hd m-0" style="font-size: 18px">{{ t().aiTitle }}</h1><span class="gz-xs gz-mute">{{ t().aiSub }}</span></div>
        @if (!ai.connected) {
          <span class="gz-badge rose">{{ t().demoBadge }}</span>
        }
      </div>
      <div style="padding: 0 20px 8px">
        <div class="gz-card" style="padding: 10px 12px; border: 1.5px solid var(--gz-border); box-shadow: none">
          <div class="flex items-center gap-2.5">
            <gz-photo class="flex-none" [tone]="ctx().tone" [src]="ctx().img" [storagePath]="ctx().path" [alt]="ctx().name" [showLabel]="false" iconSize="s" height="44px" width="44px" extraClass="r16" />
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="gz-xs gz-mute gz-b">{{ t().aiContext }}</span>
              <span class="gz-b truncate" style="font-size: 14px">{{ ctx().name }}</span>
              <span class="gz-xs gz-mute truncate">{{ ctx().line }}</span>
            </div>
            <button type="button" class="gz-btn3" style="min-height: 44px; padding: 0 12px; font-size: 13px" (click)="explainCurrent()">{{ t().explainCur }}</button>
          </div>
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
            @if (m.role === 'bot' && m.id !== 'hello' && !ai.connected) {
              <span class="gz-xs" style="color: var(--gz-pink-ink); font-weight: 700; padding-inline: 6px">{{ t().demoReply }}</span>
            }
          </div>
        }
        @if (typing()) {
          <div class="gz-msg a gz-mute" [style.align-self]="i18n.isAr() ? 'flex-end' : 'flex-start'" role="status">{{ t().typing }}</div>
        }
      </div>
    </ion-content>

    <ion-footer class="ion-no-border" style="background: var(--gz-bg)">
      <div style="padding: 4px 0 calc(8px + var(--gz-safe-bottom))">
        <div class="gz-hs" style="padding-block: 2px">
          @for (q of suggestions(); track q) {
            <button type="button" class="gz-chip sm tint" (click)="send(q)">{{ q }}</button>
          }
        </div>
        <div class="flex items-center gap-2 px-5">
          <label class="gz-icb flat" style="cursor: pointer" [attr.aria-label]="t().attachPhoto">
            <input class="gz-sr" type="file" accept="image/*" (change)="onPhoto($event)" /><svg gzIcon="camera" />
          </label>
          <div class="gz-in flex-1" style="min-height: 48px; padding: 0 6px 0 14px">
            <input type="text" [value]="input()" (input)="input.set($any($event.target).value)" (keydown.enter)="send(input())" [placeholder]="t().askPh" [attr.aria-label]="t().askPh" enterkeyhint="send" style="height: 46px" />
          </div>
          <button type="button" class="gz-icb pur" (click)="send(input())" [attr.aria-label]="t().send"><svg gzIcon="send" /></button>
        </div>
        <div class="gz-xs gz-mute px-6 pt-1.5 text-center">{{ ai.connected ? '' : t().aiDisclaimer }}</div>
      </div>
    </ion-footer>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssistantPage {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(AppStore);
  protected readonly ai = inject(AssistantService);
  private readonly ui = inject(UiFeedback);

  protected readonly t = this.i18n.t;
  protected readonly input = signal('');
  protected readonly typing = signal(false);

  protected readonly ctx = computed(() => {
    const p = this.store.currentProject();
    if (!p) return { name: this.i18n.q('مفيش مشروع نشط', 'No active project'), line: '—', tone: CAT.amigurumi.tone, img: '', path: null as string | null };
    const card = projectCard(this.store, this.i18n, p);
    let line = `${this.i18n.q('الدور ', 'Round ')}${p.tracker.simple.round} · ${p.tracker.simple.count}/${p.tracker.simple.target}`;
    const pat = p.tracker.mode === 'pattern' ? this.store.pattern(p.tracker.patternId) : null;
    if (pat) {
      const c = patternContext(parsePattern(pat.text), p.tracker.cursor);
      if (c) line = `R${c.round.n} · ${displayInTerms(c.round.raw, pat.terms, this.store.viewTerms())}`;
    }
    return { name: p.name, line, tone: card.tone, img: card.img, path: card.storagePath };
  });

  protected readonly messages = computed<ChatMessage[]>(() => {
    const p = this.store.currentProject();
    const name = this.store.profile().displayName || this.i18n.q('صديقتي', 'friend');
    const hello: ChatMessage = {
      id: 'hello',
      role: 'bot',
      text: this.i18n.q(
        `أهلاً ${name}! أنا مساعدك${this.ai.connected ? '' : ' التجريبي'} للكروشيه. ` + (p ? `شايفة إن مشروعك الحالي «${p.name}». ` : '') + 'اسأليني أو اضغطي على سؤال من تحت.',
        `Hi ${name}! I'm your${this.ai.connected ? '' : ' demo'} crochet assistant. ` + (p ? `I can see your current project is "${p.name}". ` : '') + 'Ask me something or tap a question below.',
      ),
    };
    return [hello, ...this.store.chat()];
  });

  protected readonly suggestions = computed(() =>
    this.i18n.isAr()
      ? ['إزاي أعمل غرزة حشو؟', 'إيه الفرق بين الزيادة والتنقيص؟', 'ليه شغلي طالع معوج؟', 'اشرحلي الدور الخامس.', 'إزاي أعرف لو عدد الغرز صح؟']
      : ['How do I stuff my work?', "What's the difference between increase and decrease?", 'Why is my work coming out crooked?', 'Explain round 5.', 'How do I know my stitch count is right?'],
  );

  protected async send(text: string, img?: string): Promise<void> {
    const clean = (text || '').trim();
    if ((!clean && !img) || this.typing()) return;
    this.input.set('');
    await this.store.setChat([...this.store.chat(), { id: uuid(), role: 'user', text: clean, img }]);
    this.typing.set(true);
    const reply = await this.ai.ask(clean, !!img);
    await new Promise((r) => setTimeout(r, 450));
    this.typing.set(false);
    await this.store.setChat([...this.store.chat(), { id: uuid(), role: 'bot', text: reply.text }]);
  }

  protected async explainCurrent(): Promise<void> {
    await this.store.setChat([...this.store.chat(), { id: uuid(), role: 'user', text: this.i18n.q('اشرحي الدور الحالي', 'Explain my current round') }]);
    this.typing.set(true);
    await new Promise((r) => setTimeout(r, 450));
    this.typing.set(false);
    await this.store.setChat([...this.store.chat(), { id: uuid(), role: 'bot', text: this.ai.explainCurrent() }]);
  }

  protected async onPhoto(ev: Event): Promise<void> {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const r = await readImageFile(f, 600, 0.7);
    if ('error' in r) return this.ui.toast(this.t()[r.error]);
    await this.send('', r.dataUrl);
  }
}
