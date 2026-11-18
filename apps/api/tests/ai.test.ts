/**
 * Khayoota AI routes. Every test uses the offline FakeAiProvider (wrangler.jsonc has no AI binding): no real model is
 * ever called from automated tests.
 */
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import app from '../src/index';
import { FakeAiProvider, FAKE_TRIGGERS } from '../src/services/ai/provider';
import { reserveNeurons, settle } from '../src/services/ai/quota';
import { aiConfig } from '../src/services/ai/config';
import type { AppEnv } from '../src/env';
import { JPEG, ORIGIN, PNG, signUp, type TestUser } from './helpers';

type Env = typeof env;
const aiEnv = (over: Record<string, string> = {}): Env => ({ ...env, AI_ENABLED: 'true', AI_PROVIDER: 'fake', AI_VISION_ENABLED: 'true', AI_EXTRACT_ENABLED: 'true', ...over }) as Env;
const b64 = (u8: Uint8Array) => btoa(String.fromCharCode(...u8));
const jpeg = { mime: 'image/jpeg', data: b64(JPEG) };

const send = (u: TestUser | null, method: string, path: string, body?: unknown, e: Env = aiEnv()) =>
  app.request(
    path,
    {
      method,
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(u ? { Authorization: `Bearer ${u.token}` } : {}) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    },
    e,
  );
const chat = (u: TestUser, body: Record<string, unknown>, e?: Env) => send(u, 'POST', '/v1/ai/chat', { v: 1, lang: 'en', ...body }, e);
const consent = (u: TestUser, e?: Env) => send(u, 'PUT', '/v1/ai/consent', { version: 1 }, e);
const errCode = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;

const ctx = {
  v: 1,
  project: { id: 'prj_demo_bunny', name: 'Bunny', kind: 'collection' },
  part: { instanceId: 'inst_arm_2', name: 'Arm', index: 2, of: 2 },
  round: { n: 7, text: 'R7: 9sc [9]', declaredTotal: 9, calculatedTotal: 9, consumed: 9, mismatch: false, joins: [] },
  unfinishedParts: [{ instanceId: 'inst_arm_2', label: 'Arm 2/2' }],
};

async function consented(label = 'ai'): Promise<TestUser> {
  const u = await signUp(label);
  expect((await consent(u)).status).toBe(200);
  return u;
}

beforeEach(() => {
  FakeAiProvider.calls = 0;
});

describe('access', () => {
  it('requires a signed-in user on every AI route (guests never reach hosted AI)', async () => {
    for (const [m, p] of [['GET', '/v1/ai/status'], ['PUT', '/v1/ai/consent'], ['POST', '/v1/ai/chat'], ['POST', '/v1/ai/extract'], ['DELETE', '/v1/ai/consent']] as const) {
      expect((await send(null, m, p, m === 'GET' || m === 'DELETE' ? undefined : {})).status, `${m} ${p}`).toBe(401);
    }
    expect(FakeAiProvider.calls).toBe(0);
  });

  it('kill switch: AI_ENABLED != "true" disables everything but status', async () => {
    const u = await signUp('off');
    const off = aiEnv({ AI_ENABLED: 'false' });
    expect(await (await send(u, 'GET', '/v1/ai/status', undefined, off)).json()).toEqual({ v: 1, enabled: false });
    const r = await chat(u, { message: 'hi' }, off);
    expect(r.status).toBe(503);
    expect(await errCode(r)).toBe('ai_disabled');
  });

  it('workers-ai provider without an AI binding is treated as disabled, never as a crash', async () => {
    const u = await signUp('nobind');
    const r = await send(u, 'GET', '/v1/ai/status', undefined, aiEnv({ AI_PROVIDER: 'workers-ai' }));
    expect(await r.json()).toEqual({ v: 1, enabled: false });
  });
});

