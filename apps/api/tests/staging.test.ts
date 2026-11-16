import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import { assertValidPrefix, withPrefix } from '../src/services/prefixed-bucket';
import { JPEG, ORIGIN, authed, createProject, signUp, uuid } from './helpers';

/** Same worker, but configured like the staging environment (shared private bucket + prefix). */
const stagingEnv = (over: Record<string, unknown> = {}) => ({ ...env, ENVIRONMENT: 'staging', MEDIA_PREFIX: 'staging/', AUTH_BASE_URL: 'https://api-staging.example.workers.dev', APP_ORIGINS: ORIGIN, ...over });
const req = (e: unknown, path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { Origin: ORIGIN, ...(init.headers as Record<string, string>) } }, e as typeof env);

describe('R2 key prefix (staging shares the private bucket without touching other environments)', () => {
  it('validates the prefix format', () => {
    for (const ok of ['staging/', 'dev-1/', 'a/']) expect(() => assertValidPrefix(ok)).not.toThrow();
    for (const bad of ['staging', '/staging/', '../x/', 'Staging/', 'a/b/', '', 'x'.repeat(40) + '/']) expect(() => assertValidPrefix(bad)).toThrow();
  });

  it('writes under the prefix only, reads/deletes through it, and never exposes the prefix in D1 or responses', async () => {
    const u = await signUp('stg');
    const pid = await createProject(u);
    const photoId = uuid();
    const up = await req(stagingEnv(), `/v1/media/project-photos/${pid}/${photoId}`, { method: 'PUT', headers: authed(u, { 'Content-Type': 'image/jpeg' }), body: JPEG });
    expect(up.status).toBe(201);
    const { key } = (await up.json()) as { key: string };
    expect(key.startsWith('staging/')).toBe(false); // clients and D1 never see the prefix
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM media_objects WHERE key = ?').bind(key).first()).toEqual({ n: 1 });

    expect(await env.MEDIA.head(`staging/${key}`)).not.toBeNull(); // physically under the prefix
    expect(await env.MEDIA.head(key)).toBeNull(); // not in the bucket root (production namespace)

    const dl = await req(stagingEnv(), `/v1/media/object?key=${encodeURIComponent(key)}`, { headers: authed(u) });
    expect(dl.status).toBe(200);
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(JPEG);

    // the same row served through a DIFFERENT prefix (e.g. production) cannot see the staging object
    const other = await req(stagingEnv({ MEDIA_PREFIX: 'production/' }), `/v1/media/object?key=${encodeURIComponent(key)}`, { headers: authed(u) });
    expect(other.status).toBe(404);

    const del = await req(stagingEnv(), `/v1/media/object?key=${encodeURIComponent(key)}`, { method: 'DELETE', headers: authed(u) });
    expect(del.status).toBe(204);
    expect(await env.MEDIA.head(`staging/${key}`)).toBeNull();
  });

  it('deleting a project removes its prefixed objects', async () => {
    const u = await signUp('stgdel');
    const pid = await createProject(u);
    await req(stagingEnv(), `/v1/media/project-covers/${pid}`, { method: 'PUT', headers: authed(u, { 'Content-Type': 'image/jpeg' }), body: JPEG });
    expect((await env.MEDIA.list({ prefix: `staging/${u.id}/` })).objects).toHaveLength(1);
    const del = await req(stagingEnv(), `/v1/projects/${pid}`, { method: 'DELETE', headers: authed(u) });
    expect(del.status).toBe(204);
    expect((await env.MEDIA.list({ prefix: `staging/${u.id}/` })).objects).toHaveLength(0);
  });

  it('withPrefix("") is a no-op and list() hides the prefix', async () => {
    expect(withPrefix(env.MEDIA, '')).toBe(env.MEDIA);
    await env.MEDIA.put('staging/zzz-listcheck', 'x');
    const keys = (await withPrefix(env.MEDIA, 'staging/').list({ prefix: 'zzz-' })).objects.map((o) => o.key);
    expect(keys).toEqual(['zzz-listcheck']);
  });
});

describe('deployed-environment safety', () => {
  it('refuses to serve while a REPLACE_ placeholder is still configured', async () => {
    const res = await req(stagingEnv({ AUTH_BASE_URL: 'https://gharzetak-api-staging.REPLACE_ACCOUNT_SUBDOMAIN.workers.dev' }), '/health');
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('misconfigured');
  });

  it('refuses to serve the development configuration on a public host (accidental deploy without --env)', async () => {
    const devEnv = { ...env, ENVIRONMENT: 'development' };
    expect((await app.request('https://api.example.com/health', {}, devEnv)).status).toBe(500);
    expect((await app.request('http://localhost:8787/health', {}, devEnv)).status).toBe(200);
    expect((await app.request('http://127.0.0.1:8787/health', {}, devEnv)).status).toBe(200);
  });

  it('serves normally once configured', async () => {
    expect((await req(stagingEnv(), '/health')).status).toBe(200);
  });

  it('staging enables the database-backed rate limiter', async () => {
    const u = await signUp('stgrl');
    const attempt = () =>
      req(stagingEnv(), '/api/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.9' }, body: JSON.stringify({ email: u.email, password: 'wrong-password-1' }) });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await attempt()).status);
    expect(statuses).toContain(429);
  });
});
