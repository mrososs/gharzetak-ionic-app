import { describe, expect, it } from 'vitest';
import { TABS, isBarHiddenFor, tabIdFromUrl } from './tabs.config';

describe('tabs config', () => {
  it('keeps the five tabs in the approved order with the Tracker in the middle', () => {
    expect(TABS.map((t) => t.id)).toEqual(['home', 'projects', 'tracker', 'learn', 'assistant']);
    expect(TABS.filter((t) => t.mid).map((t) => t.id)).toEqual(['tracker']);
    expect(TABS.findIndex((t) => t.mid)).toBe(Math.floor(TABS.length / 2));
  });

  it('has Arabic and English labels for every tab', () => {
    for (const t of TABS) {
      expect(t.ar.length).toBeGreaterThan(0);
      expect(t.en.length).toBeGreaterThan(0);
    }
  });

  describe('tabIdFromUrl', () => {
    it.each([
      ['/tabs/home', 'home'],
      ['/tabs/home/settings', 'home'],
      ['/tabs/home/patterns/42', 'home'],
      ['/tabs/projects/7?x=1', 'projects'],
      ['/tabs/tracker#top', 'tracker'],
      ['/tabs/learn/abc', 'learn'],
      ['/tabs/assistant', 'assistant'],
    ])('%s → %s', (url, id) => expect(tabIdFromUrl(url)).toBe(id));

    it.each(['/', '/auth/login', '/tabs', '/tabs/', '/tabs/unknown', '/tabsx/home', '/onboarding/welcome'])('%s → null', (url) =>
      expect(tabIdFromUrl(url)).toBeNull(),
    );
  });

  describe('isBarHiddenFor', () => {
    it.each(['/tabs/projects/new', '/tabs/home/patterns/new', '/tabs/projects/new?from=home'])('hides on %s', (u) => expect(isBarHiddenFor(u)).toBe(true));
    it.each(['/tabs/projects', '/tabs/projects/newton', '/tabs/home/patterns/new-ish', '/tabs/home'])('shows on %s', (u) => expect(isBarHiddenFor(u)).toBe(false));
  });
});
