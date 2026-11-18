/**
 * Khayoota AI — the ONLY logger used by the AI routes. It accepts a fixed set of operational fields and drops everything
 * else, so prompts, replies, images, pattern text, tokens or e-mail addresses cannot reach Workers Logs by accident.
 */
const ALLOWED = ['requestId', 'route', 'kind', 'model', 'provider', 'status', 'code', 'latencyMs', 'tokensIn', 'tokensOut', 'neurons', 'images', 'degraded', 'repaired', 'actions', 'modelActions', 'scope'] as const;
type Field = (typeof ALLOWED)[number];
export type AiLogEvent = Partial<Record<Field, string | number | boolean | null>>;

const SAFE_STRING = /^[A-Za-z0-9@/._:-]{0,80}$/;

export function aiLog(event: AiLogEvent): void {
  const out: Record<string, string | number | boolean | null> = {};
  for (const k of ALLOWED) {
    const v = event[k];
    if (v === undefined) continue;
    // Strings must look like identifiers/codes; anything else (free text) is withheld.
    out[k] = typeof v === 'string' && !SAFE_STRING.test(v) ? '[withheld]' : v;
  }
  console.log(JSON.stringify({ khayoota: out }));
}
