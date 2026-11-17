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
  /** Multi-part projects only: sum of every part instance's position (see `multiPosition`). */
  multi?: number;
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
  /** null / absent for accounts that never chose one. Treat as untrusted: validate with toAvatarId(). */
  avatarId?: string | null;
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
  contentRev?: number;
  suggestedMinutes?: number;
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
  collectionId?: string | null;
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
  multiState?: PullMultiState | null;
  patternSnapshot?: { rev: number; name: string; text: string; terms: 'us' | 'uk' } | null;
  revision: number;
  clientUpdatedAt: number;
}

export interface PullMultiState {
  collectionId: string;
  collectionRev: number;
  activeInstanceId: string | null;
  snapshots: { partId: string; name: string; quantity: number; text: string; assemblyNotes: string; terms?: 'us' | 'uk' }[];
  instances: {
    id: string;
    partId: string;
    index: number;
    mode: 'simple' | 'pattern';
    simple: { round: number; target: number; perTap: number; count: number; totalRounds: number; history: unknown[] };
    cursor: { roundIndex: number; ptr: number; mode: 'action' | 'group' | 'round'; history: unknown[] };
    workedSeconds: number;
    updatedAt: number;
    retired?: boolean;
  }[];
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

export interface PullCollection {
  id: string;
  name: string;
  description: string;
  level: string;
  terms: string;
  coverData: string | null;
  contentRev: number;
  suggestedMinutes: number;
  sourceText: string;
  revision: number;
  clientUpdatedAt: number;
  createdAt: number;
  parts: { id: string; name: string; quantity: number; rawText: string; assemblyNotes: string }[];
}

export interface PullRevision {
  entityKind: 'pattern' | 'collection';
  entityId: string;
  rev: number;
  name: string;
  createdAt: number;
  snapshot: { terms: 'us' | 'uk'; text?: string; parts?: { id: string; name: string; quantity: number; rawText: string; assemblyNotes: string }[] } | null;
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
  /** Absent when talking to an older Worker. */
  collections?: PullCollection[];
  revisions?: PullRevision[];
}
