import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { I18nService } from '../i18n/i18n.service';
import { Project } from '../models/models';
import { AppStore } from '../state/app.store';
import { createProject } from '../state/factories';
import { LocalDb } from '../storage/local-db';
import { DEFAULT_SHARE_PREFS } from './joy.models';
import { ShareCardModel, ShareSource, applicableToggles, buildShareModel, captionFor, quoteFor } from './share-card';
import { ShareLauncher } from './share-launcher.service';
import { SHARE_HEADLINE, achievementSource, photoOf, progressHeadline, projectSource } from './share-source';

const src = (over: Partial<ShareSource> = {}): ShareSource => ({
  kind: 'project', lang: 'en', avatarId: 'bunny', headline: 'Finished a new project! 🏆', projectName: 'Bunny', photoUrl: 'data:image/jpeg;base64,AAAA', pct: null,
  detail: '42 rounds counted', timeText: '3 hours 20 minutes', pieces: { done: 3, total: 3 }, badge: null, ...over,
});
const ALL_ON = DEFAULT_SHARE_PREFS;
const ALL_OFF = { photo: false, avatar: false, time: false, parts: false, name: false };

describe('buildShareModel — what a card may contain', () => {
  it('shows everything the user kept switched on', () => {
    const m = buildShareModel(src(), ALL_ON);
    expect(m).toMatchObject({ projectName: 'Bunny', photoUrl: 'data:image/jpeg;base64,AAAA', avatarId: 'bunny', rtl: false, lang: 'en' });
    expect(m.chips).toEqual(['⏱ 3 hours 20 minutes', '🧩 3/3']);
    expect(m.brand).toBe('غرزتك · Gharzetak');
  });

  it('every switch removes exactly its own item and nothing else', () => {
    expect(buildShareModel(src(), { ...ALL_ON, photo: false }).photoUrl).toBeNull();
    expect(buildShareModel(src(), { ...ALL_ON, avatar: false }).avatarId).toBeNull();
    expect(buildShareModel(src(), { ...ALL_ON, name: false }).projectName).toBeNull();
    expect(buildShareModel(src(), { ...ALL_ON, time: false }).chips).toEqual(['🧩 3/3']);
    expect(buildShareModel(src(), { ...ALL_ON, parts: false }).chips).toEqual(['⏱ 3 hours 20 minutes']);
    const off = buildShareModel(src(), ALL_OFF);
    expect([off.projectName, off.photoUrl, off.avatarId, off.chips.length]).toEqual([null, null, null, 0]);
    expect(off.headline).toBe('Finished a new project! 🏆'); // the generic headline and the brand always remain
  });

  it('a single-piece project never shows a "1/1 pieces" chip; Arabic cards are right-to-left', () => {
    expect(buildShareModel(src({ pieces: { done: 1, total: 1 } }), ALL_ON).chips).toEqual(['⏱ 3 hours 20 minutes']);
    expect(buildShareModel(src({ lang: 'ar' }), ALL_ON).rtl).toBe(true);
  });

  it('only offers switches for things that exist on this card', () => {
    expect(applicableToggles(src())).toEqual(['photo', 'avatar', 'time', 'parts', 'name']);
    expect(applicableToggles(src({ photoUrl: null, timeText: null, pieces: null, projectName: null }))).toEqual(['avatar']);
  });

  it('has a quote and a caption for every kind and both languages, naming the project only when the name switch is on', () => {
    for (const kind of ['milestone', 'part', 'progress', 'project', 'achievement'] as const) {
      for (const lang of ['ar', 'en'] as const) {
        expect(quoteFor(kind, lang).length).toBeGreaterThan(5);
        const withName = captionFor(buildShareModel(src({ kind, lang, badge: { emoji: '🏆', name: 'First masterpiece' } }), ALL_ON));
        const noName = captionFor(buildShareModel(src({ kind, lang, badge: { emoji: '🏆', name: 'First masterpiece' } }), { ...ALL_ON, name: false }));
        expect(withName.length).toBeGreaterThan(8);
        expect(noName).not.toContain('Bunny');
        if (kind !== 'achievement') expect(withName).toContain('Bunny');
      }
    }
  });
});

