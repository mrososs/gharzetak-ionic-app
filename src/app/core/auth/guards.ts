import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/**
 * All guards wait for `auth.untilUnlocked()`: while the app is locked behind biometrics the first navigation simply stays pending,
 * so no private screen is instantiated and no data is loaded until the check passes.
 */

/** App area: signed-in users or explicit guests only. */
export const appGuard: CanMatchFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.init();
  await auth.untilUnlocked(); // biometric lock: nothing is created or loaded until the user unlocks
  return auth.canEnterApp() ? true : router.parseUrl('/onboarding/welcome');
};

/** Onboarding & sign-in pages: a signed-in user never lands back on them (Back after login). */
export const signedOutGuard: CanActivateFn = async (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.init();
  await auth.untilUnlocked(); // biometric lock: nothing is created or loaded until the user unlocks
  if (route.queryParamMap.get('replay') === '1') return true; // Settings → Replay intro
  return auth.signedIn() ? router.parseUrl('/tabs/home') : true;
};

/** Root redirect. */
export const entryGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.init();
  await auth.untilUnlocked(); // biometric lock: nothing is created or loaded until the user unlocks
  return router.parseUrl(auth.canEnterApp() ? '/tabs/home' : '/onboarding/welcome');
};
