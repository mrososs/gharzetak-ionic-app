import { env } from 'cloudflare:workers';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAuth, googleAudiences } from '../src/auth';
import type { AppEnv } from '../src/env';
import { authed, call, json, signUp } from './helpers';

/**
 * Google sign-in with a Google-issued ID token. The real Google JWKS endpoint is replaced by a locally generated RSA key, so
 * these tests exercise Better Auth's real verification (signature, issuer, audience, expiry, nonce) and linking logic.
 * They do NOT prove that a real Google account / Android client works: that is verified on the physical phone.
 */
const WEB = (env as unknown as AppEnv).GOOGLE_CLIENT_ID as string;
const ANDROID = (env as unknown as AppEnv).GOOGLE_ANDROID_CLIENT_ID as string;
const KID = 'test-key-1';
const CERTS = 'https://www.googleapis.com/oauth2/v3/certs';

let signing: CryptoKey;
let otherKey: CryptoKey;
let jwk: JWK;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  signing = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
  otherKey = (await generateKeyPair('RS256')).privateKey; // a key Google never published
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(CERTS)) return Promise.resolve(new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } }));
    return realFetch(input, init);
  });
});
afterAll(() => vi.unstubAllGlobals());

interface Claims {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  aud: string;
  iss: string;
  nonce: string;
  expiresIn: string;
}

let n = 0;
async function idToken(over: Partial<Claims> = {}, key: CryptoKey = signing): Promise<string> {
  const c: Claims = { sub: `g-sub-${Date.now()}-${n++}`, email: `g${Date.now()}-${n++}@gmail.test`, email_verified: true, name: 'Gina Google', aud: WEB, iss: 'https://accounts.google.com', nonce: '', expiresIn: '10m', ...over };
  const jwt = new SignJWT({ email: c.email, email_verified: c.email_verified, name: c.name, picture: 'https://example.test/p.png', ...(c.nonce ? { nonce: c.nonce } : {}) })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setSubject(c.sub)
    .setIssuer(c.iss)
    .setAudience(c.aud)
    .setIssuedAt()
    .setExpirationTime(c.expiresIn);
  return jwt.sign(key);
}

const googleSignIn = (token: string, nonce?: string) =>
  json(null, 'POST', '/api/auth/sign-in/social', { provider: 'google', idToken: { token, ...(nonce ? { nonce } : {}) } });

const first = async <T>(sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args).first<T>();

