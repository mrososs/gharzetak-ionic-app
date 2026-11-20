/**
 * Khayoota hosted-AI daily quota for the shared test build: 10 chat messages and 5 images per account per Africa/Cairo day,
 * one verified-e-mail exemption, server-side enforcement, idempotent retries, refunds, DST-safe reset.
 * Every test uses the offline FakeAiProvider: no real model is called, and no real account is involved.
 */
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { FakeAiProvider, FAKE_TRIGGERS } from '../src/services/ai/provider';
import { nextQuotaReset, quotaDay } from '../src/services/ai/config';
import type { AppEnv } from '../src/env';
import { JPEG, ORIGIN, call, signUp, type TestUser } from './helpers';

type Env = typeof env;
/** Generous caps so only the per-account quota under test can refuse (global/burst have their own tests). */
const base = { AI_ENABLED: 'true', AI_PROVIDER: 'fake', AI_VISION_ENABLED: 'true', AI_EXTRACT_ENABLED: 'true', AI_BURST_UNITS_PER_MINUTE: '10000', AI_DAILY_REQUEST_CAP: '1000000', AI_DAILY_NEURON_BUDGET: '100000000' };
const qEnv = (over: Record<string, string> = {}): Env => ({ ...env, ...base, ...over }) as Env;
const b64 = (u8: Uint8Array) => btoa(String.fromCharCode(...u8));
const jpeg = { mime: 'image/jpeg', data: b64(JPEG) };
const photos = (n: number) => Array.from({ length: n }, () => jpeg);

const send = (u: TestUser | null, method: string, path: string, body?: unknown, e: Env = qEnv(), headers: Record<string, string> = {}) =>
  app.request(
    path,
    { method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(u ? { Authorization: `Bearer ${u.token}` } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) },
    e,
  );
const chat = (u: TestUser | null, body: Record<string, unknown>, e?: Env, headers?: Record<string, string>) => send(u, 'POST', '/v1/ai/chat', { v: 1, lang: 'en', ...body }, e, headers);
const extract = (u: TestUser, body: Record<string, unknown>, e?: Env) => send(u, 'POST', '/v1/ai/extract', { v: 1, lang: 'en', ...body }, e);
const errCode = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;

interface Quota {
  unlimited: boolean;
  timezone: string;
  chat: { used: number; limit: number | null; remaining: number | null };
  image: { used: number; limit: number | null; remaining: number | null };
  resetAt: string | null;
}
const status = async (u: TestUser, e?: Env) => (await (await send(u, 'GET', '/v1/ai/status', undefined, e)).json()) as { enabled: boolean; quota: Quota; remaining: { chat: number; image: number }; limits: { chat: number; image: number } };
const quota = async (u: TestUser, e?: Env) => (await status(u, e)).quota;

async function consented(label = 'q'): Promise<TestUser> {
  const u = await signUp(label);
  expect((await send(u, 'PUT', '/v1/ai/consent', { version: 1 })).status).toBe(200);
  return u;
}

