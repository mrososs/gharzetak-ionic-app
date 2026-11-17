import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { DEFAULT_PROFILE } from '../models/models';
import { LocalDb, ScopeDocs } from '../storage/local-db';
import { AppStore } from './app.store';

/** Regression: the name typed at sign-up was written to the GUEST profile because the store was still on the guest scope. */
describe('AppStore scope switch after sign-in', () => {
  function setup() {
    const scope = signal<string>('guest');
    const docs = new Map<string, ScopeDocs>([
      ['guest', { profile: { ...DEFAULT_PROFILE, displayName: 'Guest person' } } as ScopeDocs],
      ['user:abc', {} as ScopeDocs],
    ]);
    const db = {
      loadProjects: async () => [],
      loadCollections: async () => [],
      loadPatternRevs: async () => [],
      loadPatterns: async () => [],
      // a real IndexedDB read takes a moment: that gap is where the old write went to the wrong scope
      loadDocs: async (s: string) => (await new Promise((r) => setTimeout(r, 15)), docs.get(s) ?? ({} as ScopeDocs)),
      patchDocs: async (s: string, patch: Partial<ScopeDocs>) => void docs.set(s, { ...(docs.get(s) ?? {}), ...patch } as ScopeDocs),
      enqueue: async () => undefined,
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [AppStore, { provide: LocalDb, useValue: db }, { provide: AuthService, useValue: { scope } }] });
    return { scope, docs, store: TestBed.inject(AppStore) };
  }

  it('whenScopeLoaded waits for the account scope, so the sign-up name lands in the account profile and never in the guest one', async () => {
    const { scope, docs, store } = setup();
    TestBed.tick(); // the store's own effect loads the guest scope
    await store.whenScopeLoaded('guest');
    expect(store.profile().displayName).toBe('Guest person');

    scope.set('user:abc'); // AuthService.signUp() has just returned
    TestBed.tick(); // the store's effect starts reloading, but has not finished
    expect(store.scope()).toBe('guest');

    await store.whenScopeLoaded('user:abc');
    expect(store.scope()).toBe('user:abc');
    await store.updateProfile({ displayName: 'Anna' });

    expect(docs.get('user:abc')!.profile).toMatchObject({ displayName: 'Anna' });
    expect(docs.get('guest')!.profile).toMatchObject({ displayName: 'Guest person' }); // untouched
    expect(store.profile().displayName).toBe('Anna');
  });

  it('whenScopeLoaded gives up after the timeout instead of hanging sign-up', async () => {
    const { store } = setup();
    TestBed.tick();
    await store.whenScopeLoaded('guest');
    const t0 = Date.now();
    await store.whenScopeLoaded('user:never', 60);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
