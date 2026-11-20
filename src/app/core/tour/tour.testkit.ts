// Test support for the tour system (excluded from the app build: see tsconfig.app.json). A fake engine, a fake store backend, a fake
// router/navigation, so the coordinator's real logic is exercised without a browser or Driver.js.
import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { NavController } from '@ionic/angular';
import { vi } from 'vitest';
import { KhayootaService } from '../ai/khayoota.service';
import { AuthService } from '../auth/auth.service';
import { I18nService } from '../i18n/i18n.service';
import type { Pattern, PatternCollection, Project } from '../models/models';
import { AppStore } from '../state/app.store';
import { LocalDb, Scope, ScopeDocs } from '../storage/local-db';
import { SyncService } from '../sync/sync.service';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { TOUR_EVENT_SINK } from './tour-event-sink';
import { TOURS_ENABLED, TourCoordinator } from './tour-coordinator.service';
import { TourGate } from './tour-gate.service';
import { TOUR_RENDERER } from './tour-renderer';
import { TourStateService } from './tour-state.service';
import { TourTargetRegistry } from './tour-target.registry';
import type { EndReason, RenderCallbacks, RenderOptions, RenderStep, TourEvent, TourRenderer } from './tour.types';

export class FakeRenderer implements TourRenderer {
  active = false;
  starts: { steps: readonly RenderStep[]; startIndex: number; options: RenderOptions; cb: RenderCallbacks }[] = [];
  stops: EndReason[] = [];
  retexts: unknown[] = [];
  refreshes = 0;
  failStart = false;
  private lastStep: string | undefined;

  async start(steps: readonly RenderStep[], startIndex: number, options: RenderOptions, cb: RenderCallbacks): Promise<void> {
    if (this.failStart) throw new Error('engine failed to load');
    this.active = true;
    this.starts.push({ steps, startIndex, options, cb });
    this.show(startIndex);
  }
  /** Simulates the engine showing step `i`. */
  show(i: number): void {
    const s = this.starts[this.starts.length - 1];
    this.lastStep = s.steps[i].id;
    s.cb.stepShown(s.steps[i].id, i, s.steps.length);
  }
  retext(o: unknown): void {
    this.retexts.push(o);
  }
  refresh(): void {
    this.refreshes++;
  }
  stop(reason: EndReason): void {
    this.stops.push(reason);
    if (!this.active) return;
    this.active = false;
    this.starts[this.starts.length - 1].cb.ended(reason, this.lastStep);
  }
  get last() {
    return this.starts[this.starts.length - 1];
  }
}

export interface FakeAuth {
  scope: ReturnType<typeof signal<string>>;
  ready: ReturnType<typeof signal<boolean>>;
  locked: ReturnType<typeof signal<boolean>>;
  guest: ReturnType<typeof signal<boolean>>;
  signedIn: ReturnType<typeof signal<boolean>>;
}

export interface FakeData {
  projects?: Project[];
  patterns?: Pattern[];
  collections?: PatternCollection[];
  docs?: Partial<ScopeDocs>;
}

export interface TourEnv {
  coordinator: TourCoordinator;
  state: TourStateService;
  store: AppStore;
  gate: TourGate;
  targets: TourTargetRegistry;
  renderer: FakeRenderer;
  events: TourEvent[];
  auth: FakeAuth;
  router: Router;
  nav: { navigateRoot: ReturnType<typeof vi.fn>; navigateForward: ReturnType<typeof vi.fn> };
  toast: ReturnType<typeof vi.fn>;
  i18n: I18nService;
  /** Persisted documents per scope (what a real IndexedDB would hold). */
  docs: Map<string, Partial<ScopeDocs>>;
  scopes: Map<string, FakeData>;
  injector: Injector;
  /** Lets effects, store writes and router events settle. */
  flush(): Promise<void>;
  goto(url: string): Promise<void>;
}