describe('consent', () => {
  it('chat is refused before consent, without calling the model', async () => {
    const u = await signUp('noconsent');
    const r = await chat(u, { message: 'hi' });
    expect(r.status).toBe(403);
    expect(await errCode(r)).toBe('ai_consent_required');
    expect(FakeAiProvider.calls).toBe(0);
  });

  it('accepts only the current version, reports it in status, and can be withdrawn', async () => {
    const u = await signUp('consent');
    expect((await send(u, 'PUT', '/v1/ai/consent', { version: 2 })).status).toBe(400);
    expect((await consent(u)).status).toBe(200);
    const st = (await (await send(u, 'GET', '/v1/ai/status')).json()) as { consent: { accepted: boolean }; provider: string; features: Record<string, boolean> };
    expect(st.consent.accepted).toBe(true);
    expect(st.provider).toBe('fake');
    expect(st.features).toEqual({ chat: true, vision: true, extract: true });
    expect((await send(u, 'DELETE', '/v1/ai/consent')).status).toBe(204);
    expect((await chat(u, { message: 'hi' })).status).toBe(403);
  });

  it('one account’s consent never applies to another account', async () => {
    await consented('a');
    const b = await signUp('b');
    expect((await chat(b, { message: 'hi' })).status).toBe(403);
  });
});

describe('chat', () => {
  it('returns a validated reply envelope and decrements the remaining count', async () => {
    const u = await consented('chat');
    const r = await chat(u, { message: 'What is a magic ring?' });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const body = (await r.json()) as { reply: { v: number; text: string; actions: unknown[]; degraded: boolean }; usage: { remaining: { chat: number } } };
    expect(body.reply).toMatchObject({ v: 1, degraded: false, actions: [] });
    expect(body.reply.text.length).toBeGreaterThan(0);
    expect(body.usage.remaining.chat).toBe(19);
  });

  it('uses the device-computed calculator facts (the parser counts, the model explains)', async () => {
    const u = await consented('calc');
    const calc = [{ expr: '(2sc, inc) x 6', normalized: 'R1: (2sc, inc) x 6', consumed: 18, produced: 24, declared: null, mismatch: false, status: 'validated' }];
    const body = (await (await chat(u, { message: 'what does (2sc, inc) x 6 make?', calc })).json()) as { reply: { text: string } };
    expect(body.reply.text).toContain('24');
  });

  it('project-aware: proposes only allowlisted actions whose ids come from the request context', async () => {
    const u = await consented('ctx');
    const body = (await (await chat(u, { message: `explain my round ${FAKE_TRIGGERS.unknownAction} ${FAKE_TRIGGERS.foreignId}`, context: ctx })).json()) as {
      reply: { actions: { id: string; payload: Record<string, string> }[]; citations: { roundN: number }[] };
    };
    expect(body.reply.actions).toEqual([{ id: 'tracker.openCurrentRound', v: 1, payload: { projectId: 'prj_demo_bunny', partInstanceId: 'inst_arm_2' } }]);
    expect(body.reply.citations).toEqual([{ roundN: 7, partName: 'Arm' }]);
  });

  it('invalid model JSON is repaired once; prose without JSON comes back as a degraded, action-free reply', async () => {
    const u = await consented('repair');
    const fixed = (await (await chat(u, { message: `x ${FAKE_TRIGGERS.badJson}` })).json()) as { reply: { degraded: boolean; text: string } };
    expect(fixed.reply).toMatchObject({ degraded: false, text: 'OK' });
    expect(FakeAiProvider.calls).toBe(2);
    const prose = (await (await chat(u, { message: `x ${FAKE_TRIGGERS.prose}` })).json()) as { reply: { degraded: boolean; actions: unknown[]; text: string } };
    expect(prose.reply).toMatchObject({ degraded: true, actions: [] });
  });

  it('maps provider failures to typed errors (free allocation, capacity with one bounded retry, timeout)', async () => {
    const u = await consented('fail');
    const q = await chat(u, { message: FAKE_TRIGGERS.quota });
    expect([q.status, await errCode(q)]).toEqual([429, 'ai_quota_exceeded']);
    FakeAiProvider.calls = 0;
    const cap = await chat(u, { message: FAKE_TRIGGERS.capacity });
    expect([cap.status, await errCode(cap)]).toEqual([503, 'ai_busy']);
    expect(FakeAiProvider.calls).toBe(2); // exactly one retry
    const t = await chat(u, { message: FAKE_TRIGGERS.timeout });
    expect([t.status, await errCode(t)]).toEqual([504, 'ai_timeout']);
  });

  it.each([
    ['message too long', { message: 'x'.repeat(2001) }],
    ['empty message without image', { message: '   ' }],
    ['unknown field (strict)', { message: 'hi', model: '@cf/other/model' }],
    ['three images', { message: 'hi', images: [jpeg, jpeg, jpeg] }],
    ['data: prefix instead of plain base64', { message: 'hi', images: [{ mime: 'image/jpeg', data: `data:image/jpeg;base64,${jpeg.data}` }] }],
    ['unsupported mime', { message: 'hi', images: [{ mime: 'image/gif', data: jpeg.data }] }],
    ['an oversized context field', { message: 'hi', context: { ...ctx, round: { ...ctx.round, text: 'y'.repeat(301) } } }],
    ['context with an unknown key', { message: 'hi', context: { ...ctx, email: 'someone@example.com' } }],
  ])('rejects %s before the model is called', async (_label, body) => {
    const u = await consented('val');
    const r = await chat(u, body);
    expect(r.status).toBe(400);
    expect(FakeAiProvider.calls).toBe(0);
  });

  it('photos: refused while the vision flag is off; wrong magic bytes are 415', async () => {
    const u = await consented('vision');
    const off = await chat(u, { message: 'look', images: [jpeg] }, aiEnv({ AI_VISION_ENABLED: 'false' }));
    expect([off.status, await errCode(off)]).toEqual([403, 'ai_feature_disabled']);
    const fakeJpeg = await chat(u, { message: 'look', images: [{ mime: 'image/jpeg', data: b64(PNG) }] });
    expect(fakeJpeg.status).toBe(415);
    const ok = (await (await chat(u, { message: 'why is this arm wider?', images: [jpeg], context: ctx })).json()) as { reply: { cannotConfirm: string[] }; usage: { remaining: { image: number } } };
    expect(ok.reply.cannotConfirm.length).toBeGreaterThan(0);
    expect(ok.usage.remaining.image).toBe(4);
    expect(FakeAiProvider.calls).toBe(1);
  });
});

