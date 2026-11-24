import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockStt } from '../../src/stt/mock.js';
import { createOpenAiStt } from '../../src/stt/openai.js';
import { createStt } from '../../src/stt/index.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fakeFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const next = queue.shift();
    if (!next) throw new Error('unexpected extra fetch call');
    return next;
  };
  fn.calls = calls;
  return fn;
}

test('mock: mockTranscript wins', async () => {
  const stt = createMockStt();
  const result = await stt.transcribe({ buffer: Buffer.from('ignored'), mockTranscript: '  aaj 5000 ki sale hui ' });
  assert.deepEqual(result, { text: 'aaj 5000 ki sale hui', language: null, provider: 'mock' });
});

test('mock: reads the sidecar .txt next to sourcePath', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stt-mock-'));
  try {
    await writeFile(join(dir, 'sale.ogg'), 'OggS-fake-audio');
    await writeFile(join(dir, 'sale.txt'), '  aaj 5000 ki sale hui\n');
    const result = await createMockStt().transcribe({
      buffer: Buffer.from('OggS-fake-audio'),
      sourcePath: join(dir, 'sale.ogg'),
    });
    assert.equal(result.text, 'aaj 5000 ki sale hui');
    assert.equal(result.provider, 'mock');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mock: accepts a buffer that starts with TRANSCRIPT:', async () => {
  const result = await createMockStt().transcribe({ buffer: Buffer.from('TRANSCRIPT:kal ka hisaab', 'utf8') });
  assert.equal(result.text, 'kal ka hisaab');
});

test('mock: throws STT_NO_TRANSCRIPT otherwise', async () => {
  await assert.rejects(createMockStt().transcribe({ buffer: Buffer.from('OggS-fake-audio') }), /STT_NO_TRANSCRIPT/);
  await assert.rejects(createMockStt().transcribe({}), /STT_NO_TRANSCRIPT/);
});

test('openai: posts multipart form with auth and maps language urdu to ur', async () => {
  const fetchImpl = fakeFetch([jsonResponse({ text: ' aaj 5000 ki sale hui ', language: 'urdu' })]);
  const stt = createOpenAiStt({ apiKey: 'sk-test', fetchImpl });

  const result = await stt.transcribe({ buffer: Buffer.from('OggS'), mimeType: 'audio/ogg; codecs=opus' });

  assert.deepEqual(result, { text: 'aaj 5000 ki sale hui', language: 'ur', provider: 'openai' });
  assert.equal(fetchImpl.calls.length, 1);
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer sk-test');

  const form = init.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get('model'), 'whisper-1');
  assert.equal(form.get('response_format'), 'verbose_json');
  assert.match(form.get('prompt'), /hazar/);
  assert.equal(form.get('language'), null);
  const file = form.get('file');
  assert.equal(file.type, 'audio/ogg; codecs=opus');
  assert.equal(file.name, 'audio.ogg');
});

test('openai: upload extension follows the mime type, and non-whisper models use json', async () => {
  const fetchImpl = fakeFetch([jsonResponse({ text: 'hello' })]);
  const stt = createOpenAiStt({ apiKey: 'k', model: 'gpt-4o-transcribe', fetchImpl });
  await stt.transcribe({ buffer: Buffer.from('x'), mimeType: 'audio/mp4' });
  const form = fetchImpl.calls[0].init.body;
  assert.equal(form.get('response_format'), 'json');
  assert.equal(form.get('file').name, 'audio.m4a');
});

test('openai: a configured language is sent as the language field', async () => {
  const fetchImpl = fakeFetch([jsonResponse({ text: 'hello', language: 'english' })]);
  const stt = createOpenAiStt({ apiKey: 'k', language: 'en', fetchImpl });
  const result = await stt.transcribe({ buffer: Buffer.from('x') });
  assert.equal(fetchImpl.calls[0].init.body.get('language'), 'en');
  assert.equal(result.language, 'en');
});