export async function setupTour(o: { toursEnabled?: boolean; scope?: string; guest?: boolean; url?: string; scopes?: Record<string, FakeData>; lang?: 'ar' | 'en' } = {}): Promise<TourEnv> {
  const scope = (o.scope ?? 'guest') as Scope;
  const guest = o.guest ?? scope === 'guest';
  const scopes = new Map<string, FakeData>(Object.entries(o.scopes ?? {}));
  const docs = new Map<string, Partial<ScopeDocs>>();
  for (const [k, v] of scopes) if (v.docs) docs.set(k, v.docs);
  const dataOf = (s: string): FakeData => scopes.get(s) ?? {};
  const db = {
    loadProjects: async (s: string) => dataOf(s).projects ?? [],
    loadPatterns: async (s: string) => dataOf(s).patterns ?? [],
    loadCollections: async (s: string) => dataOf(s).collections ?? [],
    loadPatternRevs: async () => [],
    loadDocs: async (s: string) => docs.get(s) ?? {},
    patchDocs: async (s: string, patch: Partial<ScopeDocs>) => void docs.set(s, { ...(docs.get(s) ?? {}), ...patch }),
    putProject: async () => undefined,
    removeProject: async () => undefined,
    putPattern: async () => undefined,
    removePattern: async () => undefined,
    enqueue: async () => undefined,
  };
  const auth: FakeAuth = { scope: signal(scope), ready: signal(true), locked: signal(false), guest: signal(guest), signedIn: signal(!guest) };
  const renderer = new FakeRenderer();
  const events: TourEvent[] = [];
  const toast = vi.fn(async () => undefined);
  let routerRef!: Router;
  const nav = {
    navigateRoot: vi.fn(async (url: string) => (await routerRef.navigateByUrl(url), true)),
    navigateForward: vi.fn(async (url: string) => (await routerRef.navigateByUrl(url), true)),
  };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: LocalDb, useValue: db },
      { provide: AuthService, useValue: auth },
      { provide: NavController, useValue: nav },
      { provide: TOUR_RENDERER, useValue: renderer },
      { provide: TOUR_EVENT_SINK, useValue: { record: (e: TourEvent) => events.push(e) } },
      { provide: TOURS_ENABLED, useValue: o.toursEnabled ?? true },
      { provide: UiFeedback, useValue: { toast } },
      { provide: SyncService, useValue: { active: () => false, state: signal('local') } },
      { provide: KhayootaService, useValue: { configured: false, status: signal(null), statusError: signal(null) } },
    ],
  });
  routerRef = TestBed.inject(Router);
  const i18n = TestBed.inject(I18nService);
  i18n.lang.set(o.lang ?? 'en');
  const store = TestBed.inject(AppStore);
  const flush = async () => {
    for (let i = 0; i < 3; i++) {
      TestBed.tick();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  const goto = async (url: string) => {
    await routerRef.navigateByUrl(url);
    await flush();
  };
  TestBed.tick();
  await store.whenScopeLoaded(scope);
  await goto(o.url ?? '/tabs/home');
  const coordinator = TestBed.inject(TourCoordinator);
  await flush();
  return { coordinator, state: TestBed.inject(TourStateService), store, gate: TestBed.inject(TourGate), targets: TestBed.inject(TourTargetRegistry), renderer, events, auth, router: routerRef, nav, toast, i18n, docs, scopes, injector: TestBed.inject(Injector), flush, goto };
}

/** A minimal project as the store holds it. */
export function fakeProject(over: { id?: string; count?: number; round?: number; parts?: unknown[]; status?: 'active' | 'paused' | 'done'; mode?: 'simple' | 'pattern' } = {}): Project {
  const simple = { round: over.round ?? 1, target: 30, perTap: 1, count: over.count ?? 0, totalRounds: 0, history: [] };
  return {
    id: over.id ?? 'p1',
    name: 'Fake project',
    status: over.status ?? 'active',
    lastWorkedAt: 0,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    tracker: { mode: over.mode ?? 'simple', simple, cursor: { roundIndex: 0, ptr: 0, mode: 'action', history: [] }, patternId: null, updatedAt: 0 },
    parts: over.parts,
  } as unknown as Project;
}

/** Registers an element as visible on the active page so `whenReady` and `resolve` find it. */
export function showTarget(env: TourEnv, id: Parameters<TourTargetRegistry['register']>[0], attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement('div');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.getBoundingClientRect = () => ({ x: 0, y: 0, width: 80, height: 40, top: 0, left: 0, right: 80, bottom: 40, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(el);
  env.targets.register(id, el);
  return el;
}