describe('usage protection', () => {
  it('per-user daily cap', async () => {
    const e = aiEnv({ AI_USER_DAILY_CHAT: '2' });
    const u = await consented('cap');
    expect((await chat(u, { message: 'a' }, e)).status).toBe(200);
    expect((await chat(u, { message: 'b' }, e)).status).toBe(200);
    const r = await chat(u, { message: 'c' }, e);
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ error: { code: 'ai_quota_exceeded' }, scope: 'user', kind: 'chat' });
  });

  it('global request cap across accounts', async () => {
    const a = await consented('ga');
    const e = aiEnv({ AI_DAILY_REQUEST_CAP: String((await globalRequests()) + 1) });
    const b = await consented('gb');
    expect((await chat(a, { message: 'a' }, e)).status).toBe(200);
    const r = await chat(b, { message: 'b' }, e);
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ scope: 'global' });
  });

  it('global Neuron budget: a request whose upper bound does not fit never reaches the model', async () => {
    const u = await consented('budget');
    const r = await chat(u, { message: 'hi' }, aiEnv({ AI_DAILY_NEURON_BUDGET: '1' }));
    expect(r.status).toBe(429);
    expect(FakeAiProvider.calls).toBe(0);
  });

  it('burst window (weighted units per minute)', async () => {
    const e = aiEnv({ AI_BURST_UNITS_PER_MINUTE: '2' });
    const u = await consented('burst');
    expect((await chat(u, { message: 'a' }, e)).status).toBe(200);
    expect((await chat(u, { message: 'b' }, e)).status).toBe(200);
    const r = await chat(u, { message: 'c' }, e);
    expect([r.status, await errCode(r)]).toEqual([429, 'ai_rate_limited']);
    // a photo costs 3 units: refused outright under a 2-unit window
    const u2 = await consented('burst2');
    expect((await chat(u2, { message: 'p', images: [jpeg] }, e)).status).toBe(429);
  });

  it('concurrent requests can never exceed the cap (conditional upserts)', async () => {
    const e = aiEnv({ AI_USER_DAILY_CHAT: '3' });
    const u = await consented('race');
    const res = await Promise.all(Array.from({ length: 6 }, (_, i) => chat(u, { message: `q${i}` }, e)));
    expect(res.filter((r) => r.status === 200)).toHaveLength(3);
    expect(res.filter((r) => r.status === 429)).toHaveLength(3);
  });

  it('usage is kept per account: another account starts with its own full allowance', async () => {
    const a = await consented('ia');
    const b = await consented('ib');
    await chat(a, { message: 'x' });
    await chat(a, { message: 'y' });
    const sb = (await (await send(b, 'GET', '/v1/ai/status')).json()) as { remaining: { chat: number } };
    expect(sb.remaining.chat).toBe(20);
    const sa = (await (await send(a, 'GET', '/v1/ai/status')).json()) as { remaining: { chat: number } };
    expect(sa.remaining.chat).toBe(18);
  });
});

