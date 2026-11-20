import { describe, expect, it } from 'vitest';
import { createPatternCursor, createSimpleCounter } from '../domain/tracker-engine';
import type { ChatMessage, Project } from '../models/models';
import { GS_TASKS, derivedDone, gsDoneCount, newlyDone, projectHasProgress, taskDone } from './getting-started';

const project = (over: { simple?: Parameters<typeof createSimpleCounter>[0]; cursor?: Parameters<typeof createPatternCursor>[0]; parts?: unknown[] } = {}): Project =>
  ({
    id: 'p1',
    tracker: { mode: 'simple', simple: createSimpleCounter(over.simple), cursor: createPatternCursor(over.cursor), patternId: null, updatedAt: 0 },
    parts: over.parts,
  }) as unknown as Project;
const msg = (role: 'user' | 'bot'): ChatMessage => ({ id: role + Math.random(), role, text: 'x' });
const input = (o: Partial<{ milestones: Record<string, number>; projects: Project[]; chat: ChatMessage[] }> = {}) => ({ milestones: {}, projects: [], chat: [], ...o });

describe('projectHasProgress — counting really happened', () => {
  it('a project nobody has counted on has none', () => {
    expect(projectHasProgress(project())).toBe(false);
  });
  it('simple counter: a counted stitch, a later round, or any undo history', () => {
    expect(projectHasProgress(project({ simple: { count: 1 } }))).toBe(true);
    expect(projectHasProgress(project({ simple: { round: 2 } }))).toBe(true);
  });
  it('pattern cursor: a later round or a position inside a round', () => {
    expect(projectHasProgress(project({ cursor: { roundIndex: 1 } }))).toBe(true);
    expect(projectHasProgress(project({ cursor: { ptr: 2 } }))).toBe(true);
  });
  it('a multi-part project counts progress on any of its pieces', () => {
    const piece = { id: 'i1', simple: createSimpleCounter({ count: 3 }), cursor: createPatternCursor() };
    expect(projectHasProgress(project({ parts: [piece] }))).toBe(true);
    expect(projectHasProgress(project({ parts: [{ id: 'i2', simple: createSimpleCounter(), cursor: createPatternCursor() }] }))).toBe(false);
  });
});

describe('Getting Started tasks are ticked by real state, never by viewing a tour', () => {
  it('nothing is done for a new user', () => {
    expect(Object.values(taskDone(input()))).toEqual([false, false, false, false, false]);
  });

  it('a project ticks "project" but not "tracker" until counting happens', () => {
    const d = taskDone(input({ projects: [project()] }));
    expect(d.project).toBe(true);
    expect(d.tracker).toBe(false);
    expect(taskDone(input({ projects: [project({ simple: { count: 1 } })] })).tracker).toBe(true);
  });

  it('a Khayoota question ticks only for a USER message (the greeting or a bot reply is not a question)', () => {
    expect(taskDone(input({ chat: [msg('bot')] })).khayoota).toBe(false);
    expect(taskDone(input({ chat: [msg('bot'), msg('user')] })).khayoota).toBe(true);
  });

  it('pattern and tutorial tasks can only come from the pages that record them', () => {
    expect(derivedDone(input({ projects: [project()], chat: [msg('user')] })).pattern).toBe(false);
    expect(derivedDone(input({ projects: [project()], chat: [msg('user')] })).learn).toBe(false);
    const d = taskDone(input({ milestones: { patternOpened: 1, tutorialOpened: 2 } }));
    expect(d.pattern).toBe(true);
    expect(d.learn).toBe(true);
  });

  it('a remembered milestone keeps a task ticked after Undo, or after the project is deleted', () => {
    const d = taskDone(input({ milestones: { projectCreated: 5, trackerTried: 6 }, projects: [] }));
    expect(d.project).toBe(true);
    expect(d.tracker).toBe(true);
  });

  it('newlyDone lists what is true now but not remembered yet, so each is recorded once', () => {
    const i = input({ projects: [project({ simple: { count: 1 } })], chat: [msg('user')] });
    expect(newlyDone(i).sort()).toEqual(['khayoota', 'project', 'tracker']);
    expect(newlyDone({ ...i, milestones: { projectCreated: 1, trackerTried: 1, khayootaAsked: 1 } })).toEqual([]);
  });

  it('counts done tasks out of five', () => {
    expect(GS_TASKS.length).toBe(5);
    expect(gsDoneCount(taskDone(input({ milestones: { patternOpened: 1, tutorialOpened: 1 } })))).toBe(2);
  });
});
