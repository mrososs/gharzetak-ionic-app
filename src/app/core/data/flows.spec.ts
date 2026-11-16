import { describe, expect, it } from 'vitest';
import { ONBOARDING_SLIDES, SETUP_STEPS, previousStep } from './flows';

describe('previousStep (Android Back inside multi-step flows)', () => {
  it('walks onboarding slides backwards and stops at the first one', () => {
    expect(previousStep('/onboarding/assistant', '/onboarding', ONBOARDING_SLIDES)).toBe('track');
    expect(previousStep('/onboarding/learn?replay=1', '/onboarding', ONBOARDING_SLIDES)).toBe('welcome');
    expect(previousStep('/onboarding/welcome', '/onboarding', ONBOARDING_SLIDES)).toBeNull();
  });
  it('walks setup steps backwards; the avatar step is first', () => {
    expect(previousStep('/setup/experience', '/setup', SETUP_STEPS)).toBe('avatar');
    expect(previousStep('/setup/tools', '/setup', SETUP_STEPS)).toBe('interests');
    expect(previousStep('/setup/avatar', '/setup', SETUP_STEPS)).toBeNull();
  });
  it('ignores other urls', () => {
    expect(previousStep('/tabs/home', '/onboarding', ONBOARDING_SLIDES)).toBeUndefined();
    expect(previousStep('/auth/login', '/setup', SETUP_STEPS)).toBeUndefined();
  });
});
