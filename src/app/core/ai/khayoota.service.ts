import { Injectable, computed, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { ApiClient, ApiError } from '../api/api.client';
import { AuthService } from '../auth/auth.service';
import { NetworkService } from '../services/network.service';
import type { AiStatusV1, ChatRequestV1, ChatResponseV1, ExtractResponseV1, InlineImage, KhayootaErrorCode, KhayootaLang, UsageV1 } from './khayoota.types';

/** A hosted request that did not produce a reply. `code` drives the UI state; nothing else is shown to the user. */
export class KhayootaFailure extends Error {
  constructor(
    readonly code: KhayootaErrorCode,
    readonly info: { scope?: 'user' | 'global'; kind?: string; resetAt?: string; retryAfterSec?: number; feature?: string; remaining?: { chat: number; image: number; extract: number } } = {},
  ) {
    super(code);
  }
}

const KNOWN: readonly KhayootaErrorCode[] = [
  'unauthorized',
  'ai_disabled',
  'ai_access_restricted',
  'ai_consent_required',
  'ai_rate_limited',
  'ai_quota_exceeded',
  'ai_feature_disabled',
  'ai_unsupported_image',
  'ai_busy',
  'ai_timeout',
  'ai_bad_output',
  'ai_upstream_error',
  'ai_duplicate_request',
  'ai_request_in_progress',
  'validation_error',
];

/**
 * Talks to the Khayoota routes of the Worker (`GZ_AI_ENDPOINT`, e.g. `/v1/ai`). Hosted AI needs: an API, the endpoint, a
 * signed-in account, the server's kill switch on, and consent. Without any of these the assistant page uses the offline,
 * deterministic helper (AssistantService). No Cloudflare credential or model id ever lives in the app.
 */
@Injectable({ providedIn: 'root' })
export class KhayootaService {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  private readonly net = inject(NetworkService);

  readonly endpoint = environment.aiEndpoint.replace(/\/+$/, '');
  /** The build can talk to a hosted Khayoota at all. */
  readonly configured = !!this.endpoint && this.api.configured;

  readonly status = signal<AiStatusV1 | null>(null);
  readonly statusError = signal<KhayootaErrorCode | null>(null);

  /** Signed in, online, the server says enabled. */
  readonly hosted = computed(() => {
    const s = this.status();
    return this.configured && this.auth.signedIn() && this.net.online() && !!s && s.enabled;
  });
  readonly needsConsent = computed(() => {
    const s = this.status();
    return this.hosted() && !!s && s.enabled && !s.consent.accepted;
  });
  readonly ready = computed(() => this.hosted() && !this.needsConsent());
  /** Hosted AI exists but this account is not a tester yet: show "coming soon", never call chat/extract. */
  readonly restricted = computed(() => {
    const s = this.status();
    return this.configured && this.auth.signedIn() && !!s && !s.enabled && s.access === 'restricted';
  });
  readonly features = computed(() => {
    const s = this.status();
    return s && s.enabled ? s.features : { chat: false, vision: false, extract: false };
  });
  /** 'fake' = the server's deterministic demo provider (labelled in the UI). */
  readonly demoProvider = computed(() => {
    const s = this.status();
    return !!s && s.enabled && s.provider === 'fake';
  });

  async refreshStatus(): Promise<AiStatusV1 | null> {
    if (!this.configured || !this.auth.signedIn()) {
      this.status.set(null);
      return null;
    }
    try {
      const s = await this.api.get<AiStatusV1>(`${this.endpoint}/status`);
      this.status.set(s);
      this.statusError.set(null);
      return s;
    } catch (e) {
      this.status.set(null);
      this.statusError.set(mapError(e).code);
      return null;
    }
  }

  async acceptConsent(): Promise<void> {
    const s = this.status();
    if (!s || !s.enabled) throw new KhayootaFailure('ai_disabled');
    try {
      await this.api.put(`${this.endpoint}/consent`, { version: s.consent.version });
    } catch (e) {
      throw mapError(e);
    }
    this.status.set({ ...s, consent: { ...s.consent, accepted: true } });
  }

  async withdrawConsent(): Promise<void> {
    try {
      await this.api.delete(`${this.endpoint}/consent`);
    } finally {
      await this.refreshStatus();
    }
  }

  async chat(req: Omit<ChatRequestV1, 'v'>): Promise<ChatResponseV1> {
    try {
      const res = await within(this.api.post<ChatResponseV1>(`${this.endpoint}/chat`, { v: 1, ...req }), CHAT_CLIENT_TIMEOUT_MS);
      this.applyUsage(res.usage);
      return res;
    } catch (e) {
      throw this.onFailure(mapError(e));
    }
  }

  async extract(input: { images?: InlineImage[]; text?: string }, lang: KhayootaLang, clientRequestId?: string): Promise<ExtractResponseV1> {
    try {
      const res = await within(this.api.post<ExtractResponseV1>(`${this.endpoint}/extract`, { v: 1, lang, ...input, ...(clientRequestId ? { clientRequestId } : {}) }), EXTRACT_CLIENT_TIMEOUT_MS);
      this.applyUsage(res.usage);
      return res;
    } catch (e) {
      throw this.onFailure(mapError(e));
    }
  }

  /** The server's numbers after a reply: the displayed allowance is never computed locally. */
  private applyUsage(u: UsageV1): void {
    const s = this.status();
    if (s && s.enabled) this.status.set({ ...s, remaining: u.remaining, resetAt: u.resetAt, ...(u.quota ? { quota: u.quota } : {}) });
  }

  private onFailure(f: KhayootaFailure): KhayootaFailure {
    const s = this.status();
    if (s && s.enabled) {
      if (f.code === 'ai_consent_required') this.status.set({ ...s, consent: { ...s.consent, accepted: false } });
      if (f.code === 'ai_quota_exceeded' && f.info.scope === 'global') this.status.set({ ...s, available: false });
      if (f.code === 'ai_quota_exceeded' && f.info.scope === 'user' && f.info.remaining) this.status.set({ ...s, remaining: f.info.remaining, ...(f.info.resetAt ? { resetAt: f.info.resetAt } : {}) });
      // A failed request may have been refunded (or a retry found it already counted): re-read the authoritative numbers.
      if (f.code !== 'network' && f.code !== 'unauthorized' && f.code !== 'ai_disabled' && f.code !== 'ai_access_restricted') void this.refreshStatus();
      if (f.code === 'ai_disabled') this.status.set({ v: 1, enabled: false });
      if (f.code === 'ai_access_restricted') this.status.set({ v: 1, enabled: false, access: 'restricted' });
    }
    return f;
  }
}

/**
 * Client-side ceiling so the spinner can never hang. The server bounds one model call to 45 s, with at most one capacity
 * retry and one repair call; these limits sit above that worst case. The server still settles usage if the app gives up.
 */
export const CHAT_CLIENT_TIMEOUT_MS = 150_000;
export const EXTRACT_CLIENT_TIMEOUT_MS = 150_000;

export function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new KhayootaFailure('ai_timeout')), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

