import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { Pattern, Project } from '../models/models';
import { AppStore } from '../state/app.store';
import { uuid } from '../state/factories';
import { LocalDb } from '../storage/local-db';
import { SyncService } from './sync.service';

export interface ImportReport {
  imported: number;
  duplicates: number;
}

/**
 * Moves guest-mode data into a signed-in account — only when the user explicitly agrees.
 * Rules:
 *  - never overwrites an existing account project: an id collision is treated as "already imported"
 *    when the content is identical, otherwise the guest copy is imported under a new id;
 *  - custom guest patterns are copied first so project → pattern links stay valid;
 *  - the guest scope is cleared only after every item was written locally and queued for sync.
 */
@Injectable({ providedIn: 'root' })
export class GuestImportService {
  private readonly db = inject(LocalDb);
  private readonly store = inject(AppStore);
  private readonly auth = inject(AuthService);
  private readonly sync = inject(SyncService);

  readonly guestProjectCount = signal(0);

  async refresh(): Promise<number> {
    if (!this.auth.signedIn()) return 0;
    const n = (await this.db.loadProjects('guest')).length;
    this.guestProjectCount.set(n);
    return n;
  }

  async importGuestData(): Promise<ImportReport> {
    if (!this.auth.signedIn()) return { imported: 0, duplicates: 0 };
    const [projects, patterns] = await Promise.all([this.db.loadProjects('guest'), this.db.loadPatterns('guest')]);
    const report: ImportReport = { imported: 0, duplicates: 0 };
    const patternIdMap = new Map<string, string>();

    for (const pat of patterns.filter((p) => !p.isSample)) {
      const existing = this.store.pattern(pat.id);
      if (existing && existing.text === pat.text && existing.name === pat.name) {
        patternIdMap.set(pat.id, pat.id);
        continue;
      }
      const id = existing ? uuid() : pat.id;
      patternIdMap.set(pat.id, id);
      const copy: Pattern = { ...pat, id, updatedAt: Date.now() };
      await this.store.addPattern(copy);
    }

    for (const p of projects) {
      const existing = this.store.project(p.id);
      if (existing && sameProject(existing, p)) {
        report.duplicates++;
        continue;
      }
      const id = existing ? uuid() : p.id;
      const pid = p.tracker.patternId ? (patternIdMap.get(p.tracker.patternId) ?? p.tracker.patternId) : null;
      const copy: Project = {
        ...p,
        id,
        coverPath: null,
        photos: p.photos.map((ph) => ({ ...ph, storagePath: null })),
        updatedAt: Date.now(),
        tracker: { ...p.tracker, patternId: pid, updatedAt: Date.now() },
      };
      await this.store.addProject(copy);
      await this.store.updateProject(copy.id, (x) => x, ['note']);
      for (const ph of copy.photos) {
        if (ph.localUrl) await this.db.enqueue({ scope: this.store.scope(), kind: 'photo', id: ph.id, op: 'upsert', payload: { projectId: copy.id } });
      }
      report.imported++;
    }

    await this.db.clearScope('guest');
    this.guestProjectCount.set(0);
    this.sync.schedule(0, true);
    return report;
  }

  async discardLater(): Promise<void> {
    this.guestProjectCount.set(0);
  }
}

function sameProject(a: Project, b: Project): boolean {
  return a.name === b.name && a.createdAt === b.createdAt && JSON.stringify(a.tracker.simple) === JSON.stringify(b.tracker.simple) && JSON.stringify(a.tracker.cursor) === JSON.stringify(b.tracker.cursor);
}
