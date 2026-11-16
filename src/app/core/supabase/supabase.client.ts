import { InjectionToken } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { backendConfigured, environment } from '../../../environments/environment';
import type { Database } from './database.types';

export type GzSupabase = SupabaseClient<Database>;

/**
 * The single Supabase client (publishable key only — RLS protects every table).
 * `null` when the build has no backend configured: the app then runs in guest-only mode.
 */
export const SUPABASE = new InjectionToken<GzSupabase | null>('SUPABASE', {
  providedIn: 'root',
  factory: () =>
    backendConfigured()
      ? createClient<Database>(environment.supabaseUrl, environment.supabasePublishableKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            flowType: 'pkce',
            storageKey: 'gz.auth',
          },
        })
      : null,
});
