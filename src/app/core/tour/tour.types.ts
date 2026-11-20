import type { MilestoneId, TargetId, TourId } from './tour-ids';

export interface LocalText {
  readonly ar: string;
  readonly en: string;
}

export type Lang = 'ar' | 'en';

export type TrackerLayout = 'none' | 'simple' | 'pattern' | 'parts-simple' | 'parts-pattern';

/** What a definition may consult when deciding to run or which words to use. No services, no DOM. */
export interface TourContext {
  readonly lang: Lang;
  readonly guest: boolean;
  readonly hasProjects: boolean;
  readonly trackerLayout: TrackerLayout;
  /** The Khayoota status line's `data-mode` (ai | demo | consent | soon | rules | offline), '' while unknown. */
  readonly khayootaMode: string;
  /** The Khayoota page has finished learning what the server allows (or never asks). */
  readonly khayootaSettled: boolean;
}

export type StepText = LocalText | ((ctx: TourContext) => LocalText);

export interface TourStep {
  /** Stable forever: used in saved progress and in the local event log. */
  readonly id: string;
  readonly target: TargetId;
  readonly title: StepText;
  readonly body: StepText;
  /** One line shown on an action step ("Try it: tap the button once"). Rendered by the app, never by the engine's `instruction`. */
  readonly hint?: StepText;
  /** `auto` lets the engine choose and flip. Only top/bottom exist: left/right are physical and wrong for a bidirectional app. */
  readonly side?: 'top' | 'bottom' | 'auto';
  /** Logical alignment: mirrored for RTL by the renderer. */
  readonly align?: 'start' | 'center' | 'end';
  /** `blocked` (default): highlight only. `action`: the element stays tappable and one tap advances; Next always works too. */
  readonly interaction?: 'blocked' | 'action';
  /** What to do when the target cannot be found in time. */
  readonly ifMissing: 'skip' | 'end';
  /** Included only while this holds (checked when the step is about to be shown). */
  readonly when?: (ctx: TourContext) => boolean;
  readonly stage?: { readonly padding?: number; readonly radius?: number };
}

export interface TourDefinition {
  readonly id: TourId;
  /** Bump only when the guidance is genuinely new. */
  readonly version: number;
  /** A version bump may re-offer the tour to users who finished an older version. Default false. */
  readonly announceOnBump?: boolean;
  /** The URL path (no query, no fragment) the tour belongs to. A tour ends if the app leaves it. */
  readonly route: { readonly match: RegExp };
  /** Where a replay from Settings goes first. */
  readonly entry: { readonly url: string; readonly mode: 'root' | 'forward' };
  /** How the first invitation is shown. */
  readonly offer: 'home-card' | 'pill';
  /** Extra conditions beyond the quiet gate. */
  readonly canRun: (ctx: TourContext) => boolean;
  readonly steps: readonly TourStep[];
  readonly onComplete?: 'toast-welcome-done';
}

export type TourStatus =
  | 'not_started'
  | 'offered' // an invitation has been shown and not answered
  | 'active' // steps are showing (persisted so a crash can be told apart from "never started")
  | 'completed' // reached the last step and pressed Done
  | 'skipped' // Skip, ×, or Android Back
  | 'declined' // "Not now", or the offer limit was reached
  | 'interrupted' // ended by the app: navigation, overlay, background, missing target, error
  | 'not_needed'; // evidence of earlier use

export type EndReason =
  | 'done'
  | 'skip'
  | 'close'
  | 'back'
  | 'navigation'
  | 'overlay'
  | 'background'
  | 'viewport'
  | 'scope-change'
  | 'lock'
  | 'missing-target'
  | 'error'
  | 'replaced';

export interface TourRecord {
  /** Definition version this record refers to. */
  readonly v: number;
  readonly status: TourStatus;
  /** Last step id shown (resume). */
  readonly step?: string;
  /** Times an invitation was shown: launches for the welcome card, visits for a pill. */
  readonly offers: number;
  readonly interruptions: number;
  /** Last change, epoch ms. */
  readonly at: number;
}