describe('staging readiness', () => {
  it('a deployed environment never serves the fake provider: missing or "fake" AI_PROVIDER means disabled', async () => {
    const u = await consented('nofake');
    for (const e of [aiEnv({ ENVIRONMENT: 'staging' }), aiEnv({ ENVIRONMENT: 'production', AI_PROVIDER: '' }), aiEnv({ ENVIRONMENT: 'staging', AI_PROVIDER: 'workers-ai' })]) {
      expect(await (await send(u, 'GET', '/v1/ai/status', undefined, e)).json()).toEqual({ v: 1, enabled: false });
      const r = await chat(u, { message: 'hi' }, e);
      expect([r.status, await errCode(r)]).toEqual([503, 'ai_disabled']);
    }
    expect(FakeAiProvider.calls).toBe(0);
  });

  it('with photos off, an oversized chat body is refused before it is parsed', async () => {
    const u = await consented('bigbody');
    const r = await chat(u, { message: 'hi', images: [{ mime: 'image/jpeg', data: '/9j/' + 'A'.repeat(80_000) }] }, aiEnv({ AI_VISION_ENABLED: 'false' }));
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: { message: 'Request body too large' } });
    expect(FakeAiProvider.calls).toBe(0);
  });

  it('with extraction off, the extract body is never read (flag checked first)', async () => {
    const u = await consented('extoff');
    const r = await send(u, 'POST', '/v1/ai/extract', '{not json', aiEnv({ AI_EXTRACT_ENABLED: 'false' }));
    expect([r.status, await errCode(r)]).toEqual([403, 'ai_feature_disabled']);
  });

  it('settling records usage ABOVE the reservation, so the budget is never under-counted', async () => {
    const day = '2001-01-01';
    expect(await reserveNeurons(env.DB, 1000, day, 10)).toBe(true);
    await settle(env.DB, 'settle-user', day, 10, 25, 100, 50);
    const g = await env.DB.prepare("SELECT neurons_reserved, neurons_used FROM ai_usage_daily WHERE scope = '__all__' AND day = ?").bind(day).first<{ neurons_reserved: number; neurons_used: number }>();
    expect(g).toEqual({ neurons_reserved: 25, neurons_used: 25 });
    await settle(env.DB, 'settle-user', day, 0, null, 0, 0); // no usage reported for a zero reservation → nothing added
    expect(await reserveNeurons(env.DB, 30, day, 6)).toBe(false); // 25 + 6 > 30
  });

  it('allowlist: deployed environments are fail-closed; only listed accounts reach the model', async () => {
    const inside = await consented('allow-in');
    const outside = await consented('allow-out');
    const stagingFake = (ids?: string) => aiEnv({ ENVIRONMENT: 'development', ...(ids === undefined ? {} : { AI_ALLOWED_USER_IDS: ids }) });
    // development default: everyone
    expect((await chat(outside, { message: 'a' }, stagingFake())).status).toBe(200);
    // explicit list: only that account
    const listed = stagingFake(`  ${inside.id} , someone-else `);
    expect((await chat(inside, { message: 'b' }, listed)).status).toBe(200);
    const denied = await chat(outside, { message: 'c' }, listed);
    expect([denied.status, await errCode(denied)]).toEqual([503, 'ai_disabled']);
    expect(await (await send(outside, 'GET', '/v1/ai/status', undefined, listed)).json()).toEqual({ v: 1, enabled: false });
    expect(FakeAiProvider.calls).toBe(2);
  });

  it('allowlist parsing: empty means nobody outside dev/test, "*" means everyone', () => {
    expect(aiConfig({ ...env, ENVIRONMENT: 'staging', AI_ALLOWED_USER_IDS: '' } as unknown as AppEnv).allowedUsers).toEqual([]);
    expect(aiConfig({ ...env, ENVIRONMENT: 'production' } as unknown as AppEnv).allowedUsers).toEqual([]);
    expect(aiConfig({ ...env, ENVIRONMENT: 'staging', AI_ALLOWED_USER_IDS: '*' } as unknown as AppEnv).allowedUsers).toBe('*');
    expect(aiConfig({ ...env, ENVIRONMENT: 'staging', AI_ALLOWED_USER_IDS: 'a, b,,' } as unknown as AppEnv).allowedUsers).toEqual(['a', 'b']);
    expect(aiConfig({ ...env, ENVIRONMENT: 'development' } as unknown as AppEnv).allowedUsers).toBe('*');
  });

  it('signing out ends hosted AI for that session immediately', async () => {
    const u = await consented('signout');
    expect((await chat(u, { message: 'a' })).status).toBe(200);
    const out = await app.request('/api/auth/sign-out', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Authorization: `Bearer ${u.token}` }, body: '{}' }, aiEnv());
    expect(out.status).toBe(200);
    expect((await chat(u, { message: 'b' })).status).toBe(401);
    expect(FakeAiProvider.calls).toBe(1);
  });
});

