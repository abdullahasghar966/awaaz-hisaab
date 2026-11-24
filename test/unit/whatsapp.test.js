import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWhatsAppClient } from '../../src/whatsapp/client.js';

const META = {
  provider: 'meta',
  accessToken: 'TEST_TOKEN',
  phoneNumberId: '111222333',
  graphVersion: 'v21.0',
  graphBaseUrl: 'https://graph.example.test',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  fn.calls = calls;
  return fn;
}

test('meta sendText posts the Graph message body with bearer auth', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse({ messages: [{ id: 'wamid.OUT1' }] }));
  const client = createWhatsAppClient(META, { fetchImpl });

  const result = await client.sendText('923001234567', 'Assalam o Alaikum');

  assert.deepEqual(result, { ok: true, messageId: 'wamid.OUT1' });
  const [call] = fetchImpl.calls;
  assert.equal(call.url, 'https://graph.example.test/v21.0/111222333/messages');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, 'Bearer TEST_TOKEN');
  assert.deepEqual(JSON.parse(call.init.body), {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '923001234567',
    type: 'text',
    text: { preview_url: false, body: 'Assalam o Alaikum' },
  });
});

test('meta sendText truncates bodies longer than 4000 characters', async () => {
  const fetchImpl = fakeFetch(() => jsonResponse({ messages: [{ id: 'wamid.OUT2' }] }));
  const client = createWhatsAppClient(META, { fetchImpl });

  await client.sendText('923001234567', 'x'.repeat(5000));

  const sent = JSON.parse(fetchImpl.calls[0].init.body).text.body;
  assert.equal(sent.length, 3991);
  assert.equal(sent.slice(0, 3990), 'x'.repeat(3990));
  assert.equal(sent.at(-1), '…');
});

test('meta sendText failure returns ok:false instead of throwing', async () => {
  const httpFail = createWhatsAppClient(META, {
    fetchImpl: fakeFetch(() => jsonResponse({ error: { message: 'bad token' } }, 401)),
  });
  assert.deepEqual(await httpFail.sendText('923001234567', 'hi'), {
    ok: false,
    messageId: null,
    error: 'WA_HTTP_401',
  });

  const networkFail = createWhatsAppClient(META, {
    fetchImpl: async () => {
      throw new Error('socket hang up');
    },
  });
  const result = await networkFail.sendText('923001234567', 'hi');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'socket hang up');
});

test('meta downloadMedia makes two requests: metadata, then the file', async () => {
  const fetchImpl = fakeFetch((url) => {
    if (url === 'https://graph.example.test/v21.0/MEDIA_1') {
      return jsonResponse({ url: 'https://cdn.example.test/file/MEDIA_1', mime_type: 'audio/ogg' });
    }
    return new Response(Buffer.from('OggS-fake-audio'), { status: 200 });
  });
  const client = createWhatsAppClient(META, { fetchImpl });

  const media = await client.downloadMedia('MEDIA_1');

  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(fetchImpl.calls[0].url, 'https://graph.example.test/v21.0/MEDIA_1');
  assert.equal(fetchImpl.calls[1].url, 'https://cdn.example.test/file/MEDIA_1');
  assert.equal(fetchImpl.calls[0].init.headers.Authorization, 'Bearer TEST_TOKEN');
  assert.equal(fetchImpl.calls[1].init.headers.Authorization, 'Bearer TEST_TOKEN');
  assert.equal(media.mimeType, 'audio/ogg');
  assert.equal(media.buffer.toString('utf8'), 'OggS-fake-audio');
});

test('meta client refuses to start without credentials', () => {
  assert.throws(() => createWhatsAppClient({ ...META, accessToken: '' }, { fetchImpl: fakeFetch(() => null) }));
});

test('mock client records sends in the outbox and resets in place', async () => {
  const client = createWhatsAppClient({ provider: 'mock' });
  const outbox = client.outbox;

  const first = await client.sendText('923001234567', 'one');
  const second = await client.sendText('923001234567', 'two');

  assert.equal(first.ok, true);
  assert.equal(first.messageId, 'mock-1');
  assert.equal(second.messageId, 'mock-2');
  assert.deepEqual(outbox.map((m) => m.body), ['one', 'two']);
  assert.equal(outbox[0].to, '923001234567');
  assert.equal(typeof outbox[0].at, 'string');

  client.reset();
  assert.equal(client.outbox, outbox);
  assert.equal(outbox.length, 0);
});

test('mock downloadMedia returns registered media and throws for unknown ids', async () => {
  const client = createWhatsAppClient({ provider: 'mock' });
  client.registerMedia('M1', {
    buffer: Buffer.from('OggS-fake-audio'),
    mimeType: 'audio/ogg',
    mockTranscript: 'aaj 5000 ki sale hui',
  });

  const media = await client.downloadMedia('M1');
  assert.equal(media.buffer.toString('utf8'), 'OggS-fake-audio');
  assert.equal(media.mimeType, 'audio/ogg');
  assert.equal(media.mockTranscript, 'aaj 5000 ki sale hui');

  await assert.rejects(client.downloadMedia('missing'), /MEDIA_NOT_FOUND/);
});
