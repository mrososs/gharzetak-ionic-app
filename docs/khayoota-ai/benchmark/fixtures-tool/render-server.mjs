#!/usr/bin/env node
// Local-only helper that renders SYNTHETIC benchmark fixtures in a real browser (proper Arabic shaping) and saves them
// into benchmark/fixtures/ (git-ignored). Binds to 127.0.0.1 only. Nothing here is real handwriting or photography.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures');
const PORT = Number(process.env.PORT || 4317);
const NAME_RE = /^[A-Z]{2,5}-\d{2}[a-z]?(?:\.synthetic)?\.(?:png|jpg)$/;

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(join(HERE, 'render.html')));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/cases.json') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(readFileSync(join(HERE, '..', 'cases.json')));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/save') {
    const name = url.searchParams.get('name') ?? '';
    if (!NAME_RE.test(name)) return void res.writeHead(400).end('bad name');
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 2_000_000) req.destroy();
      else chunks.push(c);
    });
    req.on('end', () => {
      writeFileSync(join(FIXTURES, name), Buffer.concat(chunks));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ saved: name, bytes: size }));
    });
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, '127.0.0.1', () => console.log(`fixture renderer on http://127.0.0.1:${PORT}`));
