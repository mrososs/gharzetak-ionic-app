import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { HTML, JPEG, PDF, PNG, bytes, call, authed, createProject, json, signUp, uuid } from './helpers';

const enc = encodeURIComponent;
const get = (u: Parameters<typeof json>[0], key: string, extra: Record<string, string> = {}) => call(`/v1/media/object?key=${enc(key)}`, { headers: authed(u, extra) });

async function uploadPhoto(u: Awaited<ReturnType<typeof signUp>>, projectId: string, data: Uint8Array = JPEG, type = 'image/jpeg') {
  const photoId = uuid();
  const res = await bytes(u, `/v1/media/project-photos/${projectId}/${photoId}`, data, type);
  return { photoId, res, body: res.status === 201 ? ((await res.json()) as { key: string; mime: string; size: number }) : null };
}

describe('R2 private project photos', () => {
  it('uploads, registers, and downloads for the owner with private headers', async () => {
    const u = await signUp('photo');
    const pid = await createProject(u);
    const { body } = await uploadPhoto(u, pid);
    expect(body).toMatchObject({ mime: 'image/jpeg', size: JPEG.byteLength });
    expect(body!.key.startsWith(`${u.id}/${pid}/`)).toBe(true);

    const stored = await env.MEDIA.get(body!.key);
    expect(stored?.size).toBe(JPEG.byteLength);
    expect(await env.DB.prepare('SELECT mime_type, size_bytes FROM project_photos WHERE storage_path = ?').bind(body!.key).first()).toEqual({ mime_type: 'image/jpeg', size_bytes: JPEG.byteLength });

    const dl = await get(u, body!.key);
    expect(dl.status).toBe(200);
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(JPEG);
    expect(dl.headers.get('content-type')).toBe('image/jpeg');
    expect(dl.headers.get('cache-control')).toContain('private');
    expect(dl.headers.get('x-content-type-options')).toBe('nosniff');
    expect(dl.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(dl.headers.get('etag')).toBeTruthy();
  });

  it('supports conditional requests (If-None-Match -> 304)', async () => {
    const u = await signUp('etag');
    const { body } = await uploadPhoto(u, await createProject(u));
    const first = await get(u, body!.key);
    const etag = first.headers.get('etag')!;
    await first.arrayBuffer();
    const again = await get(u, body!.key, { 'If-None-Match': etag });
    expect(again.status).toBe(304);
  });

  it('is invisible to other users and to anonymous callers (same 404 as a missing file)', async () => {
    const a = await signUp('o');
    const b = await signUp('x');
    const { body } = await uploadPhoto(a, await createProject(a));
    expect((await get(b, body!.key)).status).toBe(404);
    expect((await get(a, `${a.id}/${uuid()}/missing.jpg`)).status).toBe(404);
    expect((await get(null, body!.key)).status).toBe(401);
    // B cannot delete it either, and the object survives
    expect((await call(`/v1/media/object?key=${enc(body!.key)}`, { method: 'DELETE', headers: authed(b) })).status).toBe(204);
    expect(await env.MEDIA.head(body!.key)).not.toBeNull();
    // B cannot upload into A's project
    const pidA = (await env.DB.prepare('SELECT id FROM projects WHERE owner_id = ?').bind(a.id).first<{ id: string }>())!.id;
    expect((await uploadPhoto(b, pidA)).res.status).toBe(404);
  });

  it('rejects path traversal and crafted keys', async () => {
    const u = await signUp('trav');
    const other = await signUp('victim');
    const { body } = await uploadPhoto(other, await createProject(other));
    for (const key of [`../${body!.key}`, `${u.id}/../${body!.key}`, `/${body!.key}`, '', 'a'.repeat(400)]) {
      const r = await get(u, key);
      expect([400, 404]).toContain(r.status);
    }
    expect((await call('/v1/media/object', { headers: authed(u) })).status).toBe(400); // missing key
  });

  it('validates real file type, declared type, and size', async () => {
    const u = await signUp('val');
    const pid = await createProject(u);
    expect((await uploadPhoto(u, pid, HTML, 'image/jpeg')).res.status).toBe(415); // HTML pretending to be a JPEG
    expect((await uploadPhoto(u, pid, PDF, 'application/pdf')).res.status).toBe(415); // PDFs are not allowed as photos
    expect((await uploadPhoto(u, pid, PNG, 'image/jpeg')).res.status).toBe(415); // declared type contradicts contents
    expect((await uploadPhoto(u, pid, PNG, 'image/png')).res.status).toBe(201);
    expect((await uploadPhoto(u, pid, JPEG, 'application/octet-stream')).res.status).toBe(201); // octet-stream defers to the sniffed type
    const empty = await bytes(u, `/v1/media/project-photos/${pid}/${uuid()}`, new Uint8Array(0), 'image/jpeg');
    expect(empty.status).toBe(400);
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set(JPEG);
    const tooBig = await uploadPhoto(u, pid, big);
    expect(tooBig.res.status).toBe(413);
    const exact = new Uint8Array(8 * 1024 * 1024);
    exact.set(JPEG);
    expect((await uploadPhoto(u, pid, exact)).res.status).toBe(201);
    // nothing leaked into R2 for rejected uploads
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM media_objects WHERE user_id = ?').bind(u.id).first<{ n: number }>();
    const listed = await env.MEDIA.list({ prefix: `${u.id}/` });
    expect(listed.objects.length).toBe(rows!.n);
  });

  it('rejects unauthenticated uploads before reading the body', async () => {
    const u = await signUp('noauth');
    const pid = await createProject(u);
    const res = await bytes(null, `/v1/media/project-photos/${pid}/${uuid()}`, JPEG, 'image/jpeg');
    expect(res.status).toBe(401);
  });

  it('deletes the object, its registry row and photo row; deletion is idempotent', async () => {
    const u = await signUp('delphoto');
    const { body } = await uploadPhoto(u, await createProject(u));
    const del = await call(`/v1/media/object?key=${enc(body!.key)}`, { method: 'DELETE', headers: authed(u) });
    expect(del.status).toBe(204);
    expect(await env.MEDIA.head(body!.key)).toBeNull();
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM project_photos WHERE storage_path = ?').bind(body!.key).first()).toEqual({ n: 0 });
    expect((await get(u, body!.key)).status).toBe(404);
    expect((await call(`/v1/media/object?key=${enc(body!.key)}`, { method: 'DELETE', headers: authed(u) })).status).toBe(204);
  });

  it('pull exposes photo storage paths for the owner only', async () => {
    const a = await signUp('pa');
    const b = await signUp('pb');
    const pid = await createProject(a);
    const { body } = await uploadPhoto(a, pid);
    const pa = (await (await json(a, 'GET', '/v1/sync/pull')).json()) as { photos: { storagePath: string }[] };
    const pb = (await (await json(b, 'GET', '/v1/sync/pull')).json()) as { photos: unknown[] };
    expect(pa.photos.map((p) => p.storagePath)).toEqual([body!.key]);
    expect(pb.photos).toHaveLength(0);
  });
});

describe('R2 covers and project deletion', () => {
  it('sets the cover, replaces it, and removes the superseded object', async () => {
    const u = await signUp('cover');
    const pid = await createProject(u);
    const put = () => bytes(u, `/v1/media/project-covers/${pid}`, JPEG, 'image/jpeg');
    const first = (await (await put()).json()) as { key: string };
    const second = (await (await put()).json()) as { key: string };
    expect(second.key).not.toBe(first.key);
    expect(await env.MEDIA.head(first.key)).toBeNull();
    expect(await env.MEDIA.head(second.key)).not.toBeNull();
    const row = await env.DB.prepare('SELECT cover_path FROM projects WHERE id = ?').bind(pid).first<{ cover_path: string }>();
    expect(row?.cover_path).toBe(second.key);
    // a client PUT of the project cannot overwrite the server-managed cover path
    const res = await json(u, 'PUT', `/v1/projects/${pid}`, { baseRevision: 1, clientUpdatedAt: Date.now(), name: 'x', category: 'home', hookSize: '3', yarnType: 'wool', status: 'active', patternId: null, estimatedHours: 1, workedSeconds: 0, lastWorkedAt: 1, createdAt: 1, coverPath: 'victim/secret.jpg' });
    expect(res.status).toBe(200);
    expect((await env.DB.prepare('SELECT cover_path FROM projects WHERE id = ?').bind(pid).first<{ cover_path: string }>())?.cover_path).toBe(second.key);
  });

  it('deleting a project removes every R2 object it owned', async () => {
    const u = await signUp('wipe');
    const pid = await createProject(u);
    const p1 = await uploadPhoto(u, pid);
    const cover = (await (await bytes(u, `/v1/media/project-covers/${pid}`, PNG, 'image/png')).json()) as { key: string };
    expect((await json(u, 'DELETE', `/v1/projects/${pid}`)).status).toBe(204);
    expect(await env.MEDIA.head(p1.body!.key)).toBeNull();
    expect(await env.MEDIA.head(cover.key)).toBeNull();
    expect((await env.MEDIA.list({ prefix: `${u.id}/` })).objects).toHaveLength(0);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM media_objects WHERE user_id = ?').bind(u.id).first()).toEqual({ n: 0 });
  });
});

describe('R2 pattern files', () => {
  const pattern = (over: Record<string, unknown> = {}) => ({
    baseRevision: 0, clientUpdatedAt: Date.now(), name: 'PDF pattern', level: 'beginner', terms: 'us', sourceType: 'pdf', sourceUrl: null, attribution: null, rawText: 'R1: 6sc [6]', readingPosition: 0, rounds: [], ...over,
  });

  it('uploads a PDF for an owned pattern and records its metadata', async () => {
    const u = await signUp('pdf');
    const id = uuid();
    expect((await json(u, 'PUT', `/v1/patterns/${id}`, pattern())).status).toBe(201);
    const res = await bytes(u, `/v1/media/pattern-files/${id}`, PDF, 'application/pdf', { 'X-File-Name': 'bunny.pdf' });
    expect(res.status).toBe(201);
    const { key } = (await res.json()) as { key: string };
    expect(key).toBe(`${u.id}/${id}/source.pdf`);
    expect(await env.DB.prepare('SELECT file_path, file_name, file_mime, file_size FROM patterns WHERE id = ?').bind(id).first()).toEqual({ file_path: key, file_name: 'bunny.pdf', file_mime: 'application/pdf', file_size: PDF.byteLength });
    const dl = await get(u, key);
    expect(dl.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(PDF);
  });

  it('refuses unknown patterns, other users patterns, HTML, and files over 10 MiB', async () => {
    const a = await signUp('pa2');
    const b = await signUp('pb2');
    const id = uuid();
    await json(a, 'PUT', `/v1/patterns/${id}`, pattern());
    expect((await bytes(a, `/v1/media/pattern-files/${uuid()}`, PDF, 'application/pdf')).status).toBe(404);
    expect((await bytes(b, `/v1/media/pattern-files/${id}`, PDF, 'application/pdf')).status).toBe(404);
    expect((await bytes(a, `/v1/media/pattern-files/${id}`, HTML, 'text/html')).status).toBe(415);
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PDF);
    expect((await bytes(a, `/v1/media/pattern-files/${id}`, big, 'application/pdf')).status).toBe(413);
    // sanitised file name
    const ok = await bytes(a, `/v1/media/pattern-files/${id}`, PDF, 'application/pdf', { 'X-File-Name': '../../etc/passwd' });
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as { name: string }).name).not.toContain('/');
  });

  it('deleting the pattern removes its file from R2', async () => {
    const u = await signUp('patdel');
    const id = uuid();
    await json(u, 'PUT', `/v1/patterns/${id}`, pattern());
    const { key } = (await (await bytes(u, `/v1/media/pattern-files/${id}`, PDF, 'application/pdf')).json()) as { key: string };
    expect((await json(u, 'DELETE', `/v1/patterns/${id}`)).status).toBe(204);
    expect(await env.MEDIA.head(key)).toBeNull();
  });
});

describe('the bucket is only reachable through the API', () => {
  it('has no public route that serves objects', async () => {
    const u = await signUp('pub');
    const { body } = await uploadPhoto(u, await createProject(u));
    for (const path of [`/${body!.key}`, `/media/${body!.key}`, `/v1/media/${body!.key}`, `/files/${body!.key}`]) {
      const r = await call(path);
      expect([401, 404]).toContain(r.status);
    }
  });
});
