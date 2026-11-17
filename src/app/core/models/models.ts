import type { AvatarId } from '../data/avatars';
import type { AccessoryId, CategoryId, LevelId, YarnId } from '../data/catalog';
import type { TermSystem } from '../domain/terminology';
import type { PatternCursor, SimpleCounter } from '../domain/tracker-engine';
import type { PartInstance, PartSnapshot } from '../domain/collections';

export type ProjectStatus = 'active' | 'paused' | 'done';
export type TrackerMode = 'simple' | 'pattern';

export interface TrackerData {
  readonly mode: TrackerMode;
  readonly simple: SimpleCounter;
  readonly patternId: string | null;
  readonly cursor: PatternCursor;
  /** epoch ms of last change to the tracker (sync LWW on project_progress) */
  readonly updatedAt: number;
}

export interface ProjectPhoto {
  readonly id: string;
  /** Local data URL (always kept so the photo works offline). */
  readonly localUrl?: string | null;
  /** Path inside the private `project-photos` bucket once uploaded. */
  readonly storagePath?: string | null;
  readonly createdAt: number;
}

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly category: CategoryId;
  readonly hook: string;
  readonly yarn: YarnId;
  readonly status: ProjectStatus;
  readonly notes: string;
  readonly coverLocalUrl: string | null;
  readonly coverPath: string | null;
  readonly photos: readonly ProjectPhoto[];
  readonly workedSeconds: number;
  readonly estimatedHours: number;
  readonly lastWorkedAt: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly tracker: TrackerData;
  /** Soft delete tombstone so other devices learn about deletions. */
  readonly deletedAt: number | null;
  /** Created from a pattern collection (absent on every project saved by an older build). */
  readonly collectionId?: string | null;
  /** The collection revision this project's part snapshots were taken from. */
  readonly collectionRev?: number;
  /** One independent tracker per physical piece (Arm 1/2, Arm 2/2, …). Absent = ordinary single-tracker project. */
  readonly parts?: readonly PartInstance[];
  /** Frozen copy of every part's instructions: later edits to the collection never change this project until the user updates it. */
  readonly partSnapshots?: readonly PartSnapshot[];
  /** The part instance the tracker is currently on (remembered across restarts). */
  readonly activeInstanceId?: string | null;
  /** Standalone pattern projects: the pattern content this project is pinned to once the pattern is edited. */
  readonly patternPin?: PatternPin | null;
}

/** Immutable copy of a standalone pattern's content, so editing the pattern never silently moves an active project. */
export interface PatternPin {
  readonly rev: number;
  readonly name: string;
  readonly text: string;
  readonly terms: TermSystem;
}

export type PatternSource = 'sample' | 'text' | 'pdf' | 'image' | 'youtube';

export interface PatternFile {
  readonly name: string;
  readonly size: number;
  readonly mime: string;
  readonly storagePath?: string | null;
}

export interface Pattern {
  readonly id: string;
  readonly isSample: boolean;
  readonly name: string;
  /** Bilingual names for built-in samples. */
  readonly nameAr?: string;
  readonly nameEn?: string;
  readonly level: LevelId;
  readonly terms: TermSystem;
  readonly source: PatternSource;
  readonly text: string;
  readonly file: PatternFile | null;
  readonly attribution: string;
  readonly sourceUrl: string;
  /** Saved reading position (round index). */
  readonly position: number;
  /** Content revision (1 on creation; +1 whenever an edit changes the text). Absent on patterns saved by older builds = 1. */
  readonly rev?: number;
  /** Optional suggested project duration in minutes: only ever pre-fills a project's own optional estimate. */
  readonly suggestedMinutes?: number;
  readonly updatedAt: number;
  readonly deletedAt: number | null;
}

/** One part definition of a collection. Its `quantity` physical pieces share these instructions but track progress separately. */
export interface PatternPart {
  /** Stable id: project part instances refer to it across edits and devices. */
  readonly id: string;
  readonly name: string;
  readonly quantity: number;
  /** Strict-notation instructions (what the tracker reads). */
  readonly text: string;
  readonly assemblyNotes: string;
}

/** A reusable complete design made of several parts (e.g. "Pink Teddy Bear"). */
export interface PatternCollection {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly level: LevelId;
  readonly terms: TermSystem;
  readonly coverLocalUrl: string | null;
  readonly parts: readonly PatternPart[];
  /** Content revision (see Pattern.rev). */
  readonly rev: number;
  readonly suggestedMinutes: number;
  /** The text the collection was converted from, kept so the original is always recoverable. */
  readonly sourceText: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deletedAt: number | null;
}

/** Immutable history entry: the content a pattern / collection had BEFORE an edit bumped its revision. */
export interface PatternRevision {
  /** `${kind}:${entityId}:${rev}` */
  readonly id: string;
  readonly kind: 'pattern' | 'collection';
  readonly entityId: string;
  readonly rev: number;
  readonly name: string;
  readonly terms: TermSystem;
  readonly text?: string;
  readonly parts?: readonly PatternPart[];
  readonly at: number;
}

export interface Profile {
  readonly displayName: string;
  readonly level: LevelId;
  readonly terms: TermSystem;
  readonly interests: readonly CategoryId[];
  readonly hooks: readonly string[];
  readonly yarns: readonly YarnId[];
  readonly accessories: readonly AccessoryId[];
  readonly onboarded: boolean;
  /** Chosen crochet avatar preset; null = never chosen (UI falls back to DEFAULT_AVATAR). Absent in profiles saved by older builds. */
  readonly avatarId: AvatarId | null;
  readonly updatedAt: number;
}

export interface TutorialStamp {
  readonly id: string;
  readonly sec: number;
  readonly note: string;
}

export interface TutorialData {
  readonly tutorialId: string;
  readonly link: string;
  /** Original creator / channel name, kept for attribution. */
  readonly creator?: string;
  readonly notes: string;
  readonly projectId: string | null;
  readonly stamps: readonly TutorialStamp[];
  readonly updatedAt: number;
}

export interface ChatMessage {
  readonly id: string;
  readonly role: 'user' | 'bot';
  readonly text: string;
  readonly img?: string;
}

export const DEFAULT_PROFILE: Profile = {
  displayName: '',
  level: 'beginner',
  terms: 'us',
  interests: ['amigurumi'],
  hooks: ['3.0', '4.0'],
  yarns: ['cotton'],
  accessories: ['markers', 'needle', 'scissors'],
  onboarded: false,
  avatarId: null,
  updatedAt: 0,
};