describe('share sources — the privacy boundary', () => {
  const SECRETS = ['SECRET-NOTE-TEXT', 'SECRET-PATTERN-ROUND-ONE', 'private.person@example.com', 'acct-id-1234567', 'tok_SECRET_TOKEN', 'Private Person Name'];

  /** A project stuffed with everything that must never reach a card. */
  const secretProject = (): Project => ({
    ...createProject({ name: 'Bunny', category: 'amigurumi', hook: '3.0', yarn: 'cotton', target: 6, coverLocalUrl: 'data:image/jpeg;base64,COVER', patternId: 'pat-1' }),
    notes: 'SECRET-NOTE-TEXT',
    workedSeconds: 3 * 3600 + 20 * 60,
    photos: [{ id: 'ph1', localUrl: 'data:image/jpeg;base64,PHOTO', storagePath: 'acct-id-1234567/proj/photo.jpg', createdAt: 1 }],
    patternPin: { rev: 1, name: 'Pinned', text: 'R1: SECRET-PATTERN-ROUND-ONE', terms: 'us' },
    parts: [],
    partSnapshots: [{ partId: 'x', name: 'Head', quantity: 1, text: 'R1: SECRET-PATTERN-ROUND-ONE', assemblyNotes: 'SECRET-NOTE-TEXT' }],
  });

  const everythingOn = (s: ShareSource) => JSON.stringify(buildShareModel(s, ALL_ON));

  it('a card built from a project contains none of its notes, pattern instructions, identifiers or the account', () => {
    const p = secretProject();
    const s = projectSource({ kind: 'project', lang: 'en', avatarId: 'bunny', headline: SHARE_HEADLINE.project.en, project: p, formatTime: (x) => `${Math.floor(x / 60)} min`, pieces: { done: 1, total: 2 } });
    const json = everythingOn(s) + JSON.stringify(s);
    for (const secret of SECRETS) expect(json).not.toContain(secret);
    // ...while the things the user chose ARE there
    expect(json).toContain('Bunny');
    expect(json).toContain('COVER');
  });

  it('only a fixed whitelist of keys can ever exist on a source or a model', () => {
    const s = projectSource({ kind: 'progress', lang: 'ar', avatarId: 'cat', headline: progressHeadline(40, 'ar'), project: secretProject(), pct: 40, formatTime: () => 'x' });
    expect(Object.keys(s).sort()).toEqual(['avatarId', 'badge', 'detail', 'headline', 'kind', 'lang', 'pct', 'photoUrl', 'pieces', 'projectName', 'timeText']);
    expect(Object.keys(buildShareModel(s, ALL_ON)).sort()).toEqual(['avatarId', 'badge', 'brand', 'chips', 'detail', 'headline', 'kind', 'lang', 'pct', 'photoUrl', 'projectName', 'quote', 'rtl']);
  });

  it('chooses the cover, else the newest LOCAL photo (a remote-only photo is never fetched, so sharing works offline)', () => {
    const p = secretProject();
    expect(photoOf(p)).toBe('data:image/jpeg;base64,COVER');
    expect(photoOf({ ...p, coverLocalUrl: null })).toBe('data:image/jpeg;base64,PHOTO');
    const remoteOnly: Project['photos'] = [{ id: 'r', localUrl: null, storagePath: 'only/on/server.jpg', createdAt: 1 }];
    expect(photoOf({ ...p, coverLocalUrl: null, photos: remoteOnly })).toBeNull();
  });

  it('recorded time needs at least a minute; a blank project name becomes no name (not an empty string)', () => {
    const base = { kind: 'progress' as const, lang: 'en' as const, avatarId: 'bunny' as const, headline: 'h', formatTime: (s: number) => `${s}s` };
    expect(projectSource({ ...base, project: { ...secretProject(), workedSeconds: 59 } }).timeText).toBeNull();
    expect(projectSource({ ...base, project: { ...secretProject(), workedSeconds: 61 } }).timeText).toBe('61s');
    expect(projectSource({ ...base, project: { ...secretProject(), name: '   ' } }).projectName).toBeNull();
  });

  it('a piece label is shown together with the project name', () => {
    const s = projectSource({ kind: 'part', lang: 'en', avatarId: 'bunny', headline: 'h', project: secretProject(), pieceLabel: 'Head 1/2', formatTime: () => '' });
    expect(s.projectName).toBe('Bunny · Head 1/2');
  });

  it('an achievement card carries only the badge: no project, photo, time or name', () => {
    const s = achievementSource('first_finished', 'en', 'bunny')!;
    expect(s).toMatchObject({ kind: 'achievement', projectName: null, photoUrl: null, timeText: null, pieces: null, pct: null });
    expect(s.badge).toEqual({ emoji: '🏆', name: 'First masterpiece' });
    expect(achievementSource('nope', 'en', 'bunny')).toBeNull();
    expect(applicableToggles(s)).toEqual(['avatar']);
  });

  it('has a headline for every kind and language', () => {
    for (const k of Object.keys(SHARE_HEADLINE) as (keyof typeof SHARE_HEADLINE)[]) {
      expect(SHARE_HEADLINE[k].ar.length).toBeGreaterThan(4);
      expect(SHARE_HEADLINE[k].en.length).toBeGreaterThan(4);
    }
    expect(progressHeadline(40, 'en')).toBe('40% done 🧶');
    expect(progressHeadline(40, 'ar')).toBe('40% خلصت 🧶');
  });
});

