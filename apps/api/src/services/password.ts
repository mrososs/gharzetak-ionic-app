/**
 * Password hashing with WebCrypto PBKDF2-SHA256.
 *
 * Better Auth's default (scrypt in JS) can exceed Workers CPU limits. PBKDF2 runs natively in
 * workerd, but workerd caps PBKDF2 at 100,000 iterations, which is below the OWASP figure for
 * SHA-256 (600,000). The hash string is self-describing (`pbkdf2-sha256$iterations$salt$hash`), so
 * the algorithm can be upgraded later without invalidating existing hashes.
 */
const ITERATIONS = 100_000;
const KEY_BITS = 256;

const toB64 = (b: ArrayBuffer | Uint8Array) => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, KEY_BITS);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${ITERATIONS}$${toB64(salt)}$${toB64(await derive(password, salt, ITERATIONS))}`;
}

export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  const [alg, iter, salt, expected] = hash.split('$');
  if (alg !== 'pbkdf2-sha256' || !iter || !salt || !expected) return false;
  const iterations = Number(iter);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100_000) return false;
  const actual = new Uint8Array(await derive(password, fromB64(salt), iterations));
  const want = fromB64(expected);
  if (actual.length !== want.length) return false;
  let diff = 0; // constant-time compare
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ want[i]!;
  return diff === 0;
}