export interface TourPrefs {
  readonly v: 1;
  readonly tours: Partial<Record<TourId, TourRecord>>;
  readonly milestones: Partial<Record<MilestoneId, number>>;
  readonly gettingStarted?: { readonly hiddenAt?: number; readonly completedAt?: number };
  /** When evidence seeding ran for this scope. */
  readonly seededAt?: number;
  /** Set by an entry event (guest start, sign-up, new Google account, fresh sign-in): only then is the welcome tour offered. */
  readonly armed?: boolean;
}

/** What the app can observe about earlier use of a scope. */
export interface Evidence {
  readonly projects: number;
  readonly progressedProjects: number;
  readonly customPatterns: number;
  readonly collections: number;
  readonly userChatMessages: number;
}

// ---- rendering -------------------------------------------------------------------------------------------------------------

export interface RenderStep {
  readonly id: string;
  /** Resolves when the target is on the visible page and has held still for two frames, or null at the deadline / on abort. */
  readonly waitFor: (timeoutMs: number, signal: AbortSignal) => Promise<Element | null>;
  readonly side: 'top' | 'bottom' | 'auto';
  readonly align: 'start' | 'center' | 'end';
  readonly interaction: 'blocked' | 'action';
  readonly ifMissing: 'skip' | 'end';
  readonly stage?: { readonly padding?: number; readonly radius?: number };
}

export interface StepTexts {
  readonly title: string;
  readonly body: string;
  readonly hint?: string;
}

export interface RenderLabels {
  readonly next: string;
  readonly prev: string;
  readonly done: string;
  readonly skip: string;
  readonly close: string;
  /** Spoken progress, e.g. "Step 2 of 6". */
  readonly progress: (n: number, total: number) => string;
}

export interface RenderCallbacks {
  stepShown(stepId: string, index: number, total: number): void;
  stepSkippedMissing(stepId: string): void;
  ended(reason: EndReason, lastStepId: string | undefined): void;
}

export interface RenderOptions {
  readonly dir: 'rtl' | 'ltr';
  readonly reducedMotion: boolean;
  /** Text of step `index` in the language that is current right now (called again when the language changes mid-tour). */
  readonly textFor: (index: number) => StepTexts;
  readonly labels: RenderLabels;
}

/** The only thing the rest of the app knows about the tour engine. */
export interface TourRenderer {
  /** Resolves once the first step is on screen. Rejects if the engine could not be loaded or started. */
  start(steps: readonly RenderStep[], startIndex: number, options: RenderOptions, cb: RenderCallbacks): Promise<void>;
  /** The language or direction changed while a tour is open. */
  retext(options: Pick<RenderOptions, 'dir' | 'labels'>): void;
  /** Re-measure after the layout changed. */
  refresh(): void;
  /** Idempotent. Always leaves the DOM clean. */
  stop(reason: EndReason): void;
  readonly active: boolean;
}

// ---- local event log ---------------------------------------------------------------------------------------------------------

export type TourEvent =
  | { readonly name: 'tour_offered'; readonly tour: TourId; readonly kind: 'first' | 'resume' | 'home-card' }
  | { readonly name: 'tour_started'; readonly tour: TourId; readonly source: 'offer' | 'settings' }
  | { readonly name: 'tour_step_viewed'; readonly tour: TourId; readonly step: string; readonly index: number }
  | { readonly name: 'tour_skipped'; readonly tour: TourId; readonly step: string; readonly via: 'skip' | 'close' | 'back' }
  | { readonly name: 'tour_completed'; readonly tour: TourId }
  | { readonly name: 'tour_interrupted'; readonly tour: TourId; readonly step?: string; readonly reason: EndReason }
  | { readonly name: 'tour_replayed'; readonly tour: TourId }
  | { readonly name: 'tour_declined'; readonly tour: TourId; readonly via: 'not-now' | 'ignored' }
  | { readonly name: 'tour_target_missing'; readonly tour: TourId; readonly step: string }
  | { readonly name: 'gs_task_done'; readonly task: 'pattern' | 'project' | 'tracker' | 'learn' | 'khayoota' }
  | { readonly name: 'gs_hidden' }
  | { readonly name: 'gs_restored' }
  | { readonly name: 'gs_completed' };

/** What is stored: the event plus when and in which language. Never any user content. */
export type TourEventRecord = TourEvent & { readonly at: number; readonly lang: Lang };

export interface TourEventSink {
  record(e: TourEvent): void;
}
