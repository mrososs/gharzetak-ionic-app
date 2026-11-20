/**
 * The ONE place that names Gharzetak's official support / privacy / account-deletion mailbox. Every screen reads it from here.
 * It is a public contact address (the same one the public legal pages print), not a secret; no password or credential for it exists
 * anywhere in the app or the repositories. Do not add any other address.
 */
export const SUPPORT_EMAIL = 'gharzetak.support@gmail.com';

export type SupportTopic = 'support' | 'deletion';

const SUBJECTS: Record<SupportTopic, { ar: string; en: string }> = {
  support: { ar: 'دعم غرزتك', en: 'Gharzetak support' },
  // The request mail must NOT contain a password, a token or an ID document: the pages and the screen say so.
  deletion: { ar: 'طلب حذف حساب غرزتك', en: 'Gharzetak account deletion request' },
};

/** `mailto:` link with a pre-filled subject only (never a body that could carry personal data). */
export function supportMailto(topic: SupportTopic, lang: 'ar' | 'en'): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(SUBJECTS[topic][lang])}`;
}
