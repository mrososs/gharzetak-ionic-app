import { environment } from '../../../environments/environment';
import type { Lang } from '../data/catalog';

export type LegalPage = 'privacy' | 'terms' | 'delete-account';

/**
 * The ONE place that builds links to the public legal pages. The base comes from the build configuration (`GZ_LEGAL_BASE_URL`);
 * there is deliberately no default, so an unapproved or unpublished domain can never ship by accident. Arabic is the site's default
 * language (no prefix); English lives under /en.
 *
 * Returns null when no base URL is configured: the caller then shows the row as "not published yet" instead of a dead or wrong link.
 */
export function legalUrl(page: LegalPage, lang: Lang, base: string = environment.legalBaseUrl): string | null {
  const b = base.trim().replace(/\/+$/, '');
  if (!b) return null;
  return `${b}${lang === 'en' ? '/en' : ''}/${page}/`;
}
