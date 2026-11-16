import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import { createDb, schema } from './db';
import type { AppEnv } from './env';
import { sendMail } from './services/mailer';
import { hashPassword, verifyPassword } from './services/password';

export const parseOrigins = (env: Pick<AppEnv, 'APP_ORIGINS'>): string[] =>
  env.APP_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

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
  const production = env.ENVIRONMENT === 'production';
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
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    rateLimit: {
      enabled: production || env.ENVIRONMENT === 'test-ratelimit',
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 8 },
        '/sign-up/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 60, max: 3 },
        '/forget-password': { window: 60, max: 3 },
      },
    },
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    plugins: [bearer()],
    databaseHooks: {
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
