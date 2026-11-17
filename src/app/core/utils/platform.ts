/**
 * True on a real Android / iOS app (a Capacitor native runtime), false in a browser or a test.
 *
 * Reads the global that `@capacitor/core` installs at startup instead of importing it. Services that only need to know "native or not"
 * (haptics, share, notifications) therefore load their plugin lazily and never add a static `@capacitor/core` import to every module
 * graph that merely injects them.
 */
export function isNativePlatform(): boolean {
  try {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
}
