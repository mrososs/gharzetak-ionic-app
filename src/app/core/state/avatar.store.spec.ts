import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { DEFAULT_AVATAR } from '../data/avatars';
import { DEFAULT_PROFILE } from '../models/models';
import { LocalDb, ScopeDocs } from '../storage/local-db';
import { AppStore } from './app.store';

/** Store ↔ IndexedDB boundary with a tiny in-memory LocalDb; auth scope is a plain signal. */
function setup(scope: string, saved: Partial<ScopeDocs> = {}) {
  const docs = new Map<string, ScopeDocs>([[scope, saved as ScopeDocs]]);
  const queued: { kind: string; id: string }[] = [];
  const db = {
    loadProjects: async () => [],
    loadPatterns: async () => [],
    loadDocs: async (s: string) => docs.get(s) ?? ({} as ScopeDocs),
    patchDocs: async (s: string, patch: Partial<ScopeDocs>) => void docs.set(s, { ...(docs.get(s) ?? {}), ...patch } as ScopeDocs),
    enqueue: async (e: { kind: string; id: string }) => void queued.push({ kind: e.kind, id: e.id }),
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [AppStore, { provide: LocalDb, useValue: db }, { provide: AuthService, useValue: { scope: signal(scope) } }] });
  return { store: TestBed.inject(AppStore), docs, queued };
}

describe('AppStore avatar', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('older stored profiles (no avatarId) load as "not chosen" and show the default avatar', async () => {
    const { avatarId: _omit, ...legacy } = DEFAULT_PROFILE;
    const { store } = setup('guest', { profile: { ...legacy, displayName: 'Old', updatedAt: 5 } as never });
    await store.load('guest');
    expect(store.profile().avatarId).toBeNull();
    expect(store.avatarChosen()).toBe(false);
    expect(store.avatar()).toBe(DEFAULT_AVATAR);
    expect(store.profile().displayName).toBe('Old');
  });

  it('an unknown stored value (tampered path/URL) is dropped on load', async () => {
    const { store } = setup('guest', { profile: { ...DEFAULT_PROFILE, avatarId: 'https://evil.test/x.png' as never } });
    await store.load('guest');
    expect(store.profile().avatarId).toBeNull();
  });

  it('setAvatar persists immediately, changes nothing else, and queues a profile sync for signed-in scopes only', async () => {
    const user = setup('user:abc', { profile: { ...DEFAULT_PROFILE, displayName: 'Anna', level: 'advanced', hooks: ['5.0'] } });
    await user.store.load('user:abc');
    await user.store.setAvatar('bear');
    expect(user.docs.get('user:abc')!.profile).toMatchObject({ avatarId: 'bear', displayName: 'Anna', level: 'advanced', hooks: ['5.0'] });
    await new Promise((r) => setTimeout(r, 0)); // queue() enqueues after the docs write resolves
    expect(user.queued).toEqual([{ kind: 'profile', id: 'me' }]); // avatar change does not touch the tools set

    const guest = setup('guest');
    await guest.store.load('guest');
    await guest.store.setAvatar('cat');
    expect(guest.docs.get('guest')!.profile).toMatchObject({ avatarId: 'cat' });
    expect(guest.queued).toEqual([]); // guest data never leaves the device
  });

  it('rejects ids that are not presets', async () => {
    const { store, docs } = setup('guest');
    await store.load('guest');
    await store.setAvatar('../../evil' as never);
    await store.updateProfile({ avatarId: 'nope' as never });
    expect(store.profile().avatarId).toBeNull();
    expect((docs.get('guest')!.profile as { avatarId: unknown } | undefined)?.avatarId ?? null).toBeNull();
  });
});
