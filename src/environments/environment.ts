import { GENERATED_ENV } from './env.generated';

export interface AppEnvironment {
  /** Base URL of the Gharzetak Cloudflare Worker API (e.g. https://api.gharzetak.app). '' = no backend: guest-only mode. */
  readonly apiUrl: string;
  /** Where email links (confirm / reset password) return to. Defaults to the current origin. For native builds use the deep link scheme. */
  readonly authRedirectUrl: string;
  /** Google OAuth *Web* client id (public). It is the audience of the ID token minted by the native Google picker. '' = Google sign-in is off. */
  readonly googleWebClientId: string;
  /** Google OAuth iOS client id (public). Required for Google sign-in on iOS; '' = Google sign-in is Android-only. */
  readonly googleIosClientId: string;
  /** API path that answers assistant questions, e.g. '/v1/assistant' ('' = demo mode). */
  readonly aiEndpoint: string;
  /** True only when the backend can deliver email (GZ_PASSWORD_RESET=1). False hides "Forgot password" so the app never promises an email that is not sent. */
  readonly passwordResetEnabled: boolean;
  /**
   * Base URL of the PUBLISHED legal pages (privacy policy, terms, account deletion), e.g. https://example.org . '' = not configured:
   * Settings then shows the legal rows as unavailable instead of linking anywhere. Never defaulted to an unapproved domain.
   */
  readonly legalBaseUrl: string;
}

export const environment: AppEnvironment = GENERATED_ENV;

export const backendConfigured = (): boolean => !!environment.apiUrl;
