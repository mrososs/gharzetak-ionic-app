import { GENERATED_ENV } from './env.generated';

export interface AppEnvironment {
  readonly supabaseUrl: string;
  readonly supabasePublishableKey: string;
  /** Where Supabase email links (confirm / reset password) return to. Defaults to the current origin. */
  readonly authRedirectUrl: string;
  /** OAuth providers that are actually configured in Supabase (e.g. ["google","apple"]). */
  readonly oauthProviders: readonly string[];
  /** Name of the Supabase Edge Function that answers assistant questions ('' = demo mode). */
  readonly aiEndpoint: string;
}

export const environment: AppEnvironment = GENERATED_ENV;

export const backendConfigured = (): boolean => !!environment.supabaseUrl && !!environment.supabasePublishableKey;
