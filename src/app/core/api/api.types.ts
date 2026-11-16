/** Typed contracts of the Gharzetak Worker API (apps/api). Timestamps are epoch milliseconds. */

export interface Accepted {
  revision: number;
  clientUpdatedAt: number;
  updatedAt: number;
}

/** Where the server's tracker currently is (only sent for progress conflicts). */
export interface ProgressPosition {
  mode: string;
  round: number;
  count: number;
  patternRoundIndex: number;
  actionPtr: number;
}

export interface ConflictCurrent {
  revision: number;
  clientUpdatedAt: number;
  /** The row is a tombstone (deleted on another device). */
  deleted?: boolean;
  /** Progress conflicts only: the server's tracker position. */
  state?: ProgressPosition;
}

export interface MediaStored {
  key: string;
  mime: string;
  size: number;
  name?: string;
}

export interface PullProfile {
  userId: string;
  displayName: string;
  level: string;
  terms: string;
  locale: string;
  interests: string[];
  onboarded: boolean;
  revision: number;
  toolsRevision: number;
  clientUpdatedAt: number;
  toolsClientUpdatedAt: number;
}

export interface PullPattern {
  id: string;
  name: string;
  level: string;
  terms: string;
  sourceType: string;
  sourceUrl: string | null;
  attribution: string | null;
  rawText: string;
  filePath: string | null;
  fileName: string | null;
  fileSize: number | null;
  fileMime: string | null;
  readingPosition: number;
  revision: number;
  clientUpdatedAt: number;
}

export interface PullProject {
  id: string;
  name: string;
  category: string;
  hookSize: string;
  yarnType: string;
  status: string;
  patternId: string | null;
  coverPath: string | null;
  estimatedHours: number;
  workedSeconds: number;
  lastWorkedAt: number;
  revision: number;
  clientUpdatedAt: number;
  createdAt: number;
}

export interface PullProgress {
  projectId: string;
  mode: string;
  round: number;
  target: number;
  perTap: number;
  count: number;
  totalRounds: number;
  patternId: string | null;
  patternRoundIndex: number;
  actionPtr: number;
  countMode: string;
  history: unknown[];
  patternHistory: unknown[];
  revision: number;
  clientUpdatedAt: number;
}

export interface PullNote {
  projectId: string;
  body: string;
  revision: number;
  clientUpdatedAt: number;
}

export interface PullPhoto {
  id: string;
  projectId: string;
  storagePath: string;
  createdAt: number;
}

export interface PullTutorial {
  id: string;
  tutorialId: string;
  youtubeUrl: string | null;
  creatorName: string | null;
  projectId: string | null;
  notes: string;
  revision: number;
  clientUpdatedAt: number;
  stamps: { id: string; seconds: number; note: string }[];
}

export interface PullResponse {
  serverTime: number;
  profile: PullProfile | null;
  tools: { kind: 'hook' | 'yarn' | 'accessory'; value: string }[];
  patterns: PullPattern[];
  projects: PullProject[];
  progress: PullProgress[];
  notes: PullNote[];
  photos: PullPhoto[];
  favorites: string[];
  tutorials: PullTutorial[];
  interest: string | null;
}
