import { createMiddleware } from 'hono/factory';
import { createAuth } from '../auth';
import { unauthorized } from '../errors';
import type { AppBindings } from '../env';

/** Resolves the Better Auth session from `Authorization: Bearer <token>` and exposes `userId`. */
export const requireUser = createMiddleware<AppBindings>(async (c, next) => {
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session?.user?.id) throw unauthorized();
  c.set('userId', session.user.id);
  await next();
});
