import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { backendConfigured, environment } from '../../../environments/environment';
import { SessionStore } from '../auth/session.store';
import type { ConflictCurrent } from './api.types';

/** status 0 = the server could not be reached (offline, DNS, CORS, TLS). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Present on 409: the server's current revision of the item. */
    readonly current?: ConflictCurrent,
    /** Extra top-level fields of the error body (e.g. scope / resetAt / retryAfterSec on AI limits). */
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }

  get isNetwork(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 502;
  }
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isConflict(): boolean {
    return this.status === 409 && !!this.current;
  }
}

type Params = Record<string, string | number | boolean>;

/**
 * Typed transport to the Worker API (Angular HttpClient). Authenticates with the bearer session token.
 * Angular never talks to D1 or R2 directly; every byte goes through the Worker.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionStore);

  readonly configured = backendConfigured();
  readonly baseUrl = environment.apiUrl;

  private url(path: string): string {
    return this.baseUrl + path;
  }

  private headers(extra: Record<string, string> = {}, auth = true, tokenOverride?: string): HttpHeaders {
    const token = tokenOverride ?? this.session.token();
    return new HttpHeaders({ ...(auth && token ? { Authorization: `Bearer ${token}` } : {}), ...extra });
  }

  private async exec<T>(req: Promise<T>): Promise<T> {
    try {
      return await req;
    } catch (e) {
      throw toApiError(e);
    }
  }

  get<T>(path: string, params?: Params): Promise<T> {
    return this.exec(firstValueFrom(this.http.get<T>(this.url(path), { headers: this.headers(), params: toParams(params) })));
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.exec(firstValueFrom(this.http.put<T>(this.url(path), body ?? {}, { headers: this.headers() })));
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.exec(firstValueFrom(this.http.post<T>(this.url(path), body ?? {}, { headers: this.headers() })));
  }

  async delete(path: string, params?: Params): Promise<void> {
    await this.exec(firstValueFrom(this.http.delete(this.url(path), { headers: this.headers(), params: toParams(params), responseType: 'text' })));
  }

  /** Raw-bytes upload (photos, pattern files). */
  putBytes<T>(path: string, body: Blob, extraHeaders: Record<string, string> = {}): Promise<T> {
    return this.exec(
      firstValueFrom(this.http.put<T>(this.url(path), body, { headers: this.headers({ 'Content-Type': body.type || 'application/octet-stream', ...extraHeaders }) })),
    );
  }

  getBlob(path: string, params?: Params): Promise<Blob> {
    return this.exec(firstValueFrom(this.http.get(this.url(path), { headers: this.headers(), params: toParams(params), responseType: 'blob' })));
  }

  /**
   * Full response access (needed for the `set-auth-token` header on sign-in / sign-up).
   * `token` authenticates this ONE call with a different session than the stored one (used to discard a session that was just
   * created by mistake; it never reads or replaces the stored session).
   */
  raw<T>(method: 'GET' | 'POST', path: string, body?: unknown, auth = true, token?: string): Promise<HttpResponse<T>> {
    return this.exec(firstValueFrom(this.http.request<T>(method, this.url(path), { body, headers: this.headers({}, auth, token), observe: 'response' })));
  }
}

function toParams(p?: Params): HttpParams | undefined {
  if (!p) return undefined;
  let hp = new HttpParams();
  for (const [k, v] of Object.entries(p)) hp = hp.set(k, String(v));
  return hp;
}

/** Normalises both API error shapes: `{ error: { code, message } , current? }` and Better Auth's `{ code, message }`. */
export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof HttpErrorResponse) {
    const b = (typeof e.error === 'object' && e.error ? e.error : {}) as { error?: { code?: string; message?: string }; code?: string; message?: string; current?: ConflictCurrent } & Record<string, unknown>;
    const code = b.error?.code ?? b.code ?? (e.status === 0 ? 'network' : `http_${e.status}`);
    const message = b.error?.message ?? b.message ?? e.message;
    const { error: _e, code: _c, message: _m, current: _cur, ...extra } = b;
    return new ApiError(e.status, String(code), message, b.current, Object.keys(extra).length ? extra : undefined);
  }
  return new ApiError(0, 'network', e instanceof Error ? e.message : String(e));
}
