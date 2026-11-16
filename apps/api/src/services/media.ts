import { badRequest, ApiError } from '../errors';

export type MediaKind = 'project-photo' | 'project-cover' | 'pattern-file';

export interface MediaRule {
  readonly maxBytes: number;
  readonly mimes: readonly string[];
}

/** Same limits as the former Supabase buckets (project-photos 8 MiB, pattern-files 10 MiB). */
export const MEDIA_RULES: Record<MediaKind, MediaRule> = {
  'project-photo': { maxBytes: 8 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'image/webp'] },
  'project-cover': { maxBytes: 8 * 1024 * 1024, mimes: ['image/jpeg', 'image/png', 'image/webp'] },
  'pattern-file': { maxBytes: 10 * 1024 * 1024, mimes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] },
};

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
export const extFor = (mime: string) => EXT[mime] ?? 'bin';

/** Identifies the real file type from its leading bytes. The client-declared Content-Type is never trusted. */
export function sniffMime(b: Uint8Array): string | null {
  const at = (i: number) => b[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return 'image/png';
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return 'image/webp';
  // %PDF- must appear within the first 1024 bytes (PDF spec allows leading junk)
  const head = new TextDecoder('latin1').decode(b.subarray(0, Math.min(1024, b.length)));
  if (head.includes('%PDF-')) return 'application/pdf';
  return null;
}

/** Reads a request body into memory but aborts as soon as it exceeds `maxBytes` (Content-Length can lie). */
export async function readLimited(req: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length') ?? '-1');
  if (declared > maxBytes) throw new ApiError(413, 'file_too_large', `File exceeds ${maxBytes} bytes`);
  if (!req.body) throw badRequest('Empty body');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ApiError(413, 'file_too_large', `File exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  if (total === 0) throw badRequest('Empty body');
  const out = new Uint8Array(total);
  let off = 0;
  for (const ch of chunks) {
    out.set(ch, off);
    off += ch.byteLength;
  }
  return out;
}

/** Validates size + real type; returns the verified mime. */
export function validateUpload(kind: MediaKind, bytes: Uint8Array, declaredType: string | null): string {
  const rule = MEDIA_RULES[kind];
  const real = sniffMime(bytes);
  if (!real || !rule.mimes.includes(real)) throw new ApiError(415, 'unsupported_type', `Allowed types: ${rule.mimes.join(', ')}`);
  const declared = (declaredType ?? '').split(';')[0]?.trim().toLowerCase();
  if (declared && declared !== 'application/octet-stream' && declared !== real) throw new ApiError(415, 'type_mismatch', 'Declared Content-Type does not match the file contents');
  return real;
}

/** User ids come from Better Auth; assert they are key-safe before they become an R2 path segment. */
export function safeSegment(v: string): string {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(v)) throw badRequest('Unsafe identifier');
  return v;
}
