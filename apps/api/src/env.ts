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
}

export interface AppBindings {
  Bindings: AppEnv;
  Variables: { userId: string; db: Db; requestId: string };
}