describe('Google sign-in (ID token)', () => {
  it('creates a user, a google account, a profile and a bearer session', async () => {
    const t = await idToken({ email: 'new.google.user@gmail.test', name: 'Gina Google', sub: 'sub-new-1' });
    const res = await googleSignIn(t);
    expect(res.status).toBe(200);
    const bearer = res.headers.get('set-auth-token');
    expect(bearer && bearer.length).toBeGreaterThan(20);
    const body = (await res.json()) as { user: { id: string; email: string; name: string; emailVerified: boolean } };
    expect(body.user).toMatchObject({ email: 'new.google.user@gmail.test', name: 'Gina Google', emailVerified: true });

    const acct = await first<{ provider_id: string; account_id: string; id_token: string | null; access_token: string | null; refresh_token: string | null }>(
      'select provider_id, account_id, id_token, access_token, refresh_token from account where user_id = ?',
      body.user.id,
    );
    expect(acct).toMatchObject({ provider_id: 'google', account_id: 'sub-new-1' });
    // data minimisation: no provider token is persisted
    expect(acct?.id_token).toBeNull();
    expect(acct?.access_token).toBeNull();
    expect(acct?.refresh_token).toBeNull();

    const profile = await first<{ c: number; display_name: string }>('select count(*) c, max(display_name) display_name from profiles where user_id = ?', body.user.id);
    expect(profile).toMatchObject({ c: 1, display_name: 'Gina Google' });

    // the bearer session works on the protected API exactly like an email/password session
    const pull = await call('/v1/sync/pull', { headers: authed({ id: body.user.id, email: body.user.email, token: bearer! }) });
    expect(pull.status).toBe(200);
  });

  it('is idempotent: signing in again returns the same user without duplicating profile or account', async () => {
    const claims = { email: 'repeat@gmail.test', sub: 'sub-repeat' };
    const a = (await (await googleSignIn(await idToken(claims))).json()) as { user: { id: string } };
    const res2 = await googleSignIn(await idToken(claims));
    expect(res2.status).toBe(200);
    const b = (await res2.json()) as { user: { id: string } };
    expect(b.user.id).toBe(a.user.id);
    expect((await first<{ c: number }>('select count(*) c from account where user_id = ?', a.user.id))?.c).toBe(1);
    expect((await first<{ c: number }>('select count(*) c from profiles where user_id = ?', a.user.id))?.c).toBe(1);
  });

  it('accepts the Android client id as a configured audience', async () => {
    expect((await googleSignIn(await idToken({ aud: ANDROID }))).status).toBe(200);
  });

  it('rejects a token minted for a different audience (another app\'s client id)', async () => {
    const res = await googleSignIn(await idToken({ aud: '999999999999-someone-elses-app.apps.googleusercontent.com' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-auth-token')).toBeNull();
  });

  it('rejects expired tokens, wrong issuers and tokens signed with an unknown key', async () => {
    expect((await googleSignIn(await idToken({ expiresIn: '-10m' }))).status).toBe(401);
    expect((await googleSignIn(await idToken({ iss: 'https://evil.example' }))).status).toBe(401);
    expect((await googleSignIn(await idToken({}, otherKey))).status).toBe(401);
    expect((await googleSignIn('not.a.jwt')).status).toBe(401);
  });

  it('verifies the nonce when one is sent and rejects a replayed/mismatched nonce', async () => {
    const t = await idToken({ nonce: 'nonce-abc-123' });
    expect((await googleSignIn(t, 'a-different-nonce')).status).toBe(401);
    expect((await googleSignIn(t, 'nonce-abc-123')).status).toBe(200);
  });

  it('does NOT take over an existing unverified email/password account', async () => {
    const victim = await signUp('victim'); // email/password account, email NOT verified
    const res = await googleSignIn(await idToken({ email: victim.email, email_verified: true, sub: 'sub-attacker' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('set-auth-token')).toBeNull();
    expect((await first<{ c: number }>("select count(*) c from account where user_id = ? and provider_id = 'google'", victim.id))?.c).toBe(0);
    // the original email/password login keeps working untouched
    const login = await json(null, 'POST', '/api/auth/sign-in/email', { email: victim.email, password: 'correct-horse-battery' });
    expect(login.status).toBe(200);
  });

  it('links to an existing account whose email is verified, keeping the same user id, profile and data', async () => {
    const owner = await signUp('owner');
    await env.DB.prepare('update user set email_verified = 1 where id = ?').bind(owner.id).run();
    const res = await googleSignIn(await idToken({ email: owner.email, email_verified: true, sub: 'sub-owner' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { id: string } };
    expect(body.user.id).toBe(owner.id);
    expect((await first<{ c: number }>('select count(*) c from profiles where user_id = ?', owner.id))?.c).toBe(1);
    expect((await first<{ c: number }>("select count(*) c from account where user_id = ? and provider_id = 'google'", owner.id))?.c).toBe(1);
  });

  it('does not link when Google does not vouch for the email', async () => {
    const owner = await signUp('owner2');
    await env.DB.prepare('update user set email_verified = 1 where id = ?').bind(owner.id).run();
    const res = await googleSignIn(await idToken({ email: owner.email, email_verified: false, sub: 'sub-unverified' }));
    expect(res.status).toBe(401);
  });
});

describe('Google configuration', () => {
  it('lists configured audiences, web client first, without duplicates or blanks', () => {
    expect(googleAudiences({ GOOGLE_CLIENT_ID: ' web ', GOOGLE_ANDROID_CLIENT_ID: 'android' })).toEqual(['web', 'android']);
    expect(googleAudiences({ GOOGLE_CLIENT_ID: 'same', GOOGLE_ANDROID_CLIENT_ID: 'same' })).toEqual(['same']);
    expect(googleAudiences({})).toEqual([]);
  });

  it('exposes no Google sign-in when the provider is not configured', async () => {
    const auth = createAuth({ ...(env as unknown as AppEnv), GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined });
    await expect(auth.api.signInSocial({ body: { provider: 'google', idToken: { token: await idToken() } } })).rejects.toThrow();
  });

  it('never returns the client secret in any API response', async () => {
    const res = await call('/health');
    const text = await res.text();
    expect(text).not.toContain((env as unknown as AppEnv).GOOGLE_CLIENT_SECRET as string);
  });
});
