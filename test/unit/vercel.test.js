import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Environment the serverless entry sees: no VERCEL/NODE_ENV leftovers, no real .env values, a temp DB.
const CLEARED = /^(VERCEL|NODE_ENV|DB_PATH|ADMIN_TOKEN|DEV_ROUTES|WEBHOOK_AWAIT|META_|OPENAI_|ANTHROPIC_|NLP_|STT_|OLLAMA_|WHATSAPP_)/;
const savedEnv = {};
let server;
let baseUrl;
let app;

before(async () => {
  for (const key of Object.keys(process.env)) {
    if (CLEARED.test(key)) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  }
  process.env.NODE_ENV = 'test';
  process.env.ADMIN_TOKEN = 'vercel-test-token';
  process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'awaaz-vercel-')), 'app.db');

  // Imported after the env is set, because api/index.js builds its config at import time.
  ({ default: app } = await import('../../api/index.js'));

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const key of Object.keys(process.env)) {
    if (CLEARED.test(key)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

test('api/index.js default-exports a request handler (the Express app)', () => {
  assert.equal(typeof app, 'function');
});

test('GET /health works through the serverless entry', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.providers.whatsapp, 'mock');
});

test('the admin API requires the bearer token on Vercel-style deployments', async () => {
  const denied = await fetch(`${baseUrl}/api/admin/businesses`);
  assert.equal(denied.status, 401);
  const allowed = await fetch(`${baseUrl}/api/admin/businesses`, {
    headers: { authorization: 'Bearer vercel-test-token' },
  });
  assert.equal(allowed.status, 200);
});

test('static dashboard files are served through the rewrite', async () => {
  const res = await fetch(`${baseUrl}/admin/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<html/i);
});

test('vercel.json rewrites every path to /api/index and bundles public and the schema', () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  assert.deepEqual(cfg.rewrites, [{ source: '/(.*)', destination: '/api/index' }]);
  const fn = cfg.functions['api/index.js'];
  assert.ok(fn, 'function entry for api/index.js');
  assert.match(fn.includeFiles, /public/);
  assert.match(fn.includeFiles, /src\/db\/schema\.sql/);
  assert.equal(fn.maxDuration, 60);
  assert.ok(existsSync(join(ROOT, 'api', 'index.js')));
});
