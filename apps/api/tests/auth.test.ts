import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import app from '../src/index';
import { devOutbox } from '../src/services/mailer';
import { hashPassword, verifyPassword } from '../src/services/password';
import { ORIGIN, authed, call, json, signUp } from './helpers';

describe('health + CORS', () => {
  it('reports ok and that R2 is bound', async () => {
    const res = await call('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', service: 'gharzetak-api', r2Bound: true });
  });

  it('allows only configured origins and never credentials', async () => {
    const ok = await call('/health', { headers: { Origin: ORIGIN } });
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(ok.headers.get('access-control-allow-credentials')).toBeNull();
    const cap = await call('/health', { headers: { Origin: 'capacitor://localhost' } });
    expect(cap.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
    const evil = await call('/health', { headers: { Origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await call('/v1/sync/pull', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
  });

  it('sets hardening headers', async () => {
    const res = await call('/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('password hashing', () => {
  it('round-trips and rejects wrong passwords / malformed hashes', async () => {
    const h = await hashPassword('hunter2-hunter2');
    expect(h.startsWith('pbkdf2-sha256$100000$')).toBe(true);
    expect(await verifyPassword({ hash: h, password: 'hunter2-hunter2' })).toBe(true);
    expect(await verifyPassword({ hash: h, password: 'hunter2-hunter3' })).toBe(false);
    expect(await verifyPassword({ hash: 'garbage', password: 'x' })).toBe(false);
    expect(await verifyPassword({ hash: 'pbkdf2-sha256$99999999$AAAA$AAAA', password: 'x' })).toBe(false);
  });
});

describe('authentication (Better Auth + bearer tokens)', () => {
  it('registers, returns a bearer token, creates a profile row, and restores the session', async () => {
    const u = await signUp('anna');
    expect(u.token.length).toBeGreaterThan(20);

    const profile = await env.DB.prepare('SELECT display_name, revision FROM profiles WHERE user_id = ?').bind(u.id).first<{ display_name: string; revision: number }>();
    expect(profile).toEqual({ display_name: 'anna', revision: 1 });

    const session = await call('/api/auth/get-session', { headers: authed(u) });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ user: { id: u.id, email: u.email } });
  });

  it('stores a salted PBKDF2 hash, never the password', async () => {
    const u = await signUp('hash');
    const acc = await env.DB.prepare('SELECT password FROM account WHERE user_id = ?').bind(u.id).first<{ password: string }>();
    expect(acc?.password.startsWith('pbkdf2-sha256$')).toBe(true);
    expect(acc?.password).not.toContain('correct-horse-battery');
  });

  it('signs in with the right password and rejects the wrong one', async () => {
    const u = await signUp('login');
    const bad = await call('/api/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password: 'wrong-password-1' }) });
    expect(bad.status).toBe(401);
    const good = await call('/api/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password: 'correct-horse-battery' }) });
    expect(good.status).toBe(200);
    expect(good.headers.get('set-auth-token')).toBeTruthy();
  });

  it('rejects duplicate emails and short passwords', async () => {
    const u = await signUp('dup');
    const dup = await call('/api/auth/sign-up/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password: 'correct-horse-battery', name: 'dup' }) });
    expect(dup.status).toBeGreaterThanOrEqual(400);
    const short = await call('/api/auth/sign-up/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `s-${Date.now()}@gharzetak.test`, password: 'short', name: 's' }) });
    expect(short.status).toBe(400);
  });

  it('signs out: the token stops working (expired/revoked session)', async () => {
    const u = await signUp('bye');
    expect((await json(u, 'GET', '/v1/sync/pull')).status).toBe(200);
    const out = await call('/api/auth/sign-out', { method: 'POST', headers: authed(u, { 'Content-Type': 'application/json' }), body: '{}' });
    expect(out.status).toBe(200);
    expect((await json(u, 'GET', '/v1/sync/pull')).status).toBe(401);
  });

  it('refuses missing, malformed and forged tokens on every /v1 route', async () => {
    expect((await json(null, 'GET', '/v1/sync/pull')).status).toBe(401);
    expect((await call('/v1/sync/pull', { headers: { Authorization: 'Bearer not-a-real-token' } })).status).toBe(401);
    expect((await call('/v1/sync/pull', { headers: { Authorization: 'Basic abc' } })).status).toBe(401);
    const body = (await (await json(null, 'GET', '/v1/sync/pull')).json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });

  it('password reset: emails a link, the new password works, old sessions are revoked', async () => {
    const u = await signUp('reset');
    devOutbox.length = 0;
    const req = await call('/api/auth/request-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: u.email, redirectTo: `${ORIGIN}/auth/reset` }),
    });
    expect(req.status).toBe(200);
    const mail = devOutbox.find((m) => m.to === u.email);
    expect(mail?.link).toContain('/reset-password/');
    const token = new URL(mail!.link).pathname.split('/').pop()!;

    const reset = await call('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, newPassword: 'a-brand-new-password' }) });
    expect(reset.status).toBe(200);

    expect((await json(u, 'GET', '/v1/sync/pull')).status).toBe(401); // revokeSessionsOnPasswordReset
    const old = await call('/api/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password: 'correct-horse-battery' }) });
    expect(old.status).toBe(401);
    const fresh = await call('/api/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: u.email, password: 'a-brand-new-password' }) });
    expect(fresh.status).toBe(200);

    const reuse = await call('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, newPassword: 'another-password-123' }) });
    expect(reuse.status).toBeGreaterThanOrEqual(400); // single-use token
  });

  it('rate-limits repeated failed sign-ins (database-backed limiter, production setting)', async () => {
    const u = await signUp('ratelimit');
    const attempt = () =>
      app.request(
        '/api/auth/sign-in/email',
        { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.7' }, body: JSON.stringify({ email: u.email, password: 'wrong-password-1' }) },
        { ...env, ENVIRONMENT: 'test-ratelimit' },
      );
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await attempt()).status);
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true);
    expect(statuses).toContain(429);
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM rate_limit').first<{ n: number }>();
    expect(row!.n).toBeGreaterThan(0); // state lives in D1, so it holds across Worker isolates
  });

  it('does not reveal whether an email exists when requesting a reset', async () => {
    const res = await call('/api/auth/request-password-reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nobody@gharzetak.test', redirectTo: `${ORIGIN}/auth/reset` }) });
    expect(res.status).toBe(200);
  });
});
