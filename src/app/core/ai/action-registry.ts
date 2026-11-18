/**
 * Khayoota typed actions — the app-side allowlist (agentic-ui-design.md §4).
 *
 * An action proposed by the model is rendered only if (1) its id is allowlisted, (2) its payload has exactly the expected
 * shape, and (3) every id in it resolves in the LOCAL store of the signed-in scope. The same checks run again when the user
 * taps (`resolve` is called at render AND at tap), so a deleted project or a stale proposal can never be acted on.
 * Executors only navigate through existing screens; none of them changes progress, saves, or deletes anything.
 */
import { TERMS, VIDEOS } from '../data/catalog';
import type { Project } from '../models/models';
import type { ActionProposal } from './khayoota.types';

export const ALLOWED_ACTIONS = ['tracker.openCurrentRound', 'project.openPart', 'learn.explainStitch'] as const;
export type AllowedAction = (typeof ALLOWED_ACTIONS)[number];

const STITCHES = new Set(TERMS.map((t) => t.k));
const TOPICS = new Set(VIDEOS.map((v) => v.id));
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type ResolvedAction =
  | { kind: 'tracker.openCurrentRound'; projectId: string; instanceId: string | null; projectName: string; partLabel: string | null }
  | { kind: 'project.openPart'; projectId: string; instanceId: string; projectName: string; partLabel: string }
  | { kind: 'learn.explainStitch'; stitch: string; topic: string | null };

export interface ActionLookup {
  project(id: string): Project | null;
  partLabel(p: Project, instanceId: string): string | null;
}

const onlyKeys = (o: Record<string, unknown>, allowed: string[]) => Object.keys(o).every((k) => allowed.includes(k));
const str = (v: unknown) => (typeof v === 'string' && ID_RE.test(v) ? v : null);

/** Shape + local-resolution check. Returns null for anything that must not be rendered or executed. */
export function resolveAction(a: ActionProposal | null | undefined, lookup: ActionLookup): ResolvedAction | null {
  if (!a || typeof a !== 'object' || a.v !== 1 || !a.payload || typeof a.payload !== 'object') return null;
  const p = a.payload;
  switch (a.id) {
    case 'tracker.openCurrentRound': {
      if (!onlyKeys(p, ['projectId', 'partInstanceId'])) return null;
      const projectId = str(p['projectId']);
      const instanceId = p['partInstanceId'] === undefined ? null : str(p['partInstanceId']);
      if (!projectId || (p['partInstanceId'] !== undefined && !instanceId)) return null;
      const project = lookup.project(projectId);
      if (!project || project.deletedAt) return null;
      const label = instanceId ? lookup.partLabel(project, instanceId) : null;
      if (instanceId && !label) return null;
      return { kind: 'tracker.openCurrentRound', projectId, instanceId, projectName: project.name, partLabel: label };
    }
    case 'project.openPart': {
      if (!onlyKeys(p, ['projectId', 'partInstanceId'])) return null;
      const projectId = str(p['projectId']);
      const instanceId = str(p['partInstanceId']);
      if (!projectId || !instanceId) return null;
      const project = lookup.project(projectId);
      if (!project || project.deletedAt) return null;
      const label = lookup.partLabel(project, instanceId);
      if (!label) return null;
      return { kind: 'project.openPart', projectId, instanceId, projectName: project.name, partLabel: label };
    }
    case 'learn.explainStitch': {
      if (!onlyKeys(p, ['stitch', 'topic'])) return null;
      const stitch = typeof p['stitch'] === 'string' && STITCHES.has(p['stitch']) ? p['stitch'] : null;
      if (!stitch) return null;
      // An unknown tutorial topic is dropped (the tutorial page would silently fall back to the first topic).
      const topic = typeof p['topic'] === 'string' && TOPICS.has(p['topic']) ? p['topic'] : null;
      return { kind: 'learn.explainStitch', stitch, topic };
    }
    default:
      return null;
  }
}

/** Resolves a reply's actions; drops anything invalid; at most two. */
export function resolveActions(list: readonly ActionProposal[] | undefined, lookup: ActionLookup): ResolvedAction[] {
  const out: ResolvedAction[] = [];
  for (const a of list ?? []) {
    if (out.length >= 2) break;
    const r = resolveAction(a, lookup);
    if (r && !out.some((x) => JSON.stringify(x) === JSON.stringify(r))) out.push(r);
  }
  return out;
}
