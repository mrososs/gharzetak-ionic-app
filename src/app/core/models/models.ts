import type { AccessoryId, CategoryId, LevelId, YarnId } from '../data/catalog';
import type { TermSystem } from '../domain/terminology';
import type { PatternCursor, SimpleCounter } from '../domain/tracker-engine';

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
  readonly updatedAt: number;
  readonly deletedAt: number | null;
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
  updatedAt: 0,
};
