import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../core/auth/auth.service';
import { JoyLedgerService } from '../../../core/joy/joy-ledger.service';
import { JoyPresenter } from '../../../core/joy/joy-presenter.service';
import { JoyService } from '../../../core/joy/joy.service';
import { HapticsService } from '../../../core/services/haptics.service';
import { AppStore } from '../../../core/state/app.store';
import { LocalDb } from '../../../core/storage/local-db';
import { AvatarReactionComponent } from '../avatar/avatar-reaction.component';
import { JoyBannerComponent } from './joy-banner.component';

describe('Joy UI components', () => {
  let store: AppStore;
  let presenter: JoyPresenter;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [AppStore, JoyService, JoyLedgerService, JoyPresenter, LocalDb, { provide: HapticsService, useValue: { supported: false, impact: vi.fn(), success: vi.fn() } }, { provide: AuthService, useValue: { scope: signal('user:a') } }],
    });
    store = TestBed.inject(AppStore);
    presenter = TestBed.inject(JoyPresenter);
    TestBed.tick();
    await store.whenScopeLoaded('user:a');
  });

  const show = (text = '✓ Round 3') => presenter.banner.set({ id: 1, text, mood: 'happy', rounds: 1 });

  describe('<gz-joy-banner>', () => {
    it('is always a polite live region (even when empty) so a screen reader announces each banner once', () => {
      const f = TestBed.createComponent(JoyBannerComponent);
      f.detectChanges();
      const live = f.nativeElement.querySelector('[role="status"]') as HTMLElement;
      expect(live).toBeTruthy();
      expect(live.getAttribute('aria-live')).toBe('polite');
      expect(f.nativeElement.querySelector('.pill')).toBeNull();
      show('Brilliant! Round 3 is done! 🧶');
      f.detectChanges();
      expect(f.nativeElement.querySelector('.pill .txt')?.textContent).toContain('Round 3');
      expect(f.nativeElement.querySelectorAll('[aria-live]').length).toBe(1); // exactly one announcement channel
    });

    it('never steals focus and is not a dialog', () => {
      const f = TestBed.createComponent(JoyBannerComponent);
      const input = document.createElement('button');
      document.body.appendChild(input);
      input.focus();
      f.detectChanges();
      show();
      f.detectChanges();
      expect(document.activeElement).toBe(input);
      expect(f.nativeElement.querySelector('[role="dialog"], [aria-modal]')).toBeNull();
      input.remove();
    });

    it('can be dismissed by hand', () => {
      const f = TestBed.createComponent(JoyBannerComponent);
      show();
      f.detectChanges();
      (f.nativeElement.querySelector('button.x') as HTMLButtonElement).click();
      f.detectChanges();
      expect(presenter.banner()).toBeNull();
      expect(f.nativeElement.querySelector('.pill')).toBeNull();
    });

    it('the dismiss control has an accessible name, and the avatar inside is decorative', () => {
      const f = TestBed.createComponent(JoyBannerComponent);
      show();
      f.detectChanges();
      expect((f.nativeElement.querySelector('button.x') as HTMLElement).getAttribute('aria-label')).toBeTruthy();
      expect(f.nativeElement.querySelector('gz-crochet-avatar img')?.getAttribute('alt')).toBe('');
    });

    it('inline variant keeps a reserved line (no layout shift) and is flagged for the video page', () => {
      const f = TestBed.createComponent(JoyBannerComponent);
      f.componentRef.setInput('inline', true);
      f.detectChanges();
      expect(f.nativeElement.classList.contains('inline')).toBe(true);
    });
  });

  describe('<gz-avatar-reaction>', () => {
    const make = (mood: 'happy' | 'celebrate' | 'proud' | 'relaxed') => {
      const f = TestBed.createComponent(AvatarReactionComponent);
      f.componentRef.setInput('id', 'bunny');
      f.componentRef.setInput('mood', mood);
      f.detectChanges();
      return f;
    };

    it('reuses the existing avatar art, adds a shared overlay only for non-happy moods, and is decorative', () => {
      const happy = make('happy');
      expect(happy.nativeElement.querySelector('img.ov')).toBeNull();
      expect(happy.nativeElement.querySelector('gz-crochet-avatar img')?.getAttribute('src')).toContain('assets/avatars/bunny.svg');
      expect(make('celebrate').nativeElement.querySelector('img.ov')?.getAttribute('src')).toContain('overlay-hearts.svg');
      expect(make('proud').nativeElement.querySelector('img.ov')?.getAttribute('src')).toContain('overlay-sparkles.svg');
      const relaxed = make('relaxed');
      expect(relaxed.nativeElement.querySelector('img.ov')?.getAttribute('src')).toContain('overlay-tea.svg');
      expect(relaxed.nativeElement.querySelector('img.ov')?.getAttribute('aria-hidden')).toBe('true');
      expect(relaxed.nativeElement.querySelector('img.ov')?.getAttribute('alt')).toBe('');
    });

    it('stays still when the in-app "reduce motion" preference is on', async () => {
      const f = make('celebrate');
      expect(f.nativeElement.querySelector('.av')?.classList.contains('still')).toBe(false);
      await store.updatePrefs({ joy: { motion: 'reduced' } });
      f.detectChanges();
      expect(f.nativeElement.querySelector('.av')?.classList.contains('still')).toBe(true);
    });

    it('replays when `run` changes (a new element, so the one-shot animation restarts)', () => {
      const f = make('happy');
      const before = f.nativeElement.querySelector('.av');
      f.componentRef.setInput('run', 1);
      f.detectChanges();
      expect(f.nativeElement.querySelector('.av')).not.toBe(before);
    });
  });
});
