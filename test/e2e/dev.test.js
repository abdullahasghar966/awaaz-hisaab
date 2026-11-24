import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, startTestServer } from '../helpers/app.js';

describe('dev routes', () => {
  it('simulates a text message in dry-run mode (nothing reaches the outbox)', async () => {
    const s = await startTestServer();
    try {
      const { status, body } = await simulate(s.baseUrl, { from: '0300-1112222', text: 'aaj 5000 ki sale hui' });
      assert.equal(status, 200);
      assert.equal(body.intent, 'record_sale');
      assert.ok(body.replies.some((r) => r.key === 'sale_recorded'));
      const outbox = await (await fetch(`${s.baseUrl}/dev/outbox`)).json();
      assert.deepEqual(outbox, []);
    } finally {
      await s.close();
    }
  });

  it('transcribes audioPath fixtures through the sidecar .txt', async () => {
    const s = await startTestServer();
    try {
      const { status, body } = await simulate(s.baseUrl, { from: '923001112222', audioPath: 'sale.ogg' });
      assert.equal(status, 200);
      assert.equal(body.transcript, 'aaj 5000 ki sale hui');
      assert.equal(body.intent, 'record_sale');
    } finally {
      await s.close();
    }
  });

  it('accepts audioBase64 with a TRANSCRIPT: payload and a transcript override', async () => {
    const s = await startTestServer();
    try {
      const b64 = Buffer.from('TRANSCRIPT:aaj 300 ki sale hui').toString('base64');
      const a = await simulate(s.baseUrl, { from: '923001112222', audioBase64: b64, mimeType: 'audio/webm' });
      assert.equal(a.body.transcript, 'aaj 300 ki sale hui');
      const b = await simulate(s.baseUrl, {
        from: '923001112222', audioBase64: Buffer.from('zz').toString('base64'), transcript: 'aaj 200 ki sale hui',
      });
      assert.equal(b.body.transcript, 'aaj 200 ki sale hui');
    } finally {
      await s.close();
    }
  });

  it('rejects path traversal, absolute paths, missing files and bad input with 400', async () => {
    const s = await startTestServer();
    try {
      for (const audioPath of ['../../package.json', '../webhook/text.json', 'nope.ogg']) {
        const r = await simulate(s.baseUrl, { from: '923001112222', audioPath });
        assert.equal(r.status, 400, audioPath);
      }
      assert.equal((await simulate(s.baseUrl, { from: '923001112222', audioPath: process.cwd() + '/package.json' })).status, 400);
      assert.equal((await simulate(s.baseUrl, { from: 'abc', text: 'hi' })).status, 400);
      assert.equal((await simulate(s.baseUrl, { from: '923001112222' })).status, 400);
    } finally {
      await s.close();
    }
  });

  it('is deduplicated by messageId', async () => {
    const s = await startTestServer();
    try {
      await simulate(s.baseUrl, { from: '923001112222', text: 'aaj 100 ki sale hui', messageId: 'dup-1' });
      const again = await simulate(s.baseUrl, { from: '923001112222', text: 'aaj 100 ki sale hui', messageId: 'dup-1' });
      assert.equal(again.body.status, 'duplicate');
    } finally {
      await s.close();
    }
  });

  it('serves the simulator page and /health', async () => {
    const s = await startTestServer();
    try {
      assert.equal((await fetch(`${s.baseUrl}/dev/simulator.html`)).status, 200);
      const health = await (await fetch(`${s.baseUrl}/health`)).json();
      assert.deepEqual(health, { ok: true, providers: { whatsapp: 'mock', stt: 'mock', nlp: 'rules' } });
    } finally {
      await s.close();
    }
  });

  it('is disabled (404) when DEV_ROUTES=false', async () => {
    const s = await startTestServer({ DEV_ROUTES: 'false' });
    try {
      const r = await simulate(s.baseUrl, { from: '923001112222', text: 'help' }).catch((e) => e);
      assert.equal(r.status === 404 || r instanceof Error, true);
      const res = await fetch(`${s.baseUrl}/dev/simulator.html`);
      assert.equal(res.status, 404);
      assert.equal((await fetch(`${s.baseUrl}/dev/outbox`)).status, 404);
    } finally {
      await s.close();
    }
  });
});