async function globalRequests(): Promise<number> {
  const row = await env.DB.prepare("SELECT requests FROM ai_usage_daily WHERE scope = '__all__' AND day = ?").bind(new Date().toISOString().slice(0, 10)).first<{ requests: number }>();
  return row?.requests ?? 0;
}

describe('extract', () => {
  it('is refused while the extraction flag is off', async () => {
    const u = await consented('xoff');
    const r = await send(u, 'POST', '/v1/ai/extract', { v: 1, lang: 'en', images: [jpeg] }, aiEnv({ AI_EXTRACT_ENABLED: 'false' }));
    expect([r.status, await errCode(r)]).toEqual([403, 'ai_feature_disabled']);
  });

  it('returns a faithful transcript only — no stitch maths, no validity claims', async () => {
    const u = await consented('xon');
    const r = await send(u, 'POST', '/v1/ai/extract', { v: 1, lang: 'en', text: 'Ball\nR1: 6 sc in MR (6)\nR2: inc x 6 (12)' });
    expect(r.status).toBe(200);
    const { transcript } = (await r.json()) as { transcript: Record<string, unknown> & { lines: Record<string, unknown>[] } };
    expect(transcript).toMatchObject({ schema: 'gz.pattern-transcript', v: 1, sourceClass: 'written' });
    expect(transcript.lines.map((l) => l['text'])).toEqual(['Ball', 'R1: 6 sc in MR (6)', 'R2: inc x 6 (12)']);
    for (const l of transcript.lines) expect(Object.keys(l).sort()).toEqual(['kind', 'legibility', 'page', 'text', 'uncertain']);
    expect(JSON.stringify(transcript)).not.toMatch(/validated|calculated|total/i);
  });
});

describe('privacy: nothing sensitive reaches the logs', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs only operational metadata for chat, photo and extraction requests', async () => {
    const lines: string[] = [];
    for (const m of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(' ')));
    const u = await consented('logs');
    const secret = 'SECRET-PATTERN-TEXT-7781';
    const imgData = b64(JPEG);
    await chat(u, { message: `${secret} why?`, context: { ...ctx, round: { ...ctx.round, text: `R7: ${secret}` } }, images: [jpeg] });
    await chat(u, { message: `${secret} ${FAKE_TRIGGERS.badJson}` });
    await chat(u, { message: `${secret} ${FAKE_TRIGGERS.timeout}` });
    await send(u, 'POST', '/v1/ai/extract', { v: 1, lang: 'en', text: `R1: ${secret}` });
    const all = lines.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(all).not.toContain(secret);
    expect(all).not.toContain(imgData);
    expect(all).not.toContain(u.token);
    expect(all).not.toContain(u.email);
    expect(all).not.toContain('prj_demo_bunny');
  });
});
