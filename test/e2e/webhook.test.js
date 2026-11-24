import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startTestServer } from '../helpers/app.js';
import { computeSignature } from '../../src/whatsapp/signature.js';

const fixture = (name) => readFileSync(new URL(`../fixtures/webhook/${name}.json`, import.meta.url), 'utf8');

async function post(baseUrl, raw, headers = {}) {
  return fetch(`${baseUrl}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: raw });
}

describe('webhook', () => {
  it('GET verifies with the right token and rejects otherwise', async () => {
    const s = await startTestServer({ META_VERIFY_TOKEN: 'tok' });
    try {
      const ok = await fetch(`${s.baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=tok&hub.challenge=12345`);
      assert.equal(ok.status, 200);
      assert.equal(await ok.text(), '12345');
      const bad = await fetch(`${s.baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`);
      assert.equal(bad.status, 403);
      const noMode = await fetch(`${s.baseUrl}/webhook?hub.verify_token=tok&hub.challenge=1`);
      assert.equal(noMode.status, 403);
    } finally {
      await s.close();
    }
  });

  it('POST with a valid signature is processed and replies via the outbox; an invalid one gets 401', async () => {
    const s = await startTestServer({ META_APP_SECRET: 'shh' });
    try {
      const raw = fixture('text');
      const bad = await post(s.baseUrl, raw, { 'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64) });
      assert.equal(bad.status, 401);
      const missing = await post(s.baseUrl, raw);
      assert.equal(missing.status, 401);
      assert.equal(s.container.whatsapp.outbox.length, 0);

      const good = await post(s.baseUrl, raw, { 'X-Hub-Signature-256': computeSignature(raw, 'shh') });
      assert.equal(good.status, 200);
      assert.deepEqual(await good.json(), { ok: true, processed: 1 });
      assert.ok(s.container.whatsapp.outbox.length >= 1);
    } finally {
      await s.close();
    }
  });

  it('a status-only payload returns 200 and processes nothing', async () => {
    const s = await startTestServer();
    try {
      const res = await post(s.baseUrl, fixture('status'));
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true, processed: 0 });
      assert.equal(s.container.whatsapp.outbox.length, 0);
    } finally {
      await s.close();
    }
  });

  it('a repeated delivery of the same message is answered once', async () => {
    const s = await startTestServer();
    try {
      const raw = fixture('text');
      await post(s.baseUrl, raw);
      const first = s.container.whatsapp.outbox.length;
      assert.ok(first >= 1);
      await post(s.baseUrl, raw);
      assert.equal(s.container.whatsapp.outbox.length, first);
    } finally {
      await s.close();
    }
  });

  it('answers 200 immediately and survives pipeline errors when WEBHOOK_AWAIT is off', async () => {
    const s = await startTestServer({ WEBHOOK_AWAIT: 'false' });
    try {
      s.container.pipeline.handleIncoming = async () => { throw new Error('background boom'); };
      const rejections = [];
      const onRej = (e) => rejections.push(e);
      process.on('unhandledRejection', onRej);
      const res = await post(s.baseUrl, fixture('text'));
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ok: true });
      await new Promise((r) => setTimeout(r, 50));
      process.off('unhandledRejection', onRej);
      assert.equal(rejections.length, 0);
    } finally {
      await s.close();
    }
  });

  it('rejects a malformed JSON body without crashing', async () => {
    const s = await startTestServer();
    try {
      const res = await post(s.baseUrl, '{not json');
      assert.equal(res.status, 400);
    } finally {
      await s.close();
    }
  });
});
