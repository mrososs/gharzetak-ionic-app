import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, 'validation_error', message, details);
export const unauthorized = () => new ApiError(401, 'unauthorized', 'Sign in required');
export const notFound = (what = 'Resource') => new ApiError(404, 'not_found', `${what} not found`);

/** Structured error body: { error: { code, message, details? }, ...extra } */
export function errorResponse(c: Context, err: unknown): Response {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) }, ...(err.extra ?? {}) }, err.status);
  }
  console.error('[api] unhandled', err instanceof Error ? `${err.name}: ${err.message}` : err);
  return c.json({ error: { code: 'internal_error', message: 'Unexpected server error' } }, 500);
}