describe('ShareLauncher', () => {
  const setup = async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [AppStore, ShareLauncher, LocalDb, I18nService, { provide: AuthService, useValue: { scope: signal('user:a') } }] });
    const store = TestBed.inject(AppStore);
    TestBed.inject(I18nService).lang.set('en');
    TestBed.tick();
    await store.whenScopeLoaded('user:a');
    return { store, launcher: TestBed.inject(ShareLauncher) };
  };

  it('does nothing until a user action opens it, and close() clears it', async () => {
    const { launcher } = await setup();
    expect(launcher.source()).toBeNull();
    launcher.open(null);
    expect(launcher.source()).toBeNull();
    launcher.achievement('first_round');
    expect(launcher.source()?.kind).toBe('achievement');
    launcher.close();
    expect(launcher.source()).toBeNull();
  });

  it('progress(): the percentage, the time and the cover — and never the notes or pattern text', async () => {
    const { store, launcher } = await setup();
    const p: Project = { ...createProject({ name: 'Bunny', category: 'amigurumi', hook: '3.0', yarn: 'cotton', target: 10, coverLocalUrl: 'data:image/jpeg;base64,COVER', patternId: null }), notes: 'SECRET-NOTE-TEXT', workedSeconds: 7200 };
    await store.addProject({ ...p, tracker: { ...p.tracker, simple: { ...p.tracker.simple, round: 3, count: 5, totalRounds: 6 } } });
    launcher.progress(p.id);
    const s = launcher.source()!;
    expect(s.kind).toBe('progress');
    expect(s.pct).toBeGreaterThan(0);
    expect(s.headline).toMatch(/% done/);
    expect(s.timeText).toBe('2 hours');
    expect(s.photoUrl).toBe('data:image/jpeg;base64,COVER');
    expect(JSON.stringify(s)).not.toContain('SECRET-NOTE-TEXT');
    launcher.progress('does-not-exist');
    expect(launcher.source()).toBe(s); // unknown project: nothing changes
  });

  it('a finished project shares as a completion card without a percentage', async () => {
    const { store, launcher } = await setup();
    const p = { ...createProject({ name: 'Bunny', category: 'amigurumi', hook: '3.0', yarn: 'cotton', target: 10, coverLocalUrl: null, patternId: null }), status: 'done' as const };
    await store.addProject(p);
    launcher.progress(p.id);
    expect(launcher.source()).toMatchObject({ kind: 'project', pct: null, headline: 'Finished a new project! 🏆' });
  });
});

describe('model type', () => {
  it('is serialisable plain data (it never holds a Project, a pattern or a profile)', () => {
    const m: ShareCardModel = buildShareModel(src(), ALL_ON);
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});
