/** Every tour the app can run. Adding a tour = add an id here, one definition file and one registry line. */
export const TOUR_IDS = ['welcome', 'patterns', 'pattern-reader', 'tracker-simple', 'tracker-pattern', 'tracker-parts', 'project-create', 'khayoota'] as const;
export type TourId = (typeof TOUR_IDS)[number];

/**
 * Real things the user did, remembered so a Getting Started task stays ticked afterwards (an Undo or a deleted project must not
 * un-tick a task). Recorded only from genuine actions or genuine stored state, never from viewing a tour step.
 */
export const MILESTONE_IDS = ['patternOpened', 'tutorialOpened', 'projectCreated', 'trackerTried', 'khayootaAsked'] as const;
export type MilestoneId = (typeof MILESTONE_IDS)[number];

/** Every id usable with `[gzTour]`. A union, so a typo is a compile error on both the template side and the definition side. */
export type TargetId =
  | 'tab.projects'
  | 'tab.tracker'
  | 'tab.learn'
  | 'tab.assistant'
  | 'home.patterns-tile'
  | 'home.avatar'
  | 'home.getting-started'
  | 'patterns.sample-row'
  | 'patterns.kind-filter'
  | 'patterns.add'
  | 'reader.focus-card'
  | 'reader.next-round'
  | 'reader.track'
  | 'project-new.name'
  | 'project-new.source'
  | 'tracker.ring'
  | 'tracker.tap'
  | 'tracker.undo'
  | 'tracker.tap-row'
  | 'tracker.project-picker'
  | 'tracker.round-pills'
  | 'tracker.instruction'
  | 'tracker.current-step'
  | 'tracker.count-by'
  | 'tracker.piece-tabs'
  | 'tracker.completion'
  | 'khayoota.status'
  | 'khayoota.composer'
  | 'khayoota.menu';
