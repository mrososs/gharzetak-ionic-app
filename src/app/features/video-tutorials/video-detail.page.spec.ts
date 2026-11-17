import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavController } from '@ionic/angular';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/auth/auth.service';
import { VIDEOS } from '../../core/data/catalog';
import { patternSetMode } from '../../core/domain/tracker-engine';
import { JoyLedgerService } from '../../core/joy/joy-ledger.service';
import { JoyService } from '../../core/joy/joy.service';
import { Pattern } from '../../core/models/models';
import { AppStore } from '../../core/state/app.store';
import { createProject, uuid } from '../../core/state/factories';
import { LocalDb } from '../../core/storage/local-db';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { VideoDetailPage } from './video-detail.page';

const PINNED = 'R1: 6sc in MR [6]\nR2: inc x 6 [12]\nR3: 12sc [12]';
const LIVE_EDITED = 'R1: 6sc in MR [6]'; // the pattern was edited AFTER the project was pinned: it now has a single round
const flush = () => new Promise((r) => setTimeout(r, 8));

describe('VideoDetailPage counter', () => {
  let store: AppStore;
  let joy: JoyService;
  let ledger: JoyLedgerService;
  let page: { tap(): void; undo(): void; counter(): { sub: string } | null };
  const videoId = VIDEOS[0].id;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        AppStore, JoyService, JoyLedgerService, LocalDb,
        { provide: AuthService, useValue: { scope: signal('user:test') } },
        { provide: NavController, useValue: { navigateBack: vi.fn(), navigateForward: vi.fn() } },
        { provide: UiFeedback, useValue: { say: vi.fn(), toast: vi.fn(), confirm: vi.fn() } },
      ],
    });
    store = TestBed.inject(AppStore);
    joy = TestBed.inject(JoyService);
    ledger = TestBed.inject(JoyLedgerService);
    TestBed.tick();
    await store.whenScopeLoaded('user:test');
    TestBed.tick();
  });

  async function pinnedProject() {
    const pat: Pattern = { id: uuid(), isSample: false, name: 'Ball', level: 'beginner', terms: 'us', source: 'text', text: PINNED, file: null, attribution: '', sourceUrl: '', position: 0, updatedAt: 1, deletedAt: null };
    await store.addPattern(pat);
    const p = createProject({ name: 'Ball', category: 'amigurumi', hook: '3.0', yarn: 'cotton', target: 0, coverLocalUrl: null, patternId: pat.id, totalRounds: 3 });
    await store.addProject(p);
    await store.updateTracker(p.id, (t) => ({ ...t, cursor: patternSetMode(t.cursor, 'round') }));
    // the project is pinned to the revision it started with, then the live pattern is edited underneath it
    await store.updateProject(p.id, (x) => ({ ...x, patternPin: { rev: 1, name: 'Ball', text: PINNED, terms: 'us' } }));
    await store.updatePattern(pat.id, (x) => ({ ...x, text: LIVE_EDITED, rev: 2 }));
    await store.updateTutorial(videoId, { projectId: p.id });
    const fixture = TestBed.createComponent(VideoDetailPage);
    fixture.componentRef.setInput('id', videoId);
    fixture.detectChanges();
    page = fixture.componentInstance as unknown as typeof page;
    return p;
  }

  it('counts against the PINNED pattern revision, not the edited live text', async () => {
    const p = await pinnedProject();
    expect(page.counter()?.sub).toContain('R1');
    page.tap();
    await flush();
    // pinned text has 3 rounds, so round mode moves on to round 2; the live text (1 round) would have stayed on the last round
    expect(store.project(p.id)!.tracker.cursor.roundIndex).toBe(1);
    expect(page.counter()?.sub).toContain('R2');
  });

  it('uses the same completion detection and ledger as the main tracker (one row per round, silent undo, no duplicates)', async () => {
    const p = await pinnedProject();
    page.tap();
    await flush();
    expect(joy.batch()?.requests.map((r) => r.event.kind)).toEqual(['round']);
    expect(ledger.counts().round).toBe(1);
    const seq = joy.batch()!.seq;
    page.undo();
    await flush();
    expect(store.project(p.id)!.tracker.cursor.roundIndex).toBe(0);
    expect(joy.batch()!.seq).toBe(seq); // undo is silent
    page.tap();
    await flush();
    expect(joy.batch()!.seq).toBe(seq); // re-completing the same round: already in the ledger
    expect(ledger.counts().round).toBe(1);
  });
});
