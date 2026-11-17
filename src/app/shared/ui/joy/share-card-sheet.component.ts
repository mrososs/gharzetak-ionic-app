import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { I18nService } from '../../../core/i18n/i18n.service';
import { SharePrefs, sharePrefsOf } from '../../../core/joy/joy.models';
import { ShareToggle, applicableToggles, buildShareModel } from '../../../core/joy/share-card';
import { ShareCardService } from '../../../core/joy/share-card.service';
import { ShareLauncher } from '../../../core/joy/share-launcher.service';
import { AppStore } from '../../../core/state/app.store';
import { SheetComponent } from '../dialogs/sheet.component';
import { IconComponent } from '../icon/icon.component';

const LABELS: Record<ShareToggle, { ar: string; en: string }> = {
  photo: { ar: 'الصورة', en: 'Photo' },
  avatar: { ar: 'الشخصية', en: 'Avatar' },
  time: { ar: 'الوقت', en: 'Time' },
  parts: { ar: 'القطع', en: 'Pieces' },
  name: { ar: 'اسم المشروع', en: 'Project name' },
};

/** The preview must never spin forever (a very slow device): after this the "share the text instead" state is shown. */
export const RENDER_TIMEOUT_MS = 30_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('render timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * The share-card sheet: an accurate preview, switches for what the card shows, and the Share button.
 * The card is drawn on THIS device when the sheet opens and is only handed to the system share sheet when the user presses Share.
 * Cancelling the system sheet is silent; if the image cannot be shared, the caption goes out as text instead.
 */
@Component({
  selector: 'gz-share-card-sheet',
  imports: [SheetComponent, IconComponent],
  template: `
    <gz-sheet
      [open]="!!launcher.source()"
      [title]="i18n.q('مشاركة التقدّم', 'Share your progress')"
      [description]="i18n.q('اختاري اللي يظهر على الكارت. الكارت بيتعمل على موبايلك ومفيش حاجة بتتبعت غير لما تضغطي مشاركة.', 'Choose what shows on the card. It is made on your phone and nothing is sent until you press Share.')"
      [busy]="busy()"
      (closed)="onClosed()"
    >
      <div class="prev" [class.loading]="state() === 'rendering'">
        @if (previewUrl(); as url) {
          <img [src]="url" [alt]="i18n.q('معاينة كارت المشاركة', 'Share card preview')" decoding="async" />
        } @else if (state() === 'error') {
          <div class="gz-note rose" role="alert"><svg gzIcon="info" size="s" /><span>{{ i18n.q('معرفناش نجهّز الصورة. تقدري تشاركي النص بس.', "We couldn't prepare the image. You can still share the text.") }}</span></div>
        } @else {
          <div class="gz-sk sk" aria-hidden="true"></div>
        }
      </div>

      <div class="gz-chips" role="group" [attr.aria-label]="i18n.q('اللي يظهر على الكارت', 'What the card shows')" style="justify-content: center; margin-top: 12px">
        @for (t of applicable(); track t) {
          <button type="button" class="gz-chip sm" [class.on]="toggles()[t]" [attr.aria-pressed]="toggles()[t]" (click)="toggle(t)">{{ label(t) }}</button>
        }
      </div>

      @if (note(); as n) {
        <div class="gz-note peach mt-3" role="status"><svg gzIcon="info" size="s" /><span>{{ noteText(n) }}</span></div>
      }

      <ng-container gzActions>
        <button type="button" class="gz-btn" [disabled]="busy() || state() === 'rendering'" (click)="share()"><svg gzIcon="send" size="s" />{{ i18n.q('مشاركة', 'Share') }}</button>
        <button type="button" class="gz-btn2" [disabled]="busy()" (click)="shareText()">{{ i18n.q('مشاركة نص بس', 'Share text only') }}</button>
      </ng-container>
    </gz-sheet>
  `,
  styles: `
    .prev { display: flex; justify-content: center; margin-top: 6px; }
    .prev img { display: block; max-width: 100%; max-height: 52vh; aspect-ratio: 4 / 5; border-radius: 20px; box-shadow: var(--gz-shadow-card); background: var(--gz-pink-100); }
    .prev .sk { width: min(100%, 320px); aspect-ratio: 4 / 5; max-height: 52vh; border-radius: 20px; }
    .prev.loading img { opacity: 0.55; }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShareCardSheetComponent implements OnDestroy {
  protected readonly launcher = inject(ShareLauncher);
  protected readonly store = inject(AppStore);
  protected readonly i18n = inject(I18nService);
  private readonly svc = inject(ShareCardService);

  protected readonly toggles = computed<SharePrefs>(() => sharePrefsOf(this.store.prefs()));
  protected readonly applicable = computed(() => {
    const s = this.launcher.source();
    return s ? applicableToggles(s) : [];
  });
  protected readonly model = computed(() => {
    const s = this.launcher.source();
    return s ? buildShareModel(s, this.toggles()) : null;
  });

  protected readonly state = signal<'idle' | 'rendering' | 'ready' | 'error'>('idle');
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly note = signal<'text' | 'failed' | null>(null);

  private blob: Blob | null = null;
  private token = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Re-draw the preview whenever the card (or one of its switches) changes — debounced so quick toggling stays smooth.
    effect(() => {
      const m = this.model();
      untracked(() => this.schedule(m !== null));
    });
  }

  ngOnDestroy(): void {
    this.release();
  }

  protected label(t: ShareToggle): string {
    return LABELS[t][this.i18n.lang()];
  }

  protected noteText(n: 'text' | 'failed'): string {
    return n === 'text'
      ? this.i18n.q('مقدرناش نشارك الصورة، فشاركنا النص بدلها.', "We couldn't share the image, so the text was shared instead.")
      : this.i18n.q('المشاركة ماتمتش. جرّبي تاني أو شاركي النص بس.', "Sharing didn't work. Try again or share the text only.");
  }

  protected toggle(t: ShareToggle): void {
    void this.store.updatePrefs({ share: { [t]: !this.toggles()[t] } });
  }

  private schedule(open: boolean): void {
    if (this.timer) clearTimeout(this.timer);
    if (!open) return this.release();
    this.state.set('rendering');
    const token = ++this.token;
    this.timer = setTimeout(() => void this.draw(token), 120);
  }

  private async draw(token: number): Promise<void> {
    const m = this.model();
    if (!m) return;
    try {
      const blob = await withTimeout(this.svc.render(m), RENDER_TIMEOUT_MS);
      if (token !== this.token) return; // a newer render (or closing the sheet) replaced this one
      this.setBlob(blob);
      this.state.set('ready');
    } catch {
      if (token !== this.token) return;
      this.setBlob(null);
      this.state.set('error');
    }
  }

  private setBlob(blob: Blob | null): void {
    const old = this.previewUrl();
    this.blob = blob;
    this.previewUrl.set(blob ? URL.createObjectURL(blob) : null);
    if (old) URL.revokeObjectURL(old);
  }

  private release(): void {
    this.token++;
    if (this.timer) clearTimeout(this.timer);
    this.setBlob(null);
    this.state.set('idle');
    this.note.set(null);
  }

  protected async share(): Promise<void> {
    const m = this.model();
    if (!m || this.busy()) return;
    this.busy.set(true);
    this.note.set(null);
    try {
      const outcome = await this.svc.share(m, this.blob ?? undefined);
      if (outcome === 'shared') this.launcher.close();
      else if (outcome === 'text') this.note.set('text');
      else if (outcome === 'failed') this.note.set('failed');
      // cancelled: the user simply closed the system sheet — stay here, say nothing
    } finally {
      this.busy.set(false);
    }
  }

  protected async shareText(): Promise<void> {
    const m = this.model();
    if (!m || this.busy()) return;
    this.busy.set(true);
    this.note.set(null);
    try {
      const outcome = await this.svc.shareText(m);
      if (outcome === 'shared') this.launcher.close();
      else if (outcome === 'failed') this.note.set('failed');
    } finally {
      this.busy.set(false);
    }
  }

  protected onClosed(): void {
    this.launcher.close();
  }
}
