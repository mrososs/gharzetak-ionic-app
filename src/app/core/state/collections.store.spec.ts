import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { instanceProgress } from '../domain/collections';
import { parsePattern } from '../domain/pattern-parser';
import { patternTap } from '../domain/tracker-engine';
import { Pattern, PatternCollection, PatternPart } from '../models/models';
import { LocalDb } from '../storage/local-db';
import { AppStore } from './app.store';
import { createCollectionProject, createProject, uuid } from './factories';

const TEXT_V1 = 'R1: 6sc in MR [6]\nR2: inc x 6 [12]\nR3: (sc, inc) x 6 [18]\nR4: (2sc, inc) x 6 [24]';
const TEXT_V2 = 'R1: 6sc in MR [6]\nR2: inc x 6 [12]\nR3: (sc, inc) x 6 [18]\nR4: 18sc [18]';

const part = (name: string, quantity = 1, text = TEXT_V1): PatternPart => ({ id: uuid(), name, quantity, text, assemblyNotes: '' });
const collection = (parts: PatternPart[], over: Partial<PatternCollection> = {}): PatternCollection => ({
  id: uuid(), name: 'Pink Teddy Bear', description: '', level: 'beginner', terms: 'us', coverLocalUrl: null, parts, rev: 1, suggestedMinutes: 0, sourceText: '',
  createdAt: 1, updatedAt: 1, deletedAt: null, ...over,
});
const pattern = (over: Partial<Pattern> = {}): Pattern => ({
  id: uuid(), isSample: false, name: 'Ball', level: 'beginner', terms: 'us', source: 'text', text: TEXT_V1, file: null, attribution: '', sourceUrl: '', position: 0, updatedAt: 1, deletedAt: null, ...over,
});

