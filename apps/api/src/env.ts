import type { Db } from './db';

export interface AppEnv {
  DB: D1Database;
  /** Private R2 bucket. Never exposed publicly; the Worker is the only reader/writer. */
  MEDIA: R2Bucket;
  BETTER_AUTH_SECRET: string;
  ENVIRONMENT: string;
  AUTH_BASE_URL: string;
  APP_ORIGINS: string;
  REQUIRE_EMAIL_VERIFICATION: string;
  /** Optional R2 key prefix (e.g. "staging/") so environments can share one private bucket without touching each other's objects. */
  MEDIA_PREFIX?: string;
}

export interface AppBindings {
  Bindings: AppEnv;
  Variables: { userId: string; db: Db; requestId: string };
}