/** Signs the same account in again (a second device, a reinstall, or a new session after sign-out). */
async function signInAgain(u: TestUser): Promise<TestUser> {
  // The stored e-mail is read from D1: fixtures may have changed it since sign-up.
  const row = await env.DB.prepare('SELECT email FROM user WHERE id = ?1').bind(u.id).first<{ email: string }>();
  const res = await call('/api/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: row!.email.trim(), password: 'correct-horse-battery' }) });
  expect(res.status).toBe(200);
  return { ...u, token: res.headers.get('set-auth-token')! };
}

/** Gives a fixture account a specific stored e-mail, as a Google sign-in (verified) or a plain sign-up (unverified) would. */
const setIdentity = (u: TestUser, email: string, verified: boolean) => env.DB.prepare('UPDATE user SET email = ?1, email_verified = ?2 WHERE id = ?3').bind(email, verified ? 1 : 0, u.id).run();

beforeEach(() => {
  FakeAiProvider.calls = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('limits for a normal account (10 messages, 5 images per day)', () => {
  it('a new account starts with 10 messages and 5 images, authoritative from the server', async () => {
    const u = await consented('start');
    const s = await status(u);
    expect(s.quota).toMatchObject({ unlimited: false, timezone: 'Africa/Cairo', chat: { used: 0, limit: 10, remaining: 10 }, image: { used: 0, limit: 5, remaining: 5 } });
    expect(typeof s.quota.resetAt).toBe('string');
    // v1 fields older builds read stay numeric and agree
    expect(s.limits).toMatchObject({ chat: 10, image: 5 });
    expect(s.remaining).toMatchObject({ chat: 10, image: 5 });
  });

  it('sends 10 messages, refuses the 11th with the reason, the reset time and the numbers — without calling the model', async () => {
    const u = await consented('ten');
    for (let i = 1; i <= 10; i++) {
      const r = await chat(u, { message: `q${i}` });
      expect(r.status, `message ${i}`).toBe(200);
      expect(((await r.json()) as { usage: { remaining: { chat: number }; quota: Quota } }).usage.quota.chat.remaining).toBe(10 - i);
    }
    FakeAiProvider.calls = 0;
    const r = await chat(u, { message: 'q11' });
    const body = (await r.json()) as { error: { code: string }; resetAt: string };
    expect([r.status, body.error.code]).toEqual([429, 'ai_quota_exceeded']);
    expect(body).toMatchObject({ scope: 'user', kind: 'chat', remaining: { chat: 0, image: 5 }, limits: { chat: 10, image: 5 } });
    expect(body.resetAt).toBe((await quota(u)).resetAt);
    expect(FakeAiProvider.calls).toBe(0);
    expect((await quota(u)).chat.used).toBe(10);
  });

  it('accepts 5 images across messages and refuses the 6th image; a text message still works (independent counters)', async () => {
    const u = await consented('five');
    for (let i = 1; i <= 5; i++) expect((await chat(u, { message: `p${i}`, images: photos(1) })).status, `image ${i}`).toBe(200);
    FakeAiProvider.calls = 0;
    const r = await chat(u, { message: 'p6', images: photos(1) });
    const body = (await r.json()) as { error: { code: string } };
    expect([r.status, body.error.code]).toEqual([429, 'ai_quota_exceeded']);
    expect(body).toMatchObject({ scope: 'user', kind: 'image', remaining: { chat: 5, image: 0 } });
    expect(FakeAiProvider.calls).toBe(0);
    expect((await chat(u, { message: 'just text' })).status).toBe(200); // chat quota is separate from image quota
    expect(await quota(u)).toMatchObject({ chat: { used: 6, remaining: 4 }, image: { used: 5, remaining: 0 } });
  });

  it('a message with N images costs one chat message plus N images; text-only costs no image', async () => {
    const u = await consented('multi');
    expect((await chat(u, { message: 'three', images: photos(3) })).status).toBe(200);
    expect(await quota(u)).toMatchObject({ chat: { used: 1, remaining: 9 }, image: { used: 3, remaining: 2 } });
    expect((await chat(u, { message: 'text' })).status).toBe(200);
    expect(await quota(u)).toMatchObject({ chat: { used: 2 }, image: { used: 3 } });
    // pattern reading is a hosted request too: one message + one per page photo
    expect((await extract(u, { images: photos(2) })).status).toBe(200);
    expect(await quota(u)).toMatchObject({ chat: { used: 3 }, image: { used: 5, remaining: 0 } });
  });

  it('2 images left and 3 submitted: rejected BEFORE the model, nothing is charged, the exact numbers come back', async () => {
    const u = await consented('short');
    expect((await chat(u, { message: 'use3', images: photos(3) })).status).toBe(200);
    FakeAiProvider.calls = 0;
    const r = await chat(u, { message: 'too many', images: photos(3) });
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ error: { code: 'ai_quota_exceeded' }, scope: 'user', kind: 'image', requested: { chat: 1, image: 3 }, remaining: { chat: 9, image: 2 } });
    expect(FakeAiProvider.calls).toBe(0);
    expect(await quota(u)).toMatchObject({ chat: { used: 1 }, image: { used: 3 } }); // all-or-nothing: no half charge
    expect((await chat(u, { message: 'two fit', images: photos(2) })).status).toBe(200);
  });

  it('when messages are used up, an image message is refused and its images are NOT consumed', async () => {
    const u = await consented('chatfirst');
    const e = qEnv({ AI_USER_DAILY_CHAT: '1' });
    expect((await chat(u, { message: 'only one' }, e)).status).toBe(200);
    const r = await chat(u, { message: 'with photo', images: photos(1) }, e);
    expect(await r.json()).toMatchObject({ scope: 'user', kind: 'chat' });
    expect((await quota(u, e)).image.used).toBe(0);
  });

  it('invalid images and oversized uploads are rejected before any quota is charged', async () => {
    const u = await consented('invalid');
    const bad = await chat(u, { message: 'gif', images: [{ mime: 'image/jpeg', data: btoa('GIF89a not a jpeg at all') }] });
    expect([bad.status, await errCode(bad)]).toEqual([415, 'ai_unsupported_image']);
    const gif = await chat(u, { message: 'gif', images: [{ mime: 'image/gif', data: jpeg.data }] });
    expect(gif.status).toBe(400);
    const huge = await chat(u, { message: 'big', images: [{ mime: 'image/jpeg', data: '/9j/' + 'A'.repeat(950_001) }] });
    expect(huge.status).toBe(400);
    const five = await chat(u, { message: 'five', images: photos(5) });
    expect(five.status).toBe(400);
    expect(FakeAiProvider.calls).toBe(0);
    expect(await quota(u)).toMatchObject({ chat: { used: 0 }, image: { used: 0 } });
  });
});

describe('server-side, not client-side', () => {
  it('unauthenticated callers are rejected and never counted', async () => {
    for (const [m, p] of [['GET', '/v1/ai/status'], ['POST', '/v1/ai/chat'], ['POST', '/v1/ai/extract']] as const) expect((await send(null, m, p, m === 'GET' ? undefined : {})).status, p).toBe(401);
    expect(FakeAiProvider.calls).toBe(0);
  });

  it('two devices, a sign-out/sign-in and a fresh install all share ONE counter (the usage lives in D1, not on the phone)', async () => {
    const phoneA = await consented('devices');
    expect((await chat(phoneA, { message: 'a1' })).status).toBe(200);
    const phoneB = await signInAgain(phoneA); // another device
    expect((await chat(phoneB, { message: 'b1', images: photos(2) })).status).toBe(200);
    expect((await send(phoneA, 'POST', '/api/auth/sign-out', {})).status).toBe(200); // sign out…
    const reinstalled = await signInAgain(phoneA); // …and a brand-new session (reinstall) afterwards
    expect(await quota(reinstalled)).toMatchObject({ chat: { used: 2, remaining: 8 }, image: { used: 2, remaining: 3 } });
    expect((await chat(reinstalled, { message: 'c1' })).status).toBe(200);
    expect((await quota(phoneB)).chat.used).toBe(3);
  });

  it('calling the Worker API directly (no app) is limited exactly the same', async () => {
    const u = await consented('direct');
    const e = qEnv({ AI_USER_DAILY_CHAT: '2' });
    for (let i = 0; i < 2; i++) expect((await chat(u, { message: `d${i}` }, e)).status).toBe(200);
    expect((await chat(u, { message: 'd3' }, e)).status).toBe(429);
  });

  it('concurrent requests can never exceed 10 messages or 5 images (single conditional upsert)', async () => {
    const u = await consented('race');
    const res = await Promise.all(Array.from({ length: 16 }, (_, i) => chat(u, { message: `c${i}` })));
    expect(res.filter((r) => r.status === 200)).toHaveLength(10);
    expect(res.filter((r) => r.status === 429)).toHaveLength(6);
    expect((await quota(u)).chat.used).toBe(10);

    const v = await consented('raceimg');
    const imgs = await Promise.all(Array.from({ length: 5 }, (_, i) => chat(v, { message: `i${i}`, images: photos(2) })));
    expect(imgs.filter((r) => r.status === 200)).toHaveLength(2); // 2 × 2 = 4 of 5 images; a third pair would be 6
    expect((await quota(v)).image.used).toBe(4);
  });

  it('accounts do not share quota', async () => {
    const a = await consented('own-a');
    const b = await consented('own-b');
    const e = qEnv({ AI_USER_DAILY_CHAT: '1' });
    expect((await chat(a, { message: 'x' }, e)).status).toBe(200);
    expect((await chat(a, { message: 'y' }, e)).status).toBe(429);
    expect((await chat(b, { message: 'x' }, e)).status).toBe(200);
  });
});

describe('retries and failures are accounted for carefully', () => {
  it('a retried request (same key) after success is refused as a duplicate and never charged twice', async () => {
    const u = await consented('dup');
    const key = 'req-duplicate-0001';
    expect((await chat(u, { message: 'once', clientRequestId: key })).status).toBe(200);
    const again = await chat(u, { message: 'once', clientRequestId: key });
    expect([again.status, await errCode(again)]).toEqual([409, 'ai_duplicate_request']);
    expect(FakeAiProvider.calls).toBe(1);
    expect((await quota(u)).chat.used).toBe(1);
  });

  it('the same key sent concurrently is charged once', async () => {
    const u = await consented('dupconc');
    const res = await Promise.all(Array.from({ length: 4 }, () => chat(u, { message: 'same', clientRequestId: 'req-concurrent-01' })));
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(res.filter((r) => r.status === 409)).toHaveLength(3);
    expect((await quota(u)).chat.used).toBe(1);
  });

  it('a failed request (no reply) is refunded; retrying the same key later is charged once in total', async () => {
    const u = await consented('refund');
    const key = 'req-refund-000001';
    const failed = await chat(u, { message: FAKE_TRIGGERS.timeout, images: photos(2), clientRequestId: key });
    expect([failed.status, await errCode(failed)]).toEqual([504, 'ai_timeout']);
    expect(await quota(u)).toMatchObject({ chat: { used: 0 }, image: { used: 0 } });
    const retry = await chat(u, { message: 'works now', images: photos(2), clientRequestId: key });
    expect(retry.status).toBe(200);
    expect(await quota(u)).toMatchObject({ chat: { used: 1 }, image: { used: 2 } });
  });

  it('refunds are capped per day so failures cannot be farmed', async () => {
    const u = await consented('farm');
    const e = qEnv({ AI_USER_DAILY_REFUNDS: '2' });
    for (let i = 0; i < 4; i++) expect((await chat(u, { message: FAKE_TRIGGERS.timeout }, e)).status).toBe(504);
    expect((await quota(u, e)).chat.used).toBe(2); // two refunded, two stayed charged
  });

  it('a Worker that died mid-request keeps its charge; a retry within 3 minutes is "in progress", afterwards it is re-claimed without a second charge', async () => {
    const u = await consented('crash');
    const key = 'req-crashed-00001';
    const day = quotaDay();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO ai_usage_daily (scope, day, chat, requests) VALUES (?1, ?2, 1, 1) ON CONFLICT(scope, day) DO UPDATE SET chat = chat + 1, requests = requests + 1`).bind(u.id, day),
      env.DB.prepare(`INSERT INTO ai_request_ledger (user_id, request_id, day, chat, image, state, created_at) VALUES (?1, ?2, ?3, 1, 0, 'reserved', ?4)`).bind(u.id, key, day, Date.now()),
    ]);
    const early = await chat(u, { message: 'retry', clientRequestId: key });
    expect([early.status, await errCode(early)]).toEqual([409, 'ai_request_in_progress']);
    await env.DB.prepare(`UPDATE ai_request_ledger SET created_at = ?1 WHERE user_id = ?2`).bind(Date.now() - 200_000, u.id).run();
    expect((await chat(u, { message: 'retry', clientRequestId: key })).status).toBe(200);
    expect((await quota(u)).chat.used).toBe(1);
  });

  it('a malformed key is a validation error and never charged', async () => {
    const u = await consented('badkey');
    expect((await chat(u, { message: 'x', clientRequestId: 'short' })).status).toBe(400);
    expect((await quota(u)).chat.used).toBe(0);
  });
});

describe('daily reset at midnight Africa/Cairo (DST-aware)', () => {
  it('the quota day is the Cairo calendar date, and the reset is the first instant of the next one', () => {
    // Winter (UTC+2): 21:59:59Z is still 23:59:59 Cairo; midnight Cairo = 22:00Z.
    expect(quotaDay(Date.UTC(2026, 0, 15, 21, 59, 59))).toBe('2026-01-15');
    expect(quotaDay(Date.UTC(2026, 0, 15, 22, 0, 0))).toBe('2026-01-16');
    expect(nextQuotaReset(Date.UTC(2026, 0, 15, 12, 0, 0))).toBe('2026-01-15T22:00:00.000Z');
    // Summer (UTC+3): midnight Cairo = 21:00Z.
    expect(nextQuotaReset(Date.UTC(2026, 6, 15, 12, 0, 0))).toBe('2026-07-15T21:00:00.000Z');
    // Spring forward (Fri 24 Apr 2026): 00:00 does not exist; the new day starts at 01:00 local = 22:00Z on the 23rd.
    expect(nextQuotaReset(Date.UTC(2026, 3, 23, 12, 0, 0))).toBe('2026-04-23T22:00:00.000Z');
    // Fall back (Thu 29 Oct 2026): 23:00-24:00 happens twice, so the day ends at 24:00 +02:00 = 22:00Z, not 21:00Z.
    expect(nextQuotaReset(Date.UTC(2026, 9, 29, 10, 0, 0))).toBe('2026-10-29T22:00:00.000Z');
    expect(quotaDay(Date.UTC(2026, 9, 29, 21, 30, 0))).toBe('2026-10-29');
  });

  it('usage resets when the Cairo day changes (summer and winter), and the status reports the next reset', async () => {
    for (const [before, after] of [
      [Date.UTC(2026, 6, 15, 20, 59, 0), Date.UTC(2026, 6, 15, 21, 0, 30)],
      [Date.UTC(2026, 0, 15, 21, 59, 0), Date.UTC(2026, 0, 15, 22, 0, 30)],
    ] as const) {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(before - 3600_000);
      const u = await consented('reset');
      vi.setSystemTime(before);
      for (let i = 0; i < 10; i++) expect((await chat(u, { message: `r${i}` })).status).toBe(200);
      expect((await chat(u, { message: 'over' })).status).toBe(429);
      const q = await quota(u);
      expect(Date.parse(q.resetAt!)).toBeGreaterThan(before);
      expect(Date.parse(q.resetAt!)).toBeLessThanOrEqual(after);
      vi.setSystemTime(after);
      expect(await quota(u)).toMatchObject({ chat: { used: 0, remaining: 10 }, image: { used: 0, remaining: 5 } });
      expect((await chat(u, { message: 'fresh day' })).status).toBe(200);
      vi.useRealTimers();
    }
  });
});

describe('the unlimited account (verified e-mail, trusted identity only)', () => {
  const EXEMPT = 'radwa.ghes@gmail.com';
  const e = () => qEnv({ AI_UNLIMITED_EMAILS: ` ${EXEMPT.toUpperCase()} , other@example.com ` });

  it('has no 10-message or 5-image limit, no countdown, and still gets real replies', async () => {
    const u = await consented('exempt');
    await setIdentity(u, ' Radwa.Ghes@Gmail.com ', true); // stored case/space differences are normalised
    const q = await quota(u, e());
    expect(q).toMatchObject({ unlimited: true, chat: { limit: null, remaining: null }, image: { limit: null, remaining: null }, resetAt: null });
    for (let i = 0; i < 14; i++) expect((await chat(u, { message: `u${i}` }, e())).status, `message ${i}`).toBe(200);
    for (let i = 0; i < 4; i++) expect((await chat(u, { message: `p${i}`, images: photos(4) }, e())).status).toBe(200); // 16 images
    expect((await quota(u, e()))).toMatchObject({ unlimited: true, chat: { used: 18 }, image: { used: 16 } });
  });

  it('persists across sessions and devices (it is the account, not the session)', async () => {
    const u = await consented('exempt-dev');
    await setIdentity(u, 'exempt-dev@gharzetak.test', true);
    const env2 = qEnv({ AI_UNLIMITED_EMAILS: 'exempt-dev@gharzetak.test' });
    expect((await quota(u, env2)).unlimited).toBe(true);
    const other = await signInAgain(u);
    expect((await quota(other, env2)).unlimited).toBe(true);
    for (let i = 0; i < 12; i++) expect((await chat(other, { message: `x${i}` }, env2)).status).toBe(200);
  });

  it('nobody else can claim it: client-supplied e-mail, headers or flags are ignored', async () => {
    const u = await consented('spoof');
    const env3 = e();
    for (const body of [{ email: EXEMPT }, { isUnlimited: true }, { user: { email: EXEMPT } }]) {
      const r = await chat(u, { message: 'hi', ...body }, env3);
      expect(r.status, JSON.stringify(body)).toBe(400); // strict schema: unknown fields are refused outright
    }
    for (let i = 0; i < 10; i++) expect((await chat(u, { message: `s${i}` }, env3, { 'X-User-Email': EXEMPT, 'X-Unlimited': 'true', 'CF-Access-Authenticated-User-Email': EXEMPT })).status).toBe(200);
    const r = await chat(u, { message: 'eleventh' }, env3, { 'X-User-Email': EXEMPT });
    expect(r.status).toBe(429);
    expect((await quota(u, env3)).unlimited).toBe(false);
  });

  it('a look-alike address does not qualify (no gmail dot/plus canonicalisation), nor does an UNVERIFIED registration of the real address', async () => {
    const lookalike = await consented('lookalike');
    await setIdentity(lookalike, 'radwaghes@gmail.com', true);
    expect((await quota(lookalike, e())).unlimited).toBe(false);
    const plus = await consented('plus');
    await setIdentity(plus, 'radwa.ghes+x@gmail.com', true);
    expect((await quota(plus, e())).unlimited).toBe(false);
    // someone who simply signed up with the address and never verified it (no mail provider on staging) is a normal account
    const squatter = await consented('squatter');
    await setIdentity(squatter, EXEMPT, false);
    expect((await quota(squatter, e())).unlimited).toBe(false);
    for (let i = 0; i < 10; i++) await chat(squatter, { message: `q${i}` }, e());
    expect((await chat(squatter, { message: 'eleventh' }, e())).status).toBe(429);
    // …until the address is verified (e.g. the real owner signs in with Google)
    await setIdentity(squatter, EXEMPT, true);
    expect((await chat(squatter, { message: 'now exempt' }, e())).status).toBe(200);
  });

  it('is only a quota exemption: authentication, consent, the kill switch and the global ceilings still apply', async () => {
    const u = await signUp('exempt-limits');
    await setIdentity(u, 'exempt-limits@gharzetak.test', true);
    const ex = (over: Record<string, string> = {}) => qEnv({ AI_UNLIMITED_EMAILS: 'exempt-limits@gharzetak.test', ...over });
    expect((await send(null, 'POST', '/v1/ai/chat', { v: 1, lang: 'en', message: 'hi' }, ex())).status).toBe(401); // unauthenticated
    const noConsent = await chat(u, { message: 'hi' }, ex());
    expect([noConsent.status, await errCode(noConsent)]).toEqual([403, 'ai_consent_required']); // consent preserved
    expect((await send(u, 'PUT', '/v1/ai/consent', { version: 1 })).status).toBe(200);
    const off = await chat(u, { message: 'hi' }, ex({ AI_ENABLED: 'false' }));
    expect([off.status, await errCode(off)]).toEqual([503, 'ai_disabled']); // kill switch beats the exemption
    const burst = ex({ AI_BURST_UNITS_PER_MINUTE: '2' });
    expect((await chat(u, { message: 'a' }, burst)).status).toBe(200);
    expect((await chat(u, { message: 'b' }, burst)).status).toBe(200);
    expect(await errCode(await chat(u, { message: 'c' }, burst))).toBe('ai_rate_limited'); // burst limiter still applies
    const cap = ex({ AI_DAILY_REQUEST_CAP: '1' });
    expect((await chat(u, { message: 'g' }, cap)).status).toBe(429); // global cap (shared allocation) still applies
    // and it grants nothing administrative
    expect((await send(u, 'DELETE', '/v1/admin/users/someone-else', undefined, ex())).status).toBeGreaterThanOrEqual(401);
  });
});

describe('what is preserved', () => {
  it('the kill switch disables hosted AI for everyone and the consent gate precedes quota', async () => {
    const u = await signUp('kill');
    const off = await chat(u, { message: 'hi' }, qEnv({ AI_ENABLED: 'false' }));
    expect([off.status, await errCode(off)]).toEqual([503, 'ai_disabled']);
    const noConsent = await chat(u, { message: 'hi' });
    expect([noConsent.status, await errCode(noConsent)]).toEqual([403, 'ai_consent_required']);
    expect(await quota(await signInAgain(u))).toMatchObject({ chat: { used: 0 } });
  });

  it('a deployed environment without an allowlist is still deny-all; "*" opens it to every signed-in account (the test-build policy)', async () => {
    const u = await consented('policy');
    const prodLike = qEnv({ ENVIRONMENT: 'production', AI_PROVIDER: 'workers-ai' });
    expect(await (await send(u, 'GET', '/v1/ai/status', undefined, prodLike)).json()).toEqual({ v: 1, enabled: false });
    // staging-like with the test-build policy but no real binding stays disabled rather than faking replies
    const staging = qEnv({ ENVIRONMENT: 'staging', AI_PROVIDER: 'fake', AI_ALLOWED_USER_IDS: '*' });
    expect(await (await send(u, 'GET', '/v1/ai/status', undefined, staging)).json()).toEqual({ v: 1, enabled: false });
    const local = qEnv({ ENVIRONMENT: 'development', AI_ALLOWED_USER_IDS: '*' });
    expect(((await (await send(u, 'GET', '/v1/ai/status', undefined, local)).json()) as { enabled: boolean }).enabled).toBe(true);
  });

  it('non-AI endpoints are untouched by the quota tables', async () => {
    const u = await signUp('plain');
    expect((await send(u, 'GET', '/v1/profile')).status).toBeLessThan(500);
    expect((await call('/health')).status).toBeLessThan(500);
  });
});

export type _Unused = AppEnv;
