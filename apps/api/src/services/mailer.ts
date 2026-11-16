import type { AppEnv } from '../env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** The action link inside the message (verification / password reset). */
  link: string;
}

/** Captured messages in development and tests (never in production). */
export const devOutbox: MailMessage[] = [];

/**
 * Transactional email. No provider is configured yet: in development the message is captured and
 * logged; in production this fails loudly instead of silently dropping verification / reset mail.
 * Wire a provider here (Cloudflare Email Service, Resend, ...) before enabling REQUIRE_EMAIL_VERIFICATION.
 */
export async function sendMail(env: AppEnv, msg: MailMessage): Promise<void> {
  if (env.ENVIRONMENT !== 'production') {
    devOutbox.push(msg);
    console.log(`[mail:dev] to=${msg.to} subject="${msg.subject}" link=${msg.link}`);
    return;
  }
  throw new Error('No email provider configured (see docs/cloudflare-migration/auth-strategy.md)');
}
