import { Injectable, inject, signal } from '@angular/core';
import { projectCompletion } from '../domain/collections';
import { formatMinutes } from '../domain/time';
import { I18nService } from '../i18n/i18n.service';
import { AppStore } from '../state/app.store';
import { ShareSource } from './share-card';
import { SHARE_HEADLINE, achievementSource, progressHeadline, projectSource } from './share-source';

/**
 * Opens the share-card sheet. Sharing is ALWAYS started by the user: every entry point is a button the user pressed, and the card is
 * only rendered after that. Nothing here talks to a server.
 */
@Injectable({ providedIn: 'root' })
export class ShareLauncher {
  private readonly store = inject(AppStore);
  private readonly i18n = inject(I18nService);

  /** The card being previewed (null = the sheet is closed). */
  readonly source = signal<ShareSource | null>(null);

  open(src: ShareSource | null): void {
    if (src) this.source.set(src);
  }

  close(): void {
    this.source.set(null);
  }

  /** "Share progress" for a project: overall percentage, finished pieces, recorded time. */
  progress(projectId: string): void {
    const p = this.store.project(projectId);
    if (!p) return;
    const lang = this.i18n.lang();
    const pr = this.store.progress(p);
    const c = p.parts?.length ? projectCompletion(p.parts, p.partSnapshots ?? []) : null;
    this.open(
      projectSource({
        kind: p.status === 'done' ? 'project' : 'progress',
        lang,
        avatarId: this.store.avatar(),
        headline: p.status === 'done' ? SHARE_HEADLINE.project[lang] : progressHeadline(pr.pct, lang),
        project: p,
        pct: p.status === 'done' ? null : pr.pct,
        pieces: c ? { done: c.doneCount, total: c.total } : null,
        formatTime: (s) => formatMinutes(Math.floor(s / 60), lang),
      }),
    );
  }

  /** A personal badge (never anything about a project). */
  achievement(id: string): void {
    this.open(achievementSource(id, this.i18n.lang(), this.store.avatar()));
  }
}