function isRemaining(v: unknown): v is { chat: number; image: number; extract: number } {
  const r = v as { chat?: unknown; image?: unknown; extract?: unknown } | null;
  return !!r && typeof r.chat === 'number' && typeof r.image === 'number' && typeof r.extract === 'number';
}

export function mapError(e: unknown): KhayootaFailure {
  if (e instanceof KhayootaFailure) return e;
  if (e instanceof ApiError) {
    if (e.status === 0 || e.code === 'network') return new KhayootaFailure('network');
    const code = (KNOWN as readonly string[]).includes(e.code) ? (e.code as KhayootaErrorCode) : e.status === 401 ? 'unauthorized' : 'unknown';
    const x = e.extra ?? {};
    return new KhayootaFailure(code, {
      scope: x['scope'] === 'user' || x['scope'] === 'global' ? x['scope'] : undefined,
      kind: typeof x['kind'] === 'string' ? x['kind'] : undefined,
      resetAt: typeof x['resetAt'] === 'string' ? x['resetAt'] : undefined,
      retryAfterSec: typeof x['retryAfterSec'] === 'number' ? x['retryAfterSec'] : undefined,
      feature: typeof x['feature'] === 'string' ? x['feature'] : undefined,
      remaining: isRemaining(x['remaining']) ? x['remaining'] : undefined,
    });
  }
  return new KhayootaFailure('unknown');
}
