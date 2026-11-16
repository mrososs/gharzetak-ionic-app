/** Step order of the two multi-step flows. Shared by the pages and by the Android hardware-Back handler in app.ts. */
export const ONBOARDING_SLIDES = ['welcome', 'learn', 'track', 'assistant'] as const;
export const SETUP_STEPS = ['avatar', 'experience', 'interests', 'tools'] as const;

/** The step before `key` in a flow ('/onboarding/track' → 'learn'), or null for the first step / a non-flow url. */
export function previousStep(url: string, base: '/onboarding' | '/setup', steps: readonly string[]): string | null | undefined {
  if (!url.startsWith(base + '/')) return undefined; // not this flow
  const key = url.slice(base.length + 1).split(/[?#/]/)[0];
  const i = steps.indexOf(key);
  return i > 0 ? steps[i - 1] : null;
}
