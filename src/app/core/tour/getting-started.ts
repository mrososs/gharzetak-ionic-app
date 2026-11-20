import type { PatternCursor, SimpleCounter } from '../domain/tracker-engine';
import type { ChatMessage, Project } from '../models/models';
import type { MilestoneId } from './tour-ids';

/** The five first steps shown in the Getting Started card, in order. */
export const GS_TASKS = ['pattern', 'project', 'tracker', 'learn', 'khayoota'] as const;
export type GsTask = (typeof GS_TASKS)[number];

const MILESTONE_OF: Record<GsTask, MilestoneId> = {
  pattern: 'patternOpened',
  project: 'projectCreated',
  tracker: 'trackerTried',
  learn: 'tutorialOpened',
  khayoota: 'khayootaAsked',
};
export const milestoneOf = (t: GsTask): MilestoneId => MILESTONE_OF[t];

export interface GsInput {
  readonly milestones: Partial<Record<MilestoneId, number>>;
  readonly projects: readonly Project[];
  readonly chat: readonly ChatMessage[];
}

const simpleMoved = (s: SimpleCounter | undefined): boolean => !!s && (s.count > 0 || s.round > 1 || (s.history?.length ?? 0) > 0);
const cursorMoved = (c: PatternCursor | undefined): boolean => !!c && (c.roundIndex > 0 || c.ptr > 0 || (c.history?.length ?? 0) > 0);

/** True when counting has really happened on this project (on its own tracker or on any of its pieces). Reading a project never counts. */
export function projectHasProgress(p: Project): boolean {
  if (simpleMoved(p.tracker?.simple) || cursorMoved(p.tracker?.cursor)) return true;
  return (p.parts ?? []).some((i) => simpleMoved(i.simple) || cursorMoved(i.cursor));
}

/** What the stored state says right now, without remembering anything. */
export function derivedDone(input: Pick<GsInput, 'projects' | 'chat'>): Record<GsTask, boolean> {
  return {
    pattern: false, // only the reader page can say a pattern was opened
    project: input.projects.length > 0,
    tracker: input.projects.some(projectHasProgress),
    learn: false, // only the video page can say a tutorial was opened
    khayoota: input.chat.some((m) => m.role === 'user'),
  };
}

/** What the card shows: a task is done if the stored state says so now, or if it was seen done before (so Undo or a delete never un-ticks it). */
export function taskDone(input: GsInput): Record<GsTask, boolean> {
  const now = derivedDone(input);
  const out = {} as Record<GsTask, boolean>;
  for (const t of GS_TASKS) out[t] = now[t] || !!input.milestones[MILESTONE_OF[t]];
  return out;
}

/** Milestones that are true right now but not yet remembered. */
export function newlyDone(input: GsInput): GsTask[] {
  const now = derivedDone(input);
  return GS_TASKS.filter((t) => now[t] && !input.milestones[MILESTONE_OF[t]]);
}

export const gsDoneCount = (done: Record<GsTask, boolean>): number => GS_TASKS.filter((t) => done[t]).length;
