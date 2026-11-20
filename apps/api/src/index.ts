import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { createAuth, parseOrigins } from './auth';
import { createDb } from './db';
import type { AppBindings, AppEnv } from './env';
import { reconcile, storageStatus } from './services/account-deletion';
import { errorResponse } from './errors';
import { requireUser } from './middleware/auth';
import { entities } from './routes/entities';
import { withPrefix } from './services/prefixed-bucket';
import { media } from './routes/media';
import { ai } from './routes/ai';

const app = new Hono<AppBindings>();

app.use('*', secureHeaders());
app.use('*', async (c, next) => {
  // Refuse to run a deployed environment that still carries template placeholders (e.g. a REPLACE_... AUTH_BASE_URL).
  if (c.env.ENVIRONMENT !== 'development' && c.env.ENVIRONMENT !== 'test' && /REPLACE_/.test(`${c.env.AUTH_BASE_URL}${c.env.APP_ORIGINS}`)) {
    console.error('[config] placeholder value still present in AUTH_BASE_URL / APP_ORIGINS');
    return c.json({ error: { code: 'misconfigured', message: 'Server configuration is incomplete' } }, 500);
  }
  // The development configuration (mail capture, no rate limiting) must never run on a public host.
  if (c.env.ENVIRONMENT === 'development' && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(c.req.url).hostname)) {
    console.error('[config] ENVIRONMENT=development served on a non-local host; deploy with --env staging|production');
    return c.json({ error: { code: 'misconfigured', message: 'Server configuration is incomplete' } }, 500);
  }
  c.set('requestId', crypto.randomUUID());
  c.set('db', createDb(c.env.DB));
  if (c.env.MEDIA_PREFIX) c.env = { ...c.env, MEDIA: withPrefix(c.env.MEDIA, c.env.MEDIA_PREFIX) };
  await next();
  c.header('X-Request-Id', c.get('requestId'));
});

// Bearer-token API: no cookies, so credentials are not allowed cross-origin and the allow-list is exact.
app.use(
  '*',
  cors({
    origin: (origin, c) => (origin && parseOrigins(c.env).includes(origin) ? origin : null),
    allowHeaders: ['Authorization', 'Content-Type', 'If-None-Match', 'X-File-Name'],
    allowMethods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['set-auth-token', 'ETag', 'X-Request-Id'],
    maxAge: 600,
  }),
);

app.get('/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
  return c.json({ status: row?.ok === 1 ? 'ok' : 'degraded', service: 'gharzetak-api', time: Date.now(), r2Bound: !!c.env.MEDIA });
});

// Account deletion. Better Auth does the authentication (password or fresh session), the rate limit and the delete itself; the
// hooks in auth.ts run the cleanup. This thin wrapper only adds what the caller may truthfully be told afterwards:
// `storageCleanup` = "complete" (every stored file confirmed removed) or "pending" (account deleted, file sweep queued for retry).
app.post('/api/auth/delete-user', async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const res = await auth.handler(c.req.raw);
  if (!res.ok || !session?.user?.id) return res;
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return c.json({ ...body, storageCleanup: await storageStatus(c.env.DB, session.user.id) });
});

// Better Auth: /api/auth/sign-up/email, /sign-in/email, /sign-out, /get-session, /request-password-reset, /reset-password, /verify-email ...
app.on(['GET', 'POST'], '/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw));

const v1 = new Hono<AppBindings>();
v1.use('*', requireUser);
v1.route('/', entities);
v1.route('/media', media);
v1.route('/ai', ai);
app.route('/v1', v1);

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404));
app.onError((err, c) => errorResponse(c, err));

/**
 * Cron (wrangler `triggers.crons`): finishes interrupted account deletions (R2 sweep retries + one verification sweep) and purges
 * stale transient security rows. Safe to run at any time and any number of times.
 */
async function scheduled(_event: unknown, env: AppEnv): Promise<void> {
  const bound = env.MEDIA_PREFIX ? { ...env, MEDIA: withPrefix(env.MEDIA, env.MEDIA_PREFIX) } : env;
  const r = await reconcile(bound);
  if (r.retried || r.abandoned || r.stillPending) console.log('[account-deletion] reconcile', JSON.stringify(r));
}

// `scheduled` rides on the Hono app object so tests (app.request) and the Workers runtime (default export handlers) share one export.
export default Object.assign(app, { scheduled });
