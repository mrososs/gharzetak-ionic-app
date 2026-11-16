import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { createAuth, parseOrigins } from './auth';
import { createDb } from './db';
import type { AppBindings } from './env';
import { errorResponse } from './errors';
import { requireUser } from './middleware/auth';
import { entities } from './routes/entities';
import { media } from './routes/media';

const app = new Hono<AppBindings>();

app.use('*', secureHeaders());
app.use('*', async (c, next) => {
  c.set('requestId', crypto.randomUUID());
  c.set('db', createDb(c.env.DB));
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

// Better Auth: /api/auth/sign-up/email, /sign-in/email, /sign-out, /get-session, /request-password-reset, /reset-password, /verify-email ...
app.on(['GET', 'POST'], '/api/auth/*', (c) => createAuth(c.env).handler(c.req.raw));

const v1 = new Hono<AppBindings>();
v1.use('*', requireUser);
v1.route('/', entities);
v1.route('/media', media);
app.route('/v1', v1);

app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Route not found' } }, 404));
app.onError((err, c) => errorResponse(c, err));

export default app;
