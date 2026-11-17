import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { JoyImportReport, JoyLedgerService } from '../joy/joy-ledger.service';
import { Pattern, Project } from '../models/models';
import { AppStore } from '../state/app.store';
import { uuid } from '../state/factories';
import { LocalDb } from '../storage/local-db';
import { SyncService } from './sync.service';

export interface ImportReport {
  imported: number;
  duplicates: number;
  /** Crochet Joy ledger / achievements migration result (null when there was nothing to migrate). */
  joy: JoyImportReport | null;
  /** The ledger could not be confirmed in the account: the guest copy was KEPT so nothing is lost; the import can be retried. */
  incomplete: boolean;
}

/**
 * Moves guest-mode data into a signed-in account — only when the user explicitly agrees.
 * Rules:
 *  - never overwrites an existing account project: an id collision is treated as "already imported"
 *    when the content is identical, otherwise the guest copy is imported under a new id;
 *  - custom guest patterns are copied first so project → pattern links stay valid;
 *  - the guest scope is cleared only after every item was written locally and queued for sync;
 *  - the Crochet Joy ledger (earned achievements + recorded round counts) moves with the projects, with project ids remapped through
 *    the same map, never double-counted, never celebrated, and never erased before the account is confirmed to hold it;
 *  - it is resumable: a journal (guest project id → account project id) lives in the guest scope until the very end, so a retry after an
 *    interruption maps the same ids instead of importing duplicates.
 */
@Injectable({ providedIn: 'root' })
export class GuestImportService {
  private readonly db = inject(LocalDb);
  private readonly store = inject(AppStore);
  private readonly auth = inject(AuthService);
  private readonly sync = inject(SyncService);
  private readonly joy = inject(JoyLedgerService);

  readonly guestProjectCount = signal(0);
  readonly guestJoyCount = signal(0);

  /** What the guest scope holds that could move into the account: projects and Crochet Joy ledger rows. */
  async refresh(): Promise<{ projects: number; joy: number }> {
    if (!this.auth.signedIn()) return { projects: 0, joy: 0 };
    const [projects, joy] = await Promise.all([this.db.loadProjects('guest'), this.db.loadJoy('guest')]);
    this.guestProjectCount.set(projects.length);
    this.guestJoyCount.set(joy.length);
    return { projects: projects.length, joy: joy.length };
  }

  async importGuestData(): Promise<ImportReport> {
    if (!this.auth.signedIn()) return { imported: 0, duplicates: 0, joy: null, incomplete: false };
    const [projects, patterns, collections, guestDocs] = await Promise.all([
      this.db.loadProjects('guest'),
      this.db.loadPatterns('guest'),
      this.db.loadCollections('guest'),
      this.db.loadDocs('guest'),
    ]);
    const collectionIdMap = new Map<string, string>();
    const report: ImportReport = { imported: 0, duplicates: 0, joy: null, incomplete: false };
    /** guest project id → account project id (also the resume journal). */
    const projectMap = new Map<string, string>();
    const journal: Record<string, string> = { ...(guestDocs.importMap ?? {}) };
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

    // Collections next, so project → collection links stay valid (part ids are kept: part instances refer to them).
    for (const col of collections.filter((c) => !c.deletedAt)) {
      const existing = this.store.collection(col.id);
      if (existing && existing.name === col.name && existing.rev === col.rev) {
        collectionIdMap.set(col.id, col.id);
        continue;
      }
      const id = existing ? uuid() : col.id;
      collectionIdMap.set(col.id, id);
      await this.store.addCollection({ ...col, id, updatedAt: Date.now() });
    }

    for (const p of projects) {
      // Resuming an interrupted import: this guest project was already copied (possibly under a new id) — never copy it twice.
      const journaled = journal[p.id];
      if (journaled && this.store.project(journaled)) {
        projectMap.set(p.id, journaled);
        report.duplicates++;
        continue;
      }
      const existing = this.store.project(p.id);
      if (existing && sameProject(existing, p)) {
        projectMap.set(p.id, p.id);
        report.duplicates++;
        continue;
      }
      const id = existing ? uuid() : p.id;
      projectMap.set(p.id, id);
      const pid = p.tracker.patternId ? (patternIdMap.get(p.tracker.patternId) ?? p.tracker.patternId) : null;
      const copy: Project = {
        ...p,
        id,
        coverPath: null,
        collectionId: p.collectionId ? (collectionIdMap.get(p.collectionId) ?? p.collectionId) : p.collectionId,
        photos: p.photos.map((ph) => ({ ...ph, storagePath: null })),
        updatedAt: Date.now(),
        tracker: { ...p.tracker, patternId: pid, updatedAt: Date.now() },
      };
      await this.store.addProject(copy);
      journal[p.id] = id;
      await this.db.patchDocs('guest', { importMap: { ...journal } });
      await this.store.updateProject(copy.id, (x) => x, ['note']);
      for (const ph of copy.photos) {
        if (ph.localUrl) await this.db.enqueue({ scope: this.store.scope(), kind: 'photo', id: ph.id, op: 'upsert', payload: { projectId: copy.id } });
      }
      report.imported++;
    }

    // Crochet Joy: carry the earned achievements and the recorded round counts over (silently — an import is never a celebration).
    const scope = this.store.scope();
    try {
      report.joy = await this.joy.importFromGuest(scope, projectMap);
    } catch {
      report.joy = { migrated: 0, merged: 0, duplicates: 0, recovered: 0, failed: 1 };
    }
    // Local-only preferences follow the person, except reminders: an OS notification schedule needs its own explicit opt-in per account.
    const gp = guestDocs.prefs;
    if (gp) {
      const cur = this.store.prefs();
      const patch: { joy?: typeof gp.joy; share?: typeof gp.share } = {};
      if (!cur.joy && gp.joy) patch.joy = gp.joy;
      if (!cur.share && gp.share) patch.share = gp.share;
      if (patch.joy || patch.share) await this.store.updatePrefs(patch);
    }

    report.incomplete = (report.joy?.failed ?? 0) > 0;
    if (report.incomplete) {
      // Not confirmed in the account: keep the guest copy (projects re-import as "duplicates", so a retry is safe).
      this.sync.schedule(0, true);
      return report;
    }
    await this.db.clearScope('guest');
    this.guestProjectCount.set(0);
    this.guestJoyCount.set(0);
    this.sync.schedule(0, true);
    return report;
  }

  async discardLater(): Promise<void> {
    this.guestProjectCount.set(0);
    this.guestJoyCount.set(0);
  }
}

function sameProject(a: Project, b: Project): boolean {
  return a.name === b.name && a.createdAt === b.createdAt && JSON.stringify(a.tracker.simple) === JSON.stringify(b.tracker.simple) && JSON.stringify(a.tracker.cursor) === JSON.stringify(b.tracker.cursor);
}
