import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { IonContent, IonHeader, NavController } from '@ionic/angular';
import { VCAT_N, VIDEOS, VLVL } from '../../core/data/catalog';
import { photo } from '../../core/data/photos';
import { parsePattern } from '../../core/domain/pattern-parser';
import { convertToken } from '../../core/domain/terminology';
import { patternContext, patternStats, patternTap, patternUndo, simpleNextAmount, simpleNextRound, simpleRoundComplete, simpleTap, simpleUndo } from '../../core/domain/tracker-engine';
import { I18nService } from '../../core/i18n/i18n.service';
import { AppStore } from '../../core/state/app.store';
import { uuid } from '../../core/state/factories';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { PhotoComponent } from '../../shared/ui/images/photo.component';
import { youtubeEmbedUrl, youtubeId, youtubeWatchUrl } from './youtube';

const pad2 = (n: number) => (n < 10 ? '0' + n : '' + n);
const fmtMS = (s: number) => pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);

/** GZ-S20 — tutorial detail: YouTube link/embed, creator credit, timestamps, notes, companion counter. */
@Component({
  selector: 'gz-video-detail',
  imports: [IonHeader, IonContent, IconComponent, PhotoComponent],
  templateUrl: './video-detail.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoDetailPage implements OnDestroy {
  protected readonly i18n = inject(I18nService);
  protected readonly store = inject(AppStore);
  protected readonly nav = inject(NavController);
  private readonly ui = inject(UiFeedback);
  private readonly sanitizer = inject(DomSanitizer);
  readonly id = input.required<string>();

  protected readonly t = this.i18n.t;
  protected readonly clock = signal(0);
  protected readonly clockOn = signal(false);
  protected readonly tsNote = signal('');
  protected readonly embedStart = signal(0);
  private iv: ReturnType<typeof setInterval> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly v = computed(() => VIDEOS.find((x) => x.id === this.id()) ?? VIDEOS[0]);
  protected readonly d = computed(() => this.store.tutorial(this.v().id));
  protected readonly vm = computed(() => {
    const v = this.v();
    const lang = this.i18n.lang();
    return {
      title: lang === 'ar' ? v.ar : v.en,
      desc: lang === 'ar' ? v.dAr : v.dEn,
      tone: v.tone,
      img: photo('vid_' + v.id),
      lvlName: VLVL[v.lvl][lang],
      lvlCls: VLVL[v.lvl].cls,
      catName: VCAT_N[v.cat][lang],
      fav: this.store.favorites().includes(v.id),
      searchUrl: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(v.q),
    };
  });
  protected readonly ytId = computed(() => youtubeId(this.d().link));
  protected readonly embed = computed<SafeResourceUrl | null>(() => {
    const id = this.ytId();
    // Only a validated 11-char video id ever reaches the iframe src.
    return id ? this.sanitizer.bypassSecurityTrustResourceUrl(youtubeEmbedUrl(id, this.embedStart())) : null;
  });
  protected readonly linkedProject = computed(() => this.store.project(this.d().projectId) ?? this.store.currentProject());
  protected readonly projChoices = computed(() => this.store.projects().filter((x) => x.status !== 'done'));
  protected readonly stamps = computed(() => this.d().stamps.map((s) => ({ ...s, time: fmtMS(s.sec) })));
  protected readonly clockText = computed(() => fmtMS(this.clock()));

  protected readonly counter = computed(() => {
    const p = this.linkedProject();
    if (!p) return null;
    const t = p.tracker;
    if (t.mode === 'pattern') {
      const pat = this.store.pattern(t.patternId);
      const parsed = pat ? parsePattern(pat.text) : null;
      const ctx = parsed ? patternContext(parsed, t.cursor) : null;
      const st = parsed ? patternStats(parsed, t.cursor) : null;
      if (pat && parsed && ctx && st) {
        const next = parsed.rounds[ctx.roundIndex + 1];
        return {
          name: p.name,
          main: `${st.produced}/${st.roundProduced}`,
          sub: `R${st.roundNumber} · ${st.actionsDone}/${st.actionsTotal}`,
          label: st.roundComplete ? (ctx.isLastRound ? '✓' : 'R' + (next?.n ?? '')) : convertToken(ctx.round.acts[ctx.ptr].k, pat.terms, this.store.viewTerms()),
          disabled: st.patternComplete,
        };
      }
    }
    const s = t.simple;
    const done = simpleRoundComplete(s);
    return {
      name: p.name,
      main: `${s.count}/${s.target}`,
      sub: `${this.i18n.q('الدور ', 'Round ')}${s.round} · +${s.perTap}`,
      label: done ? this.i18n.q('التالي', 'Next') : '+' + simpleNextAmount(s),
      disabled: false,
    };
  });

  ngOnDestroy(): void {
    if (this.iv) clearInterval(this.iv);
  }

  protected toggleFav(): void {
    void this.store.toggleFavorite(this.v().id);
  }

  protected onLink(ev: Event): void {
    this.debouncedSave({ link: (ev.target as HTMLInputElement).value.trim().slice(0, 500) });
  }
  protected onCreator(ev: Event): void {
    this.debouncedSave({ creator: (ev.target as HTMLInputElement).value.slice(0, 120) });
  }
  protected onNotes(ev: Event): void {
    this.debouncedSave({ notes: (ev.target as HTMLTextAreaElement).value.slice(0, 10000) });
  }
  private pending: Record<string, unknown> = {};
  private debouncedSave(patch: Record<string, unknown>): void {
    this.pending = { ...this.pending, ...patch };
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.store.updateTutorial(this.v().id, this.pending);
      this.pending = {};
    }, 400);
  }

  protected linkProject(id: string): void {
    void this.store.updateTutorial(this.v().id, { projectId: id });
  }

  protected tap(): void {
    const p = this.linkedProject();
    if (!p) return;
    const t = p.tracker;
    if (t.mode === 'pattern') {
      const pat = this.store.pattern(t.patternId);
      if (pat) {
        const parsed = parsePattern(pat.text);
        void this.store.updateTracker(p.id, (x) => ({ ...x, cursor: patternTap(parsed, x.cursor) }));
        return;
      }
    }
    void this.store.updateTracker(p.id, (x) => ({ ...x, simple: simpleRoundComplete(x.simple) ? simpleNextRound(x.simple) : simpleTap(x.simple) }));
  }
  protected undo(): void {
    const p = this.linkedProject();
    if (p) void this.store.updateTracker(p.id, (x) => (x.mode === 'pattern' && x.patternId ? { ...x, cursor: patternUndo(x.cursor) } : { ...x, simple: simpleUndo(x.simple) }));
  }

  /* practice clock (manual — it does not read the YouTube player) */
  protected toggleClock(): void {
    if (this.clockOn()) {
      this.clockOn.set(false);
      if (this.iv) clearInterval(this.iv);
      this.iv = null;
    } else {
      this.clockOn.set(true);
      this.iv = setInterval(() => this.clock.update((s) => s + 1), 1000);
    }
  }
  protected shift(by: number): void {
    this.clock.update((s) => Math.max(0, s + by));
  }
  protected resetClock(): void {
    if (this.clockOn()) this.toggleClock();
    this.clock.set(0);
  }

  protected async saveStamp(): Promise<void> {
    const sec = this.clock();
    const note = this.tsNote().trim() || this.i18n.q('لحظة محفوظة', 'Saved moment');
    const stamps = [...this.d().stamps, { id: uuid(), sec, note: note.slice(0, 300) }].sort((a, b) => a.sec - b.sec);
    await this.store.updateTutorial(this.v().id, { stamps });
    this.tsNote.set('');
    await this.ui.say('تم حفظ اللحظة ' + fmtMS(sec), 'Timestamp ' + fmtMS(sec) + ' saved');
  }

  protected resumeAt(sec: number): void {
    const id = this.ytId();
    if (id) {
      // Play inside the official embed from that moment; long-press/open also available.
      this.embedStart.set(sec);
      return;
    }
    this.clock.set(sec);
    void this.ui.say('المؤقّت اتضبط على ' + fmtMS(sec) + ' — كمّلي من هنا على يوتيوب.', 'Timer set to ' + fmtMS(sec) + ' — seek there on YouTube.');
  }

  protected openAt(sec: number): string | null {
    const id = this.ytId();
    return id ? youtubeWatchUrl(id, sec) : null;
  }

  protected deleteStamp(id: string): void {
    void this.store.updateTutorial(this.v().id, { stamps: this.d().stamps.filter((s) => s.id !== id) });
  }
}
