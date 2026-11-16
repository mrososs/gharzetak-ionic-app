import { GENERATED_ENV } from './env.generated';

export interface AppEnvironment {
  /** Base URL of the Gharzetak Cloudflare Worker API (e.g. https://api.gharzetak.app). '' = no backend: guest-only mode. */
  readonly apiUrl: string;
  /** Where email links (confirm / reset password) return to. Defaults to the current origin. For native builds use the deep link scheme. */
  readonly authRedirectUrl: string;
  /** Social providers that are actually configured on the API (none yet: see docs/cloudflare-migration/auth-strategy.md). */
  readonly oauthProviders: readonly string[];
  /** API path that answers assistant questions, e.g. '/v1/assistant' ('' = demo mode). */
  readonly aiEndpoint: string;
}

export const environment: AppEnvironment = GENERATED_ENV;

export const backendConfigured = (): boolean => !!environment.apiUrl;
