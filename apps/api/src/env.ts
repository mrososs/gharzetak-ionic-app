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
  /** Google OAuth *Web* client id: the audience of ID tokens minted by the native Google picker. Public value. */
  GOOGLE_CLIENT_ID?: string;
  /** Google OAuth Web client secret. Worker secret only (`wrangler secret put` / .dev.vars): never in the app or in git. */
  GOOGLE_CLIENT_SECRET?: string;
  /** Optional Android OAuth client id, accepted as an additional ID-token audience. Public value. */
  GOOGLE_ANDROID_CLIENT_ID?: string;
}

export interface AppBindings {
  Bindings: AppEnv;
  Variables: { userId: string; db: Db; requestId: string };
}