test('openai: Devanagari output triggers one retry with language=ur', async () => {
  const fetchImpl = fakeFetch([
    jsonResponse({ text: 'नमस्ते पाँच हज़ार', language: 'hindi' }),
    jsonResponse({ text: 'پانچ ہزار کی سیل' }),
  ]);
  const stt = createOpenAiStt({ apiKey: 'k', fetchImpl });

  const result = await stt.transcribe({ buffer: Buffer.from('x') });

  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(fetchImpl.calls[0].init.body.get('language'), null);
  assert.equal(fetchImpl.calls[1].init.body.get('language'), 'ur');
  assert.equal(result.text, 'پانچ ہزار کی سیل');
  assert.equal(result.language, 'ur');
});

test('openai: no retry when the language is configured or text is not Devanagari', async () => {
  const configured = fakeFetch([jsonResponse({ text: 'नमस्ते' })]);
  await createOpenAiStt({ apiKey: 'k', language: 'hi', fetchImpl: configured }).transcribe({ buffer: Buffer.from('x') });
  assert.equal(configured.calls.length, 1);

  const plain = fakeFetch([jsonResponse({ text: 'salam' })]);
  await createOpenAiStt({ apiKey: 'k', fetchImpl: plain }).transcribe({ buffer: Buffer.from('x') });
  assert.equal(plain.calls.length, 1);
});

test('openai: non-2xx throws STT_HTTP_<status>', async () => {
  const fetchImpl = fakeFetch([jsonResponse({ error: 'nope' }, 429)]);
  const stt = createOpenAiStt({ apiKey: 'k', fetchImpl });
  await assert.rejects(stt.transcribe({ buffer: Buffer.from('x') }), /STT_HTTP_429/);
});

test('createStt selects the provider from config', () => {
  assert.equal(createStt({ provider: 'mock' }).name, 'mock');
  assert.equal(createStt({ provider: 'openai', apiKey: 'k', model: 'whisper-1', language: '', baseUrl: 'https://api.openai.com/v1' }).name, 'openai');
  assert.throws(() => createStt({ provider: 'nope' }), /Unknown STT provider/);
});

test('openai provider works against Groq (OpenAI-compatible): path, model and json response', async () => {
  // Groq serves Whisper at <base>/audio/transcriptions and accepts json, verbose_json and text.
  // Its json response has no `language` field, so the language stays null unless the retry forces Urdu.
  const fetchImpl = fakeFetch([jsonResponse({ text: ' aaj 5000 ki sale hui ', x_groq: { id: 'req_1' } })]);
  const stt = createOpenAiStt({
    apiKey: 'gsk-test',
    model: 'whisper-large-v3-turbo',
    language: 'ur',
    baseUrl: 'https://api.groq.com/openai/v1',
    fetchImpl,
  });

  const result = await stt.transcribe({ buffer: Buffer.from('OggS'), mimeType: 'audio/ogg' });

  assert.deepEqual(result, { text: 'aaj 5000 ki sale hui', language: null, provider: 'openai' });
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, 'https://api.groq.com/openai/v1/audio/transcriptions');
  assert.equal(init.headers.Authorization, 'Bearer gsk-test');
  const form = init.body;
  assert.equal(form.get('model'), 'whisper-large-v3-turbo');
  assert.equal(form.get('response_format'), 'json');
  assert.equal(form.get('language'), 'ur');
  assert.equal(form.get('file').name, 'audio.ogg');
});

test('createStt: openai provider with a Groq base URL keeps the Groq endpoint', async () => {
  const fetchImpl = fakeFetch([jsonResponse({ text: 'hello' })]);
  const stt = createStt(
    { provider: 'openai', apiKey: 'gsk', model: 'whisper-large-v3-turbo', language: '', baseUrl: 'https://api.groq.com/openai/v1' },
    { fetchImpl },
  );
  await stt.transcribe({ buffer: Buffer.from('x') });
  assert.equal(fetchImpl.calls[0].url, 'https://api.groq.com/openai/v1/audio/transcriptions');
});
