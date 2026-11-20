import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { bearer } from 'better-auth/plugins';
import { createDb, schema } from './db';
import type { AppEnv } from './env';
import { beginDeletion, finishDeletion, purgeVerification } from './services/account-deletion';
import { sendMail } from './services/mailer';
import { hashPassword, verifyPassword } from './services/password';

export const parseOrigins = (env: Pick<AppEnv, 'APP_ORIGINS'>): string[] =>
  env.APP_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Google client ids accepted as ID-token audience (web client first: it is the primary one). Empty when Google is not configured. */
export const googleAudiences = (env: Pick<AppEnv, 'GOOGLE_CLIENT_ID' | 'GOOGLE_ANDROID_CLIENT_ID'>): string[] =>
  [env.GOOGLE_CLIENT_ID, env.GOOGLE_ANDROID_CLIENT_ID].map((s) => (s ?? '').trim()).filter((s, i, all) => !!s && all.indexOf(s) === i);

const NO_PROVIDER_TOKENS = { idToken: null, accessToken: null, refreshToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null } as const;

/**
 * Better Auth on D1 + Drizzle.
 *
 * Session strategy: the app is a Capacitor WebView talking to a cross-origin API, where cookies are
 * unreliable (SameSite, third-party cookie blocking, `capacitor://` origins). The client therefore
 * authenticates with `Authorization: Bearer <session token>` (Better Auth `bearer` plugin). The token is
 * returned in the `set-auth-token` response header on sign-in / sign-up. Because requests carry no ambient
 * credentials, classic CSRF does not apply to the API; CORS is still restricted to APP_ORIGINS.
 */
export function createAuth(env: AppEnv) {
  const db = createDb(env.DB);
  // Rate limiting is on for every deployed environment (staging included); `test-ratelimit` lets tests exercise it.
  const hardened = env.ENVIRONMENT === 'production' || env.ENVIRONMENT === 'staging' || env.ENVIRONMENT === 'test-ratelimit';
  const googleIds = googleAudiences(env);
  const googleOn = !!env.GOOGLE_CLIENT_ID?.trim() && !!env.GOOGLE_CLIENT_SECRET?.trim();
  return betterAuth({
    baseURL: env.AUTH_BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: parseOrigins(env),
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification, rateLimit: schema.rateLimit },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION === 'true',
      password: { hash: hashPassword, verify: verifyPassword },
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendMail(env, { to: user.email, subject: 'Reset your Gharzetak password', text: `Open this link to choose a new password: ${url}`, link: url });
      },
    },
    emailVerification: {
      sendOnSignUp: env.REQUIRE_EMAIL_VERIFICATION === 'true',
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendMail(env, { to: user.email, subject: 'Confirm your Gharzetak email', text: `Open this link to confirm your email: ${url}`, link: url });
      },
    },
    // Google: the native picker returns a Google-signed ID token that Better Auth verifies (signature via Google JWKS,
    // issuer, audience = our client ids, expiry <= 1h, optional nonce). The client secret never leaves the Worker.
    socialProviders: googleOn ? { google: { clientId: googleIds, clientSecret: env.GOOGLE_CLIENT_SECRET!.trim(), prompt: 'select_account' } } : {},
    account: {
      // A Google login is linked to an existing email account ONLY when Google vouches for the email AND the local account's
      // email is itself verified (Better Auth default, pinned here). An unverified password account is never taken over.
      accountLinking: { enabled: true, requireLocalEmailVerified: true, trustedProviders: [] },
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: hardened,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 8 },
        '/sign-up/email': { window: 60, max: 5 },
        '/sign-in/social': { window: 60, max: 10 },
        '/request-password-reset': { window: 60, max: 3 },
        '/forget-password': { window: 60, max: 3 },
        // Password guessing against a stolen bearer token: a handful of attempts per minute is plenty for a human.
        '/delete-user': { window: 60, max: 5 },
      },
    },
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    plugins: [bearer()],
    user: {
      // Account deletion (POST /api/auth/delete-user). No `sendDeleteAccountVerification`: there is no mail provider, so the
      // e-mail-token flow stays OFF. The owner proves authority with the PASSWORD (credential accounts) or with a FRESH session
      // (created < 1 day ago; Google accounts re-authenticate first). The cascade, R2 sweep and reconciliation live in
      // services/account-deletion.ts; these hooks make every route into deletion go through them.
      deleteUser: {
        enabled: true,
        beforeDelete: async (u) => {
          try {
            await beginDeletion(env.DB, u.id);
            await purgeVerification(env.DB, u.id, u.email);
          } catch {
            // Nothing user-visible was touched yet: abort so the account stays intact and the owner can retry.
            throw new APIError('SERVICE_UNAVAILABLE', { message: 'Account deletion could not start. Nothing was deleted. Please try again.' });
          }
        },
        afterDelete: async (u) => {
          // The user row (and every D1 row of the account) is gone. Never throws: a failed R2 sweep stays queued for reconcile().
          await finishDeletion(env, u.id);
        },
      },
    },
    databaseHooks: {
      // Data minimisation: the app only needs the Better Auth session. Provider ID / access / refresh tokens are never persisted.
      account: {
        create: { before: async (acct) => ({ data: { ...acct, ...NO_PROVIDER_TOKENS } }) },
        update: { before: async (acct) => ({ data: { ...acct, ...NO_PROVIDER_TOKENS } }) },
      },
      user: {
        create: {
          // Replaces the Supabase `on_auth_user_created` trigger: every account gets a profile row.
          after: async (u) => {
            await db
              .insert(schema.profiles)
              .values({ userId: u.id, displayName: (u.name ?? '').slice(0, 80), revision: 1, clientUpdatedAt: 0 })
              .onConflictDoNothing();
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
