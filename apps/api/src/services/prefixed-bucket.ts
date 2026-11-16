/**
 * Namespaces every R2 key under a fixed prefix (e.g. `staging/`), so several environments can safely share ONE private
 * bucket without ever reading or overwriting each other's objects. D1 keeps the unprefixed key; only R2 sees the prefix.
 *
 * Only the operations the API uses are wrapped; `list` is scoped to the prefix and returns keys without it.
 */
const PREFIX_RE = /^[a-z0-9][a-z0-9-]{0,30}\/$/;

export function assertValidPrefix(prefix: string): void {
  if (!PREFIX_RE.test(prefix)) throw new Error(`MEDIA_PREFIX must look like "staging/" (lowercase letters, digits, "-", one trailing slash); got "${prefix}"`);
}

export function withPrefix(bucket: R2Bucket, prefix: string): R2Bucket {
  if (!prefix) return bucket;
  assertValidPrefix(prefix);
  const p = (key: string) => prefix + key;
  const wrapped = {
    put: (key: string, ...rest: unknown[]) => (bucket.put as (...a: unknown[]) => unknown)(p(key), ...rest),
    get: (key: string, ...rest: unknown[]) => (bucket.get as (...a: unknown[]) => unknown)(p(key), ...rest),
    head: (key: string) => bucket.head(p(key)),
    delete: (keys: string | string[]) => bucket.delete(Array.isArray(keys) ? keys.map(p) : p(keys)),
    list: async (options: R2ListOptions = {}) => {
      const res = await bucket.list({ ...options, prefix: p(options.prefix ?? '') });
      return { ...res, objects: res.objects.map((o) => ({ ...o, key: o.key.slice(prefix.length) })) };
    },
  };
  return wrapped as unknown as R2Bucket;
}
