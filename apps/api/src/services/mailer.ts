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
const OUTBOX_CAP = 50;

/**
 * Transactional email. No provider is configured yet: in development the message is captured and
 * logged; in production this fails loudly instead of silently dropping verification / reset mail.
 * Wire a provider here (Cloudflare Email Service, Resend, ...) before enabling REQUIRE_EMAIL_VERIFICATION.
 */
export async function sendMail(env: AppEnv, msg: MailMessage): Promise<void> {
  if (env.ENVIRONMENT !== 'production') {
    devOutbox.push(msg);
    if (devOutbox.length > OUTBOX_CAP) devOutbox.shift();
    // The link is a live one-time token. It is printed ONLY for local development (wrangler dev) so a developer can click it; on any hosted
    // environment (staging) it must never reach persistent Worker logs, and neither does the recipient address.
    if (env.ENVIRONMENT === 'development') console.log(`[mail:development] to=${msg.to} subject="${msg.subject}" link=${msg.link}`);
    else console.log(`[mail:${env.ENVIRONMENT}] message withheld (no mail provider); subject="${msg.subject}"`);
    return;
  }
  throw new Error('No email provider configured (see docs/cloudflare-migration/auth-strategy.md)');
}
