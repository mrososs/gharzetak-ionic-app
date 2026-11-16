import { env } from 'cloudflare:workers';
import app from '../src/index';

export const ORIGIN = 'http://localhost:4200';
export const uuid = () => crypto.randomUUID();

export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
export const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
export const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>');

export const call = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { Origin: ORIGIN, ...(init.headers as Record<string, string> | undefined) } }, env);

export interface TestUser {
  id: string;
  email: string;
  token: string;
}

let n = 0;
export async function signUp(label = 'user'): Promise<TestUser> {
  const email = `${label}-${Date.now()}-${n++}@gharzetak.test`;
  const res = await call('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct-horse-battery', name: label }),
  });
  if (res.status !== 200) throw new Error(`sign-up failed ${res.status}: ${await res.text()}`);
  const token = res.headers.get('set-auth-token');
  const body = (await res.json()) as { user: { id: string } };
  if (!token) throw new Error('no set-auth-token header');
  return { id: body.user.id, email, token };
}

export const authed = (u: TestUser | null, extra: Record<string, string> = {}): Record<string, string> => ({ ...(u ? { Authorization: `Bearer ${u.token}` } : {}), ...extra });

export const json = (u: TestUser | null, method: string, path: string, body?: unknown) =>
  call(path, { method, headers: authed(u, { 'Content-Type': 'application/json' }), body: body === undefined ? undefined : JSON.stringify(body) });

export const bytes = (u: TestUser | null, path: string, data: Uint8Array, type: string, extra: Record<string, string> = {}) =>
  call(path, { method: 'PUT', headers: authed(u, { 'Content-Type': type, ...extra }), body: data });

export const projectBody = (over: Record<string, unknown> = {}) => ({
  baseRevision: 0,
  clientUpdatedAt: Date.now(),
  name: 'Bunny',
  category: 'amigurumi',
  hookSize: '3.0',
  yarnType: 'cotton',
  status: 'active',
  patternId: null,
  estimatedHours: 4,
  workedSeconds: 0,
  lastWorkedAt: Date.now(),
  createdAt: Date.now(),
  ...over,
});

export const progressBody = (over: Record<string, unknown> = {}) => ({
  baseRevision: 0,
  clientUpdatedAt: Date.now(),
  mode: 'simple',
  round: 1,
  target: 30,
  perTap: 1,
  count: 0,
  totalRounds: 0,
  patternId: null,
  patternRoundIndex: 0,
  actionPtr: 0,
  countMode: 'action',
  history: [],
  patternHistory: [],
  ...over,
});

export async function createProject(u: TestUser, over: Record<string, unknown> = {}) {
  const id = uuid();
  const res = await json(u, 'PUT', `/v1/projects/${id}`, projectBody(over));
  if (res.status !== 201) throw new Error(`project create failed ${res.status}: ${await res.text()}`);
  return id;
}
