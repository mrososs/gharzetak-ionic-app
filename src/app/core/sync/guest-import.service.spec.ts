import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { JoyRow, joyKey, rowFromEvent } from '../domain/joy';
import { JoyLedgerService } from '../joy/joy-ledger.service';
import { JoyService } from '../joy/joy.service';
import { Project } from '../models/models';
import { AppStore } from '../state/app.store';
import { createProject } from '../state/factories';
import { simpleNextRound, simpleTap } from '../domain/tracker-engine';
import { LocalDb, Scope } from '../storage/local-db';
import { GuestImportService } from './guest-import.service';
import { SyncService } from './sync.service';

const flush = () => new Promise((r) => setTimeout(r, 8));
const input = (name: string, target = 1) => ({ name, category: 'amigurumi' as const, hook: '3.0', yarn: 'cotton' as const, target, coverLocalUrl: null, patternId: null as string | null });

describe('GuestImportService — Crochet Joy ledger and achievements', () => {
  const scope = signal<Scope>('guest');
  const signedIn = signal(false);
  let store: AppStore;
  let db: LocalDb;
  let ledger: JoyLedgerService;
  let joy: JoyService;
  let importer: GuestImportService;
  const schedule = vi.fn();

  beforeEach(async () => {
    scope.set('guest');
    signedIn.set(false);
    schedule.mockReset();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [AppStore, JoyService, JoyLedgerService, GuestImportService, LocalDb, { provide: AuthService, useValue: { scope, signedIn } }, { provide: SyncService, useValue: { schedule } }],
    });
    db = TestBed.inject(LocalDb);
    store = TestBed.inject(AppStore);
    ledger = TestBed.inject(JoyLedgerService);
    joy = TestBed.inject(JoyService);
    importer = TestBed.inject(GuestImportService);
    TestBed.tick();
    await store.whenScopeLoaded('guest');
    TestBed.tick();
    await flush();
  });

  const switchTo = async (s: Scope) => {
    scope.set(s);
    signedIn.set(s !== 'guest');
    TestBed.tick();
    await store.whenScopeLoaded(s);
    TestBed.tick();
    await flush();
  };

  /** One counting tap per call; target 1 => a tap completes the round, the next tap moves on. */
  const tap = (id: string) => store.updateTracker(id, (t) => ({ ...t, simple: t.simple.count >= t.simple.target ? simpleNextRound(t.simple) : simpleTap(t.simple) }), { origin: 'tap' });

  /** A guest finished `rounds` rounds of a new project by really tapping (so rows come from the real pipeline). */
  async function guestProjectWithRounds(name: string, rounds: number): Promise<Project> {
    const p = createProject(input(name));
    await store.addProject(p);
    for (let r = 0; r < rounds; r++) {
      await tap(p.id); // completes round r+1
      await tap(p.id); // moves to the next round
    }
    await flush();
    return p;
  }

  const ach = (id: string, at: number): JoyRow => ({ key: joyKey({ kind: 'achievement', achievementId: id }), kind: 'achievement', achievementId: id, at, source: 'live' } as JoyRow);

  it('moves recorded round counts and achievements to the account, keeps unlock dates, and never celebrates', async () => {
    const p = await guestProjectWithRounds('Bunny', 3);
    await db.putJoyIfAbsent('guest', ach('first_round', 1_000));
    expect(ledger.counts().round).toBe(3);
    await switchTo('user:a');
    expect(ledger.counts().round).toBe(0); // account starts empty
    const seqBefore = joy.batch()?.seq ?? 0;

    expect(await importer.refresh()).toEqual({ projects: 1, joy: 4 });
    const report = await importer.importGuestData();
    await flush();

    expect(report.incomplete).toBe(false);
    expect(report.joy).toMatchObject({ migrated: 4, merged: 0, duplicates: 0, recovered: 0, failed: 0 });
    expect(store.projects().map((x) => x.id)).toEqual([p.id]);
    expect(ledger.counts()).toMatchObject({ round: 3, achievement: 1 });
    expect(ledger.row(ach('first_round', 0).key)?.at).toBe(1_000); // original unlock date preserved
    expect(ledger.has(joyKey({ kind: 'round', projectId: p.id, instanceId: null, round: 2 }))).toBe(true);
    expect(joy.batch()?.seq ?? 0).toBe(seqBefore); // import never celebrates
    // the guest copy is erased only after the account was confirmed to hold everything
    expect(await db.loadJoy('guest')).toEqual([]);
    expect(await db.loadProjects('guest')).toEqual([]);
  });

  it('remaps project ids exactly like the project import when an id collides with a different account project', async () => {
    const p = await guestProjectWithRounds('Bunny', 2);
    await switchTo('user:a');
    // the account already has a DIFFERENT project that happens to use the same id
    await store.addProject({ ...createProject(input('Other account project')), id: p.id });
    const report = await importer.importGuestData();
    await flush();

    expect(report.imported).toBe(1);
    const imported = store.projects().find((x) => x.name === 'Bunny')!;
    expect(imported.id).not.toBe(p.id);
    expect(ledger.has(joyKey({ kind: 'round', projectId: imported.id, instanceId: null, round: 1 }))).toBe(true);
    expect(ledger.has(joyKey({ kind: 'round', projectId: p.id, instanceId: null, round: 1 }))).toBe(false); // nothing left under the old id
    expect(ledger.counts().round).toBe(2);
  });

  it('never double-counts: rows the account already has are skipped; an earlier guest unlock date wins', async () => {
    const p = await guestProjectWithRounds('Bunny', 2);
    await db.putJoyIfAbsent('guest', ach('first_round', 500));
    await switchTo('user:a');
    // the same project already exists in the account (identical content) with the same ledger rows + a LATER achievement date
    const copy = { ...store.project(p.id)!, ...(await db.loadProjects('guest'))[0] };
    await store.addProject(copy);
    for (const r of (await db.loadJoy('guest')).filter((x) => x.kind === 'round')) await db.putJoyIfAbsent('user:a', r);
    await db.putJoyIfAbsent('user:a', ach('first_round', 9_000));
    await ledger.load('user:a');

    const report = await importer.importGuestData();
    await flush();

    expect(report.joy).toMatchObject({ migrated: 0, duplicates: 2, merged: 1, failed: 0 });
    expect(ledger.counts()).toMatchObject({ round: 2, achievement: 1 });
    expect(ledger.row(ach('first_round', 0).key)?.at).toBe(500);
    expect(store.projects()).toHaveLength(1);
  });

  it('keeps rows of a guest project that no longer exists under their original id — counts are not lost and not invented', async () => {
    await db.putJoyIfAbsent('guest', rowFromEvent({ kind: 'round', projectId: 'deleted-project', instanceId: null, round: 1, display: 1 }, 5));
    await db.putJoyIfAbsent('guest', rowFromEvent({ kind: 'round', projectId: 'deleted-project', instanceId: null, round: 2, display: 2 }, 6));
    await switchTo('user:a');
    const report = await importer.importGuestData();
    expect(report.joy?.migrated).toBe(2);
    expect(ledger.counts().round).toBe(2);
    expect(ledger.has('r|deleted-project|-|1')).toBe(true);
  });

  it('does not import from unrelated scopes, and leaves them untouched', async () => {
    await db.putJoyIfAbsent('user:other', rowFromEvent({ kind: 'round', projectId: 'theirs', instanceId: null, round: 1 }, 1));
    await db.putJoyIfAbsent('guest', rowFromEvent({ kind: 'round', projectId: 'mine', instanceId: null, round: 1 }, 2));
    await switchTo('user:a');
    await importer.importGuestData();
    expect(ledger.has('r|theirs|-|1')).toBe(false);
    expect(ledger.has('r|mine|-|1')).toBe(true);
    expect((await db.loadJoy('user:other')).map((r) => r.key)).toEqual(['r|theirs|-|1']);
  });

  it('keeps rows it cannot map safely in a recoverable list instead of guessing a count', async () => {
    const good = rowFromEvent({ kind: 'round', projectId: 'p', instanceId: null, round: 1 }, 1);
    const tampered = { ...rowFromEvent({ kind: 'round', projectId: 'p', instanceId: null, round: 2 }, 2), key: 'r|someone-else|-|9' }; // key no longer matches the content
    const broken = { key: 'x', kind: 'round', at: Number.NaN } as unknown as JoyRow;
    for (const r of [good, tampered, broken]) await db.putJoyIfAbsent('guest', r);
    await switchTo('user:a');
    const report = await importer.importGuestData();
    expect(report.joy).toMatchObject({ migrated: 1, recovered: 2, failed: 0 });
    expect(ledger.counts().round).toBe(1);
    const docs = await db.loadDocs('user:a');
    expect(docs.joyRecovery).toHaveLength(2);
    expect(docs.joyRecovery).toEqual(expect.arrayContaining([tampered, broken]));
    // re-running does not duplicate the recovery list
    await importer.importGuestData();
    expect((await db.loadDocs('user:a')).joyRecovery).toHaveLength(2);
  });

  it('is interruption-safe: a failed ledger step keeps the guest data, and a retry finishes without duplicating projects', async () => {
    const p = await guestProjectWithRounds('Bunny', 2);
    await db.putJoyIfAbsent('guest', ach('first_round', 3));
    await switchTo('user:a');
    await store.addProject({ ...createProject(input('Colliding')), id: p.id }); // forces a remap so the journal matters

    const spy = vi.spyOn(ledger, 'importFromGuest').mockRejectedValueOnce(new Error('interrupted'));
    const first = await importer.importGuestData();
    expect(first.incomplete).toBe(true);
    expect(await db.loadJoy('guest')).toHaveLength(3); // 2 rounds + 1 achievement: still there
    expect((await db.loadProjects('guest')).length).toBe(1);
    expect(store.projects()).toHaveLength(2); // the colliding one + the remapped copy
    spy.mockRestore();

    const second = await importer.importGuestData();
    await flush();
    expect(second.incomplete).toBe(false);
    expect(second.imported).toBe(0); // resumed through the journal: not copied again
    expect(store.projects()).toHaveLength(2);
    const copy = store.projects().find((x) => x.name === 'Bunny')!;
    expect(ledger.counts()).toMatchObject({ round: 2, achievement: 1 });
    expect(ledger.has(joyKey({ kind: 'round', projectId: copy.id, instanceId: null, round: 1 }))).toBe(true);
    expect(await db.loadJoy('guest')).toEqual([]);
  });

  it('a row that cannot be written keeps the guest copy (nothing is erased until the account is confirmed to hold everything)', async () => {
    await guestProjectWithRounds('Bunny', 1);
    await switchTo('user:a');
    const merge = vi.spyOn(db, 'mergeJoyRow').mockRejectedValue(new Error('quota'));
    const report = await importer.importGuestData();
    expect(report.incomplete).toBe(true);
    expect(report.joy?.failed).toBeGreaterThan(0);
    expect((await db.loadJoy('guest')).length).toBeGreaterThan(0);
    expect((await db.loadProjects('guest')).length).toBe(1);
    merge.mockRestore();
    const retry = await importer.importGuestData();
    expect(retry.incomplete).toBe(false);
    expect(await db.loadJoy('guest')).toEqual([]);
    expect(ledger.counts().round).toBe(1);
    expect(store.projects()).toHaveLength(1);
  });

  it('is idempotent: importing again after success changes nothing', async () => {
    await guestProjectWithRounds('Bunny', 2);
    await switchTo('user:a');
    await importer.importGuestData();
    const after = JSON.stringify(ledger.rows().map((r) => r.key).sort());
    const again = await importer.importGuestData();
    expect(again.imported).toBe(0);
    expect(JSON.stringify(ledger.rows().map((r) => r.key).sort())).toBe(after);
  });

  it('offers to move Joy progress even when the guest has no projects left (achievements only)', async () => {
    await db.putJoyIfAbsent('guest', ach('first_finished', 7));
    await switchTo('user:a');
    expect(await importer.refresh()).toEqual({ projects: 0, joy: 1 });
    const r = await importer.importGuestData();
    expect(r.joy?.migrated).toBe(1);
    expect(ledger.row(ach('first_finished', 0).key)?.at).toBe(7);
  });

  it('carries guest celebration/share preferences to an account without them, but never the reminder opt-in', async () => {
    await store.updatePrefs({ joy: { haptics: false, celebrate: 'milestones' }, reminders: { enabled: true, time: '21:00' }, share: { photo: false } });
    await guestProjectWithRounds('Bunny', 1);
    await switchTo('user:a');
    await importer.importGuestData();
    expect(store.prefs().joy).toEqual({ haptics: false, celebrate: 'milestones' });
    expect(store.prefs().share).toEqual({ photo: false });
    expect(store.prefs().reminders).toBeUndefined();
  });

  it('does nothing when signed out', async () => {
    await guestProjectWithRounds('Bunny', 1);
    expect(await importer.importGuestData()).toEqual({ imported: 0, duplicates: 0, joy: null, incomplete: false });
    expect((await db.loadProjects('guest')).length).toBe(1);
  });
});
