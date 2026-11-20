import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveText } from './tour-labels';
import { ALL_TOURS, TOUR_REGISTRY, routeMatches } from './tour-registry';
import { TOUR_IDS } from './tour-ids';
import type { LocalText, StepText, TourContext } from './tour.types';

/** Every source file of the app, as text (specs and this folder's own definitions excluded where it matters). */
function sources(dir = join(process.cwd(), 'src', 'app')): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(ts|html)$/.test(name) && !name.endsWith('.spec.ts')) out.push({ file: p.replace(/\\/g, '/'), text: readFileSync(p, 'utf8') });
  }
  return out;
}

const ctx = (o: Partial<TourContext> = {}): TourContext => ({ lang: 'en', guest: true, hasProjects: false, trackerLayout: 'simple', khayootaMode: '', khayootaSettled: true, ...o });
/** Every variant of a step text the app can produce. */
function variants(t: StepText): LocalText[] {
  if (typeof t !== 'function') return [t];
  const out: LocalText[] = [];
  for (const mode of ['', 'rules', 'offline', 'demo', 'soon', 'consent', 'ai', 'something-new']) for (const hasProjects of [true, false]) out.push(t(ctx({ khayootaMode: mode, hasProjects })));
  return out;
}

describe('tour definitions — structure', () => {
  it('the registry has exactly one definition for every tour id, under its own id', () => {
    expect(Object.keys(TOUR_REGISTRY).sort()).toEqual([...TOUR_IDS].sort());
    for (const id of TOUR_IDS) expect(TOUR_REGISTRY[id].id).toBe(id);
  });

  it('step ids are unique across the whole system (they are stored and logged, so they must never collide)', () => {
    const ids = ALL_TOURS.flatMap((d) => d.steps.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('step budgets: welcome 6, simple tracker 4, pattern tracker 5, nothing above 6', () => {
    const n = (id: (typeof TOUR_IDS)[number]) => TOUR_REGISTRY[id].steps.length;
    expect(n('welcome')).toBe(6);
    expect(n('tracker-simple')).toBe(4);
    expect(n('tracker-pattern')).toBe(5);
    expect(n('patterns')).toBe(3);
    expect(n('pattern-reader')).toBe(3);
    expect(n('project-create')).toBe(2);
    expect(n('tracker-parts')).toBe(2);
    expect(n('khayoota')).toBe(3);
    for (const d of ALL_TOURS) expect(d.steps.length).toBeLessThanOrEqual(6);
  });

  it('the single invited tap is the simple tracker counting button, and nothing else in the system is an action step', () => {
    const actions = ALL_TOURS.flatMap((d) => d.steps.filter((s) => s.interaction === 'action').map((s) => `${d.id}:${s.target}`));
    expect(actions).toEqual(['tracker-simple:tracker.tap']);
  });

  it('highlight-only tours: pattern tracker, pattern reader and Khayoota can never ask for a tap', () => {
    for (const id of ['tracker-pattern', 'pattern-reader', 'khayoota', 'welcome', 'patterns', 'project-create', 'tracker-parts'] as const) {
      expect(TOUR_REGISTRY[id].steps.every((s) => (s.interaction ?? 'blocked') === 'blocked'), id).toBe(true);
    }
  });

  it('the welcome tour never navigates: every target is on Home or in the tab bar', () => {
    const allowed = new Set(['home.patterns-tile', 'tab.projects', 'tab.tracker', 'tab.learn', 'tab.assistant', 'home.avatar']);
    for (const s of TOUR_REGISTRY.welcome.steps) expect(allowed.has(s.target), s.target).toBe(true);
  });

  it('no step uses a physical side (left/right): the app is bidirectional', () => {
    for (const d of ALL_TOURS) for (const s of d.steps) expect(['top', 'bottom', 'auto', undefined]).toContain(s.side);
  });

  it('route matching: each tour belongs to exactly its own screen', () => {
    expect(routeMatches(TOUR_REGISTRY.welcome, '/tabs/home')).toBe(true);
    expect(routeMatches(TOUR_REGISTRY.welcome, '/tabs/home/settings')).toBe(false);
    expect(routeMatches(TOUR_REGISTRY.patterns, '/tabs/home/patterns?x=1')).toBe(true);
    expect(routeMatches(TOUR_REGISTRY.patterns, '/tabs/home/patterns/new')).toBe(false);
    expect(routeMatches(TOUR_REGISTRY['pattern-reader'], '/tabs/home/patterns/00000000-0000-4000-8000-0000000000a1')).toBe(true);
    for (const other of ['/tabs/home/patterns/new', '/tabs/home/patterns/import', '/tabs/home/patterns', '/tabs/home/patterns/abc/edit']) expect(routeMatches(TOUR_REGISTRY['pattern-reader'], other), other).toBe(false);
    expect(routeMatches(TOUR_REGISTRY['tracker-simple'], '/tabs/tracker')).toBe(true);
    expect(routeMatches(TOUR_REGISTRY['project-create'], '/tabs/projects/new')).toBe(true);
    expect(routeMatches(TOUR_REGISTRY['project-create'], '/tabs/projects')).toBe(false);
    expect(routeMatches(TOUR_REGISTRY.khayoota, '/tabs/assistant')).toBe(true);
    for (const d of ALL_TOURS) expect(routeMatches(d, '/design-system'), d.id).toBe(false);
    for (const d of ALL_TOURS) expect(routeMatches(d, '/onboarding/welcome'), d.id).toBe(false);
  });

  it('canRun picks the right tracker tour for each layout, and the Khayoota tour waits for its status', () => {
    const layouts = ['none', 'simple', 'pattern', 'parts-simple', 'parts-pattern'] as const;
    const runs = (id: (typeof TOUR_IDS)[number]) => layouts.filter((l) => TOUR_REGISTRY[id].canRun(ctx({ trackerLayout: l })));
    expect(runs('tracker-simple')).toEqual(['simple', 'parts-simple']);
    expect(runs('tracker-pattern')).toEqual(['pattern', 'parts-pattern']);
    expect(runs('tracker-parts')).toEqual(['parts-simple', 'parts-pattern']);
    expect(TOUR_REGISTRY.khayoota.canRun(ctx({ khayootaSettled: false }))).toBe(false);
    expect(TOUR_REGISTRY.khayoota.canRun(ctx({ khayootaSettled: true }))).toBe(true);
  });
});

describe('tour copy — complete, bilingual, short and honest', () => {
  const texts = ALL_TOURS.flatMap((d) => d.steps.flatMap((s) => [{ id: `${s.id}.title`, vs: variants(s.title) }, { id: `${s.id}.body`, vs: variants(s.body) }, ...(s.hint ? [{ id: `${s.id}.hint`, vs: variants(s.hint) }] : [])]));

  it('every title, body and hint exists in Arabic and English, in every variant', () => {
    for (const t of texts) for (const v of t.vs) {
      expect(v.ar.trim().length, t.id + ' ar').toBeGreaterThan(0);
      expect(v.en.trim().length, t.id + ' en').toBeGreaterThan(0);
    }
  });

  it('Arabic copy really is Arabic and English copy really is English', () => {
    for (const t of texts) for (const v of t.vs) {
      expect(/[؀-ۿ]/.test(v.ar), t.id + ' ar has Arabic letters').toBe(true);
      expect(/[؀-ۿ]/.test(v.en), t.id + ' en has no Arabic').toBe(false);
    }
  });

  it('titles are at most 4 words, bodies at most 2 sentences and about 140 characters', () => {
    for (const d of ALL_TOURS) for (const s of d.steps) for (const v of variants(s.title)) {
      expect(v.en.trim().split(/\s+/).length, `${s.id} en title`).toBeLessThanOrEqual(4);
      expect(v.ar.trim().split(/\s+/).length, `${s.id} ar title`).toBeLessThanOrEqual(4);
    }
    for (const d of ALL_TOURS) for (const s of d.steps) for (const v of variants(s.body)) for (const lang of ['ar', 'en'] as const) {
      const sentences = v[lang].split(/[.!؟?]+/).map((x) => x.trim()).filter(Boolean);
      expect(sentences.length, `${s.id} ${lang} sentences`).toBeLessThanOrEqual(2);
      expect(v[lang].length, `${s.id} ${lang} length`).toBeLessThanOrEqual(140);
    }
  });

  it('copy is plain text: nothing that could be read as markup', () => {
    for (const t of texts) for (const v of t.vs) for (const s of [v.ar, v.en]) expect(/[<>]/.test(s), t.id).toBe(false);
  });

  it('Khayoota wording follows the real mode and never promises AI to someone who does not have it', () => {
    const step = (i: number, mode: string, key: 'title' | 'body') => resolveText(TOUR_REGISTRY.khayoota.steps[i][key], ctx({ khayootaMode: mode }));
    for (const mode of ['rules', 'offline', 'demo', '', 'unknown-new-mode']) {
      const b = step(0, mode, 'body');
      expect(b.en, mode).toMatch(/built-in rules, not AI/);
      expect(b.ar, mode).toContain('مش ذكاء اصطناعي');
      expect(step(2, mode, 'body').en, mode).not.toMatch(/turn Khayoota AI off/);
    }
    expect(step(0, 'soon', 'body').en).toMatch(/still in testing/);
    expect(step(0, 'soon', 'body').en).not.toMatch(/answers with AI/);
    expect(step(0, 'consent', 'body').en).toMatch(/ask for your OK/);
    expect(step(0, 'ai', 'body').en).toMatch(/can be wrong/);
    expect(step(2, 'ai', 'body').en).toMatch(/turn Khayoota AI off/);
    expect(step(2, 'consent', 'body').en).toMatch(/turn Khayoota AI off/);
  });

  it('Khayoota copy never mentions photos, reading a pattern from an image, or perfect answers in any mode', () => {
    for (const s of TOUR_REGISTRY.khayoota.steps) for (const key of ['title', 'body'] as const) for (const v of variants(s[key])) expect(`${v.en} ${v.ar}`.toLowerCase(), s.id).not.toMatch(/photo|image|camera|accurate|perfect|صور|كاميرا/);
  });

  it('the pattern reader wording changes with whether the person has a project', () => {
    const s = TOUR_REGISTRY['pattern-reader'].steps[2];
    expect(resolveText(s.title, ctx({ hasProjects: true })).en).toBe('Count along with it');
    expect(resolveText(s.title, ctx({ hasProjects: false })).en).toBe('Want to count along?');
    expect(resolveText(s.body, ctx({ hasProjects: false })).en).toMatch(/Create a new project/);
  });

  it('the app\'s own words are used: a "collection" is a multi-part pattern, never "collection"', () => {
    for (const t of texts) for (const v of t.vs) expect(v.en.toLowerCase(), t.id).not.toContain('collection');
  });
});

describe('tour wiring — a target can only exist if a template really marks it', () => {
  const files = sources();
  const outside = files.filter((f) => !f.file.includes('/core/tour/'));

  it('every target id used by a definition is marked by a page or component', () => {
    const missing: string[] = [];
    for (const d of ALL_TOURS) for (const s of d.steps) if (!outside.some((f) => f.text.includes(`'${s.target}'`))) missing.push(`${d.id}:${s.target}`);
    expect(missing).toEqual([]);
  });

  it('every id in the TargetId union is used by some definition or by a card (no dead ids)', () => {
    const union = readFileSync(join(process.cwd(), 'src/app/core/tour/tour-ids.ts'), 'utf8');
    const ids = [...union.matchAll(/\| '([a-z.-]+)'/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(20);
    const used = new Set(ALL_TOURS.flatMap((d) => d.steps.map((s) => s.target)));
    const dead = ids.filter((id) => !used.has(id as never) && !outside.some((f) => f.text.includes(`'${id}'`)));
    expect(dead).toEqual([]);
  });

  it('Driver.js is imported by exactly one file: the adapter', () => {
    const importers = files.filter((f) => /from 'driver\.js'|import\('driver\.js'\)|require\('driver\.js'\)/.test(f.text)).map((f) => f.file.split('/src/app/')[1]);
    expect(importers).toEqual(['core/tour/driver-tour-renderer.ts']);
  });

  it('the engine is loaded lazily and never imported statically with a value import', () => {
    const adapter = files.find((f) => f.file.endsWith('driver-tour-renderer.ts'))!.text;
    expect(adapter).toMatch(/await import\('driver\.js'\)/);
    expect(adapter).not.toMatch(/^import \{[^}]*\} from 'driver\.js'/m); // only `import type` is allowed at the top
    expect(adapter).toMatch(/^import type \{[^}]*\} from 'driver\.js'/m);
  });

  it('no tour code makes a network request, reads a token, or stores anything outside the scope preferences', () => {
    for (const f of files.filter((x) => x.file.includes('/core/tour/'))) {
      expect(f.text, f.file).not.toMatch(/\bfetch\(|XMLHttpRequest|HttpClient|ApiClient|sendBeacon|localStorage|sessionStorage|indexedDB/);
    }
  });

  it('the tour system touches Khayoota only to READ whether its status has settled: it can never send, consent, withdraw or refresh', () => {
    const tourFiles = files.filter((x) => x.file.includes('/core/tour/') || x.file.includes('/shared/ui/tour/'));
    for (const f of tourFiles) {
      const used = [...f.text.matchAll(/\bkh\.(\w+)/g)].map((m) => m[1]);
      for (const member of used) expect(['configured', 'status', 'statusError'], `${f.file}: kh.${member}`).toContain(member);
      expect(f.text, f.file).not.toMatch(/refreshStatus|acceptConsent|withdrawConsent|\.hostedChat|\.extractPattern|AssistantService/);
    }
  });

  it('the tour event log type has no free-text field, so user content cannot be logged by construction', () => {
    const types = readFileSync(join(process.cwd(), 'src/app/core/tour/tour.types.ts'), 'utf8');
    const events = types.slice(types.indexOf('export type TourEvent ='), types.indexOf('/** What is stored'));
    const fields = new Set([...events.matchAll(/readonly (\w+)\??:/g)].map((m) => m[1]));
    // Only event names, tour / task ids, step ids (stable ids from the definitions), counters and reason codes may be logged.
    expect([...fields].sort()).toEqual(['index', 'kind', 'name', 'reason', 'source', 'step', 'task', 'tour', 'via']);
  });
});
