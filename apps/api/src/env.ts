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

  /* ---- Khayoota AI (all optional; hosted AI is OFF unless AI_ENABLED === 'true') ---- */
  /** Workers AI binding. Bound only in environments approved for live inference (never in local dev or tests). */
  AI?: Ai;
  /** Kill switch: 'true' enables the /v1/ai routes. Anything else → 503 ai_disabled. */
  AI_ENABLED?: string;
  /** 'workers-ai' uses the AI binding; anything else (default) uses the offline fake provider. */
  AI_PROVIDER?: string;
  AI_MODEL_CHAT?: string;
  AI_MODEL_VISION?: string;
  AI_MODEL_EXTRACT?: string;
  /** Photo questions and image-to-pattern stay OFF until their benchmark gates pass. */
  AI_VISION_ENABLED?: string;
  AI_EXTRACT_ENABLED?: string;
  /** Account-wide daily ceilings (UTC day): estimated Neurons (upper bound) and requests. */
  AI_DAILY_NEURON_BUDGET?: string;
  AI_DAILY_REQUEST_CAP?: string;
  /** Per-user daily caps and burst units per minute. */
  AI_USER_DAILY_CHAT?: string;
  AI_USER_DAILY_IMAGE?: string;
  AI_USER_DAILY_EXTRACT?: string;
  AI_BURST_UNITS_PER_MINUTE?: string;
  /** Version of the consent text users must accept before hosted AI is used. */
  AI_CONSENT_VERSION?: string;
  /** "*" = every signed-in account; else comma-separated user ids. Unset/empty in a deployed environment = nobody. */
  AI_ALLOWED_USER_IDS?: string;
  /** Upstream deadline per model call (ms). */
  AI_TIMEOUT_MS?: string;
}

export interface AppBindings {
  Bindings: AppEnv;
  Variables: { userId: string; db: Db; requestId: string };
}
