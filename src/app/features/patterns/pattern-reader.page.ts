import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { IonContent, IonHeader, NavController } from '@ionic/angular';
import { AssistantService } from '../../core/ai/assistant.service';
import { parsePattern } from '../../core/domain/pattern-parser';
import { displayInTerms } from '../../core/domain/terminology';
import { I18nService } from '../../core/i18n/i18n.service';
import { AppStore } from '../../core/state/app.store';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';

/** GZ-S17 — round-by-round pattern reader with saved reading position. */
@Component({
  selector: 'gz-pattern-reader',
  imports: [IonHeader, IonContent, IconComponent],
  template: `
    <ion-header class="gz-header ion-no-border">
      <div class="gz-top">
        <button type="button" class="gz-icb" (click)="nav.back()" [attr.aria-label]="t().back"><svg gzIcon="arrowl" [flip]="true" /></button>
        <h1 class="gz-ttl gz-hd" style="font-size: 16px">{{ pat() ? store.patternName(pat()!) : '' }}</h1>
        <button type="button" class="gz-icb" (click)="nav.navigateForward('/tabs/home/terms')" [attr.aria-label]="t().terminology"><svg gzIcon="convert" /></button>
      </div>
    </ion-header>
    <ion-content class="gz-scroll">
      @if (pat(); as pat) {
        <div class="gz-pad">
          <div class="flex flex-wrap gap-1.5" style="margin: 2px 0 10px">
            <span class="gz-badge {{ pat.isSample ? 'sage' : '' }}">{{ pat.isSample ? i18n.q('نموذج', 'Sample') : pat.source.toUpperCase() }}</span>
            <span class="gz-badge">{{ store.levelName(pat.level) }}</span>
            <span class="gz-badge peach">{{ meta() }}</span>
          </div>
          @if (pat.attribution || pat.sourceUrl) {
            <p class="gz-xs gz-mute mb-2">
              © {{ pat.attribution }}
              @if (pat.sourceUrl) {
                · <a [href]="pat.sourceUrl" target="_blank" rel="noopener noreferrer" class="gz-ltr">{{ pat.sourceUrl }}</a>
              }
            </p>
          }
          <div class="gz-seg" role="tablist" [attr.aria-label]="t().terminology">
            <button type="button" [class.on]="store.viewTerms() === 'us'" (click)="store.readerTerms.set('us')">{{ t().us }}</button>
            <button type="button" [class.on]="store.viewTerms() === 'uk'" (click)="store.readerTerms.set('uk')">{{ t().uk }}</button>
          </div>
          @if (pat.terms !== store.viewTerms()) {
            <p class="gz-xs gz-mute mx-0.5 mt-1.5">
              {{ i18n.q('الباترن مكتوب بنظام ' + pat.terms.toUpperCase() + ' وبيتعرض بنظام ' + store.viewTerms().toUpperCase() + ' (المحوّل بيغيّر sc/hdc/dc/tr فقط).', 'Written in ' + pat.terms.toUpperCase() + ' terms, shown in ' + store.viewTerms().toUpperCase() + ' (only sc/hdc/dc/tr are converted).') }}
            </p>
          }

          @if (!pat.text) {
            <div class="gz-card soft mt-3.5">
              <div class="flex items-center gap-3">
                <div class="gz-tile t-blush" style="width: 48px; height: 48px"><svg [gzIcon]="pat.source === 'image' ? 'image' : 'file'" /></div>
                <div class="flex-1"><div class="gz-b">{{ pat.file?.name }}</div><div class="gz-xs gz-mute">{{ fileMeta() }}</div></div>
              </div>
              <div class="gz-note mt-3"><svg gzIcon="info" size="s" /><span>{{ t().notConnected }}</span></div>
              <label class="gz-lbl" for="pr-paste">{{ t().pasteToRead }}</label>
              <textarea id="pr-paste" class="gz-ta gz-ltr" dir="ltr" style="min-height: 110px" [value]="paste()" (input)="paste.set($any($event.target).value)" placeholder="R1: 6sc in MR [6]"></textarea>
              <button type="button" class="gz-btn3 w mt-2" (click)="applyPaste()">{{ t().makeReadable }}</button>
            </div>
          } @else {
            <div class="gz-sec" style="margin-top: 16px"><h2 class="gz-h3 gz-hd">{{ t().linkToProject }}</h2></div>
            <div class="gz-hs" style="margin-top: -4px">
              @for (x of projChoices(); track x.id) {
                <button type="button" class="gz-chip sm" [class.on]="x.on" [attr.aria-pressed]="x.on" (click)="toggleLink(x.id, x.on)">{{ x.name }}</button>
              }
            </div>

            @if (cur(); as r) {
              <div class="gz-card focus mt-2">
                <div class="flex items-center justify-between"><span class="gz-badge dark">{{ t().readingMode }}</span><span class="gz-xs gz-b" style="color: var(--gz-mint-ink)">{{ i18n.q('اتحفظ موضع القراءة · R', 'Position saved · R') }}{{ r.n }}</span></div>
                <div class="flex items-center gap-2" style="margin: 10px 0 4px"><span class="gz-hd" style="font-size: 28px; color: var(--gz-primary)">R{{ r.n }}</span><span class="gz-xs gz-mute flex-1">{{ pos() + 1 }} / {{ parsed().rounds.length }}</span></div>
                <div class="gz-code" style="font-size: 20px">{{ code(r.raw) }}</div>
                <p style="margin: 10px 0 0; font-size: 15px; line-height: 1.7; white-space: pre-line">{{ explain() }}</p>
                <div class="mt-2.5 flex flex-wrap gap-1.5">
                  @if (r.ok) {
                    <span class="gz-badge peach gz-ltr">{{ i18n.q('مستهلك: ', 'In: ') }}{{ r.cons }}</span><span class="gz-badge sage gz-ltr">{{ i18n.q('ناتج: ', 'Out: ') }}{{ r.prod }}</span>
                  }
                  <span class="gz-badge {{ chainCls() }}">{{ chainText() }}</span>
                </div>
                <div class="mt-3.5 flex gap-2.5">
                  <button type="button" class="gz-btn3" style="width: 58px; padding: 0" (click)="setPos(pos() - 1)" [disabled]="pos() === 0" [attr.aria-label]="t().prevRound"><svg gzIcon="chevr" [style.transform]="i18n.isAr() ? 'none' : 'scaleX(-1)'" /></button>
                  <button type="button" class="gz-btn flex-1" style="min-height: 50px; box-shadow: none" (click)="setPos(pos() + 1)" [disabled]="pos() >= parsed().rounds.length - 1">{{ t().nextRound }}<svg gzIcon="arrow" [flip]="true" /></button>
                </div>
              </div>
              @if (incDec()) {
                <div class="gz-note lav mt-3"><svg gzIcon="info" size="s" /><span style="white-space: pre-line">{{ incDec() }}</span></div>
              }
            }

            <button type="button" class="gz-btn mt-3.5" (click)="track()"><svg gzIcon="counter" />{{ t().trackThis }}</button>
            @if (!linked().length || !parsed().ok) {
              <p class="gz-xs gz-mute mt-1.5 text-center">{{ t().trackHint }}</p>
            }

            <div class="gz-sec"><h2 class="gz-h3 gz-hd">{{ t().allRounds }}</h2></div>
            <div class="flex flex-col gap-2.5">
              @for (r of parsed().rounds; track $index; let i = $index) {
                <button type="button" class="gz-rcard" [class.cur]="i === pos()" (click)="setPos(i)" [attr.aria-label]="t().roundWord + ' ' + r.n" [attr.aria-current]="i === pos() ? 'step' : null">
                  <div class="flex items-start gap-3">
                    <div class="gz-hd gz-tile" style="width: 46px; height: 46px; font-size: 15px" [style.background]="i === pos() ? 'var(--gz-primary)' : 'var(--gz-lavender-200)'" [style.color]="i === pos() ? '#fff' : 'var(--gz-text)'">R{{ r.n }}</div>
                    <div class="flex min-w-0 flex-1 flex-col gap-1">
                      <div class="gz-code" style="font-size: 15px">{{ code(r.raw) }}</div>
                      <div class="gz-xs gz-mute gz-ltr">{{ r.ok ? r.cons + ' → ' + r.prod + (r.declared !== null ? '   [' + r.declared + ']' : '') : '?' }}</div>
                      @if (warn(i); as w) {
                        <div class="gz-err" style="margin: 0">{{ w }}</div>
                      }
                    </div>
                    @if (i === pos()) {
                      <svg gzIcon="bookmark" style="color: var(--gz-primary)" />
                    }
                  </div>
                </button>
              }
            </div>
            @if (!pat.isSample) {
              <button type="button" class="gz-btn3 rose w mt-6" (click)="remove()"><svg gzIcon="trash" size="s" />{{ t().deletePattern }}</button>
            }
          }
        </div>
      }
    </ion-content>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PatternReaderPage {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(AppStore);
  protected readonly nav = inject(NavController);
  private readonly ai = inject(AssistantService);
  private readonly ui = inject(UiFeedback);
  readonly id = input.required<string>();

  protected readonly t = this.i18n.t;
  protected readonly paste = signal('');
  protected readonly pat = computed(() => this.store.pattern(this.id()));
  protected readonly parsed = computed(() => parsePattern(this.pat()?.text ?? ''));
  protected readonly pos = computed(() => Math.max(0, Math.min(this.pat()?.position ?? 0, Math.max(0, this.parsed().rounds.length - 1))));
  protected readonly cur = computed(() => this.parsed().rounds[this.pos()]);
  protected readonly linked = computed(() => this.store.projects().filter((x) => x.tracker.patternId === this.id()));
  protected readonly projChoices = computed(() => this.store.projects().filter((x) => x.status !== 'done').map((x) => ({ id: x.id, name: x.name, on: x.tracker.patternId === this.id() })));
  protected readonly meta = computed(() => {
    const p = this.parsed();
    const q = (a: string, e: string) => this.i18n.q(a, e);
    if (!this.pat()?.text) return this.pat()?.file?.name ?? '';
    return `${p.rounds.length} ${q('أدوار', 'rounds')}` + (p.ok ? ` · ${p.total} ${q('غرزة ناتجة', 'output stitches')}` : ` · ${p.bad} ${q('غير مدعوم', 'unsupported')}`);
  });
  protected readonly fileMeta = computed(() => {
    const f = this.pat()?.file;
    return f ? `${Math.round(f.size / 1024)} KB · ${this.pat()!.source === 'pdf' ? 'PDF' : this.i18n.q('صورة', 'Image')}` : '';
  });
  protected readonly explain = computed(() => this.ai.explainRound(this.cur(), this.pat()));
  protected readonly incDec = computed(() => {
    const r = this.cur();
    if (!r?.ok) return '';
    const inc = r.acts.some((a) => a.k === 'inc');
    const dec = r.acts.some((a) => a.k === 'dec');
    return [
      inc ? this.i18n.q('الزيادة (inc): غرزتين في نفس الغرزة — بتاخدي 1 وبتطلّعي 2.', 'Increase (inc): two stitches in one stitch — consumes 1, produces 2.') : '',
      dec ? this.i18n.q('التنقيص (dec): ضم غرزتين — بتاخدي 2 وبتطلّعي 1.', 'Decrease (dec): join two stitches — consumes 2, produces 1.') : '',
    ]
      .filter(Boolean)
      .join('\n');
  });
  protected readonly chainText = computed(() => {
    const r = this.cur();
    const q = (a: string, e: string) => this.i18n.q(a, e);
    if (!r || !r.ok) return q('غير مدعوم', 'Unsupported');
    if (r.mismatch) return `[${r.declared}] ≠ ${r.prod}`;
    if (r.chain === 'bad') return q('لا يطابق الدور السابق', 'Does not match previous round');
    return r.declared !== null ? `[${r.declared}] ✓` : '✓';
  });
  protected readonly chainCls = computed(() => {
    const r = this.cur();
    return !r || !r.ok || r.mismatch || r.chain === 'bad' ? 'rose' : 'sage';
  });

  protected code(raw: string): string {
    const p = this.pat();
    return p ? displayInTerms(raw, p.terms, this.store.viewTerms()) : raw;
  }

  protected warn(i: number): string {
    const x = this.parsed().rounds[i];
    const q = (a: string, e: string) => this.i18n.q(a, e);
    if (!x.ok) return q('صيغة غير مدعومة', 'Unsupported syntax');
    if (x.mismatch) return q(`المجموع المكتوب [${x.declared}] لا يطابق الحساب ${x.prod}`, `Written total [${x.declared}] differs from computed ${x.prod}`);
    if (x.chain === 'bad') return q('الدور السابق أنتج رقم مختلف عن المستهلك هنا', 'The previous round produced a different number than this one consumes');
    return '';
  }

  protected setPos(i: number): void {
    const n = this.parsed().rounds.length;
    const pos = Math.max(0, Math.min(i, Math.max(0, n - 1)));
    // reading position is saved locally; synced for user patterns (samples keep it on device)
    void this.store.updatePattern(this.id(), (p) => ({ ...p, position: pos }));
  }

  protected async toggleLink(projectId: string, on: boolean): Promise<void> {
    const n = this.parsed().rounds.length;
    await this.store.updateTracker(projectId, (t) =>
      on ? { ...t, patternId: null, mode: 'simple' } : { ...t, patternId: this.id(), mode: 'pattern', cursor: { ...t.cursor, roundIndex: 0, ptr: 0, history: [] }, simple: { ...t.simple, totalRounds: n } },
    );
    await this.store.updateProject(projectId, (x) => x);
    await this.ui.say(on ? 'تم فكّ الربط' : 'تم ربط الباترن بالمشروع', on ? 'Unlinked' : 'Pattern linked to the project');
  }

  protected async track(): Promise<void> {
    if (!this.parsed().ok) return this.ui.say('فيه أدوار غير مدعومة في الباترن ده', 'This pattern has unsupported rounds');
    const linked = this.linked();
    const target = linked.find((x) => x.id === this.store.currentProjectId()) ?? linked[0];
    if (!target) return this.ui.say('اربطي الباترن بمشروع الأول', 'Link the pattern to a project first');
    const pos = this.pos();
    await this.store.updateTracker(target.id, (t) => ({ ...t, mode: 'pattern', cursor: { ...t.cursor, roundIndex: pos, ptr: 0, history: [] } }));
    await this.store.setCurrentProject(target.id);
    await this.nav.navigateRoot('/tabs/tracker');
  }

  protected async applyPaste(): Promise<void> {
    const txt = this.paste().trim();
    if (!txt) return this.ui.say('الصقي النص الأول', 'Paste the text first');
    await this.store.updatePattern(this.id(), (p) => ({ ...p, text: txt.slice(0, 20000), position: 0 }));
    this.paste.set('');
    await this.ui.say('بقى الباترن قابل للقراءة', 'The pattern is now readable');
  }

  protected async remove(): Promise<void> {
    const t = this.t();
    if (!(await this.ui.confirm(t.deletePattern + '?', '', t.delete))) return;
    await this.store.deletePattern(this.id());
    await this.nav.navigateBack('/tabs/home/patterns');
  }
}