describe('AppStore — collections, part instances and pattern editing', () => {
  let store: AppStore;
  let db: LocalDb;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [AppStore, LocalDb, { provide: AuthService, useValue: { scope: signal('user:test') } }] });
    db = TestBed.inject(LocalDb);
    store = TestBed.inject(AppStore);
    TestBed.tick();
    await store.whenScopeLoaded('user:test');
  });

  const outboxKinds = async () => (await db.outbox('user:test')).map((e) => e.kind);

  it('creates a project from a collection: one independent tracker per piece, frozen instructions, nothing shared', async () => {
    const col = collection([part('Head'), part('Arms', 2)]);
    await store.addCollection(col);
    const p1 = createCollectionProject({ name: 'Bear 1', category: 'amigurumi', hook: '3.0', yarn: 'cotton', target: 0, coverLocalUrl: null }, col);
    const p2 = createCollectionProject({ name: 'Bear 2', category: 'amigurumi', hook: '3.0', yarn: 'cotton', target: 0, coverLocalUrl: null }, col);
    await store.addProject(p1);
    await store.addProject(p2);
    expect(p1.parts).toHaveLength(3);
    expect(p1.collectionRev).toBe(1);
    expect(p1.partSnapshots?.map((s) => s.name)).toEqual(['Head', 'Arms']);
    expect(p1.parts!.map((i) => i.id).some((id) => p2.parts!.some((j) => j.id === id))).toBe(false);
    expect(await outboxKinds()).toEqual(expect.arrayContaining(['collection', 'project', 'progress']));
  });

  it('progress on Arm 1 never moves Arm 2, the Head, or another project; undo history is per piece', async () => {
    const col = collection([part('Head'), part('Arms', 2)]);
    await store.addCollection(col);
    const p = createCollectionProject({ name: 'Bear', category: 'amigurumi', hook: '3.0', yarn: 'cotton', target: 0, coverLocalUrl: null }, col);
    const other = createCollectionProject({ name: 'Other', category: 'amigurumi', hook: '3.0', yarn: 'cotton', target: 0, coverLocalUrl: null }, col);
    await store.addProject(p);
    await store.addProject(other);
    const parsed = parsePattern(TEXT_V1);
    const arm1 = p.parts![1];
    for (let i = 0; i < 12; i++) await store.updatePartTracker(p.id, arm1.id, (t) => ({ ...t, cursor: patternTap(parsed, t.cursor) }));

    const now = store.project(p.id)!;
    const [head, a1, a2] = now.parts!;
    expect(a1.cursor.roundIndex + a1.cursor.ptr).toBeGreaterThan(0);
    expect(a1.cursor.history.length).toBe(12);
    expect(head.cursor).toEqual(p.parts![0].cursor);
    expect(a2.cursor).toEqual(p.parts![2].cursor);
    expect(a2.cursor.history).toHaveLength(0);
    expect(store.project(other.id)!.parts!.every((i) => i.cursor.roundIndex === 0 && i.cursor.ptr === 0)).toBe(true);
    expect(instanceProgress(a2, now.partSnapshots![1]).started).toBe(false);
    // overall completion reflects the partial progress, but is not "done"
    expect(store.progress(now).pct).toBeGreaterThan(0);
    expect(store.progress(now).pct).toBeLessThan(100);
  });

  it('remembers the active part (restored after a restart) and the tracker view follows it', async () => {
    const col = collection([part('Head'), part('Arms', 2)]);
    await store.addCollection(col);
    const p = createCollectionProject({ name: 'Bear', category: 'amigurumi', hook: '3.0', yarn: 'cotton', target: 0, coverLocalUrl: null }, col);
    await store.addProject(p);
    await store.setActiveInstance(p.id, p.parts![2].id);
    // simulate closing and reopening the app
    await store.load('user:test');
    const restored = store.project(p.id)!;
    expect(restored.activeInstanceId).toBe(p.parts![2].id);
    const view = store.trackerView(restored)!;
    expect(view.instance?.id).toBe(p.parts![2].id);
    expect(view.source?.name).toBe('Arms 2/2');
    expect(view.source?.text).toBe(TEXT_V1);
  });

  it('editing a collection keeps the previous content as an immutable revision, but a rename alone does not bump the revision', async () => {
    const col = collection([part('Head')]);
    await store.addCollection(col);
    const rename = await store.saveCollectionEdit(col.id, { ...col, name: 'Pink Bear' });
    expect(rename).toEqual({ contentChanged: false, rev: 1 });
    expect(store.revisionsOf('collection', col.id)).toHaveLength(0);

    const edited = await store.saveCollectionEdit(col.id, { ...store.collection(col.id)!, parts: [{ ...col.parts[0], text: TEXT_V2 }] });
    expect(edited).toEqual({ contentChanged: true, rev: 2 });
    const revs = store.revisionsOf('collection', col.id);
    expect(revs).toHaveLength(1);
    expect(revs[0]).toMatchObject({ rev: 1, kind: 'collection' });
    expect(revs[0].parts![0].text).toBe(TEXT_V1); // the OLD content is what was preserved
    expect(store.collection(col.id)!.rev).toBe(2);
    expect(await outboxKinds()).toContain('patternrev');
  });

  it('a running project keeps its frozen copy when the collection is edited or even deleted', async () => {
    const col = collection([part('Head')]);
    await store.addCollection(col);
    const p = createCollectionProject({ name: 'Bear', category: 'amigurumi', hook: '3.0', yarn: 'cotton', target: 0, coverLocalUrl: null }, col);
    await store.addProject(p);
    await store.saveCollectionEdit(col.id, { ...col, parts: [{ ...col.parts[0], text: TEXT_V2 }] });
    const view = store.trackerView(store.project(p.id))!;
    expect(view.source?.text).toBe(TEXT_V1); // still the instructions the user started with
    expect(view.outdated).toBe(true); // …and the app knows an update is available (explicit action required)

    await store.deleteCollection(col.id);
    expect(store.collection(col.id)).toBeNull();
    expect(store.trackerView(store.project(p.id))!.source?.text).toBe(TEXT_V1);
    expect(store.project(p.id)!.parts).toHaveLength(1);
  });

  it('editing a standalone pattern pins active projects to the previous text and keeps their tracker position', async () => {
    const pat = pattern();
    await store.addPattern(pat);
    const proj = { ...createProject({ name: 'Ball', category: 'amigurumi', hook: '3.0', yarn: 'cotton', target: 0, coverLocalUrl: null, patternId: pat.id, totalRounds: 4 }) };
    await store.addProject(proj);
    const parsed = parsePattern(TEXT_V1);
    for (let i = 0; i < 20; i++) await store.updateTracker(proj.id, (t) => ({ ...t, cursor: patternTap(parsed, t.cursor) }));
    const before = store.project(proj.id)!.tracker.cursor;
    expect(before.roundIndex).toBeGreaterThanOrEqual(2);

    const res = await store.savePatternEdit(pat.id, { name: 'Ball', level: 'beginner', terms: 'us', text: TEXT_V2, attribution: '', suggestedMinutes: 0 });
    expect(res).toEqual({ contentChanged: true, rev: 2, pinned: 1 });

    const after = store.project(proj.id)!;
    expect(after.tracker.cursor).toEqual(before); // NEVER reset or moved silently
    expect(after.patternPin).toMatchObject({ rev: 1, text: TEXT_V1 });
    const view = store.trackerView(after)!;
    expect(view.source?.text).toBe(TEXT_V1); // the project still follows the instructions it started with
    expect(view.outdated).toBe(true);
    expect(store.pattern(pat.id)!.text).toBe(TEXT_V2);
    expect(store.pattern(pat.id)!.rev).toBe(2);
    expect(store.revisionsOf('pattern', pat.id)[0]).toMatchObject({ rev: 1, text: TEXT_V1 });
    expect(await outboxKinds()).toEqual(expect.arrayContaining(['patternrev', 'pattern']));

    // a second edit must not move the pin (it stays at the version the project actually started with)
    await store.savePatternEdit(pat.id, { name: 'Ball 2', level: 'beginner', terms: 'us', text: TEXT_V2 + '\nR5: 12sc [12]', attribution: '', suggestedMinutes: 0 });
    expect(store.project(proj.id)!.patternPin).toMatchObject({ rev: 1, text: TEXT_V1 });
    expect(store.pattern(pat.id)!.rev).toBe(3);

    // explicit update path
    await store.unpinProject(proj.id, before);
    expect(store.project(proj.id)!.patternPin).toBeNull();
    expect(store.trackerView(store.project(proj.id))!.source?.text).toContain('R5: 12sc [12]');
  });

  it('renaming a pattern (no text change) does not create a revision and does not pin anything', async () => {
    const pat = pattern();
    await store.addPattern(pat);
    const proj = createProject({ name: 'Ball', category: 'amigurumi', hook: '3.0', yarn: 'cotton', target: 0, coverLocalUrl: null, patternId: pat.id, totalRounds: 4 });
    await store.addProject(proj);
    const res = await store.savePatternEdit(pat.id, { name: 'Renamed', level: 'advanced', terms: 'us', text: TEXT_V1, attribution: 'me', suggestedMinutes: 0 });
    expect(res).toEqual({ contentChanged: false, rev: 1, pinned: 0 });
    expect(store.project(proj.id)!.patternPin).toBeUndefined();
    expect(store.revisionsOf('pattern', pat.id)).toHaveLength(0);
    expect(store.pattern(pat.id)!.name).toBe('Renamed');
  });

  it('copying a standalone pattern into a collection never changes or removes the source pattern', async () => {
    const pat = pattern();
    await store.addPattern(pat);
    const col = collection([part('Head')]);
    await store.addCollection(col);
    expect(await store.copyPatternIntoCollection(pat.id, col.id, uuid(), 2)).toBe(true);
    expect(store.collection(col.id)!.parts.map((p) => [p.name, p.quantity])).toEqual([['Head', 1], ['Ball', 2]]);
    expect(store.pattern(pat.id)).toEqual(pat);
  });

  it('keeps existing standalone projects (no parts, no pin) working exactly as before', async () => {
    const pat = pattern();
    await store.addPattern(pat);
    const proj = createProject({ name: 'Old', category: 'amigurumi', hook: '3.0', yarn: 'cotton', target: 0, coverLocalUrl: null, patternId: pat.id, totalRounds: 4 });
    await store.addProject(proj);
    const view = store.trackerView(store.project(proj.id))!;
    expect(view.instance).toBeNull();
    expect(view.source).toMatchObject({ text: TEXT_V1, name: 'Ball', id: pat.id });
    expect(view.outdated).toBe(false);
    expect(store.activeInstance(proj)).toBeNull();
  });
});
