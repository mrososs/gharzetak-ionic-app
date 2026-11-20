/**
 * Khayoota wire types — the app's mirror of apps/api/src/services/ai/contracts.ts (v1).
 * Kept as plain interfaces: the SERVER validates with Zod; the app re-checks actions in action-registry.ts.
 */
import type { CalcFact } from './calc';

export type KhayootaLang = 'ar' | 'en';

export interface KhayootaContextV1 {
  v: 1;
  viewTerms?: 'us' | 'uk';
  project?: { id: string; name: string; category?: string; kind: 'simple' | 'pattern' | 'collection' };
  part?: { instanceId: string; name: string; index: number; of: number };
  pattern?: { source: 'pinned' | 'snapshot' | 'live'; rev: number; outdated: boolean; terms: 'us' | 'uk' };
  round?: {
    n: number;
    text: string;
    declaredTotal: number | null;
    calculatedTotal: number | null;
    consumed: number | null;
    mismatch: boolean;
    joins: string[];
    position?: { done: number; of: number };
    simpleCount?: { count: number; target: number };
  };
  nearby?: { n: number; text: string }[];
  unfinishedParts?: { instanceId: string; label: string }[];
  finishedParts?: { instanceId: string; label: string }[];
  percent?: number;
}

export interface InlineImage {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  /** Plain base64 (no data: prefix). */
  data: string;
}

export interface ChatRequestV1 {
  v: 1;
  message: string;
  lang: KhayootaLang;
  images?: InlineImage[];
  history?: { role: 'user' | 'assistant'; text: string }[];
  context?: KhayootaContextV1;
  calc?: CalcFact[];
  intent?: 'ask' | 'explain-round' | 'diagnose-photo' | 'next-piece' | 'explain-stitch';
  /** Idempotency key of ONE user action: a retry reuses it, so the daily allowance is charged once. */
  clientRequestId?: string;
}

export type ActionId = 'tracker.openCurrentRound' | 'project.openPart' | 'learn.explainStitch';

export interface ActionProposal {
  id: string;
  v: number;
  payload: Record<string, unknown>;
}

export interface ChatReplyV1 {
  v: 1;
  lang: KhayootaLang;
  text: string;
  observations?: string[];
  hypotheses?: string[];
  cannotConfirm?: string[];
  citations?: { roundN: number; partName?: string }[];
  actions: ActionProposal[];
  degraded: boolean;
}

/** One daily allowance. limit/remaining are null for the exempt (unlimited) account. */
export interface QuotaCounterV1 {
  used: number;
  limit: number | null;
  remaining: number | null;
}

/** The authoritative daily allowance: 10 messages + 5 images per account per Africa/Cairo day (server config). resetAt is null when unlimited. */
export interface QuotaV1 {
  unlimited: boolean;
  timezone: string;
  chat: QuotaCounterV1;
  image: QuotaCounterV1;
  resetAt: string | null;
}

export interface UsageV1 {
  /** v1 numbers (older servers send only these). */
  remaining: { chat: number; image: number; extract: number };
  resetAt: string;
  quota?: QuotaV1;
}

export interface ChatResponseV1 {
  requestId: string;
  reply: ChatReplyV1;
  usage: UsageV1;
}

export interface TranscriptLine {
  page: number;
  text: string;
  kind: 'title' | 'part-heading' | 'round' | 'assembly' | 'note' | 'other';
  legibility: 'clear' | 'uncertain' | 'unreadable';
  uncertain: string[];
}

export interface TranscriptV1 {
  schema: 'gz.pattern-transcript';
  v: 1;
  sourceClass: 'written' | 'chart' | 'finished-object' | 'tutorial' | 'other';
  title: string | null;
  language: 'ar' | 'en' | 'mixed';
  terms: 'us' | 'uk' | 'unknown';
  lines: TranscriptLine[];
  warnings: { code: string; lineIndex?: number; note: string }[];
}

export interface ExtractResponseV1 {
  requestId: string;
  transcript: TranscriptV1;
  usage: UsageV1;
}

export type AiStatusV1 =
  /** access 'restricted' = hosted AI is on, but not for this account (tester allowlist). */
  | { v: 1; enabled: false; access?: 'restricted' }
  | {
      v: 1;
      enabled: true;
      provider: 'workers-ai' | 'fake';
      features: { chat: boolean; vision: boolean; extract: boolean };
      consent: { version: number; accepted: boolean };
      limits: { chat: number; image: number; extract: number };
      remaining: { chat: number; image: number; extract: number };
      /** Authoritative daily allowance (absent on older servers: derive it with quotaOf()). */
      quota?: QuotaV1;
      available: boolean;
      resetAt: string;
    };

/** API error codes of the /v1/ai routes (plus the transport's own). */
export type KhayootaErrorCode =
  | 'unauthorized'
  | 'ai_disabled'
  | 'ai_access_restricted'
  | 'ai_consent_required'
  | 'ai_rate_limited'
  | 'ai_quota_exceeded'
  | 'ai_feature_disabled'
  | 'ai_unsupported_image'
  | 'ai_busy'
  | 'ai_timeout'
  | 'ai_bad_output'
  | 'ai_upstream_error'
  | 'ai_duplicate_request'
  | 'ai_request_in_progress'
  | 'validation_error'
  | 'network'
  | 'unknown';
