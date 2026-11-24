import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWhisperLocalStt } from '../../src/stt/whisper-local.js';
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
    if (next instanceof Error) throw next;
    if (!next) throw new Error('unexpected extra fetch call');
    return next;
  };
  fn.calls = calls;
  return fn;
}

test('posts multipart form to <url>/inference and returns the openai-compatible shape', async () => {
  const fetchImpl = fakeFetch([jsonResponse({ text: ' aaj 5000 ki sale hui ' })]);
  const stt = createWhisperLocalStt({ url: 'http://127.0.0.1:8080', fetchImpl });

  const result = await stt.transcribe({ buffer: Buffer.from('OggS'), mimeType: 'audio/ogg; codecs=opus' });

  assert.deepEqual(result, { text: 'aaj 5000 ki sale hui', language: null, provider: 'whisper-local' });
  assert.equal(stt.name, 'whisper-local');
  assert.equal(fetchImpl.calls.length, 1);
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, 'http://127.0.0.1:8080/inference');
  assert.equal(init.method, 'POST');
  assert.ok(init.signal instanceof AbortSignal);

  const form = init.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get('response_format'), 'json');
  assert.equal(form.get('temperature'), '0');
  assert.equal(form.get('language'), 'auto');
  const file = form.get('file');
  assert.equal(file.type, 'audio/ogg; codecs=opus');
  assert.equal(file.name, 'audio.ogg');
});

test('trailing slashes on the url are ignored', async () => {
  const fetchImpl = fakeFetch([jsonResponse({ text: 'hello' })]);
  await createWhisperLocalStt({ url: 'http://localhost:8080//', fetchImpl }).transcribe({ buffer: Buffer.from('x') });
  assert.equal(fetchImpl.calls[0].url, 'http://localhost:8080/inference');
});

test('upload extension follows the mime type', async () => {
  const fetchImpl = fakeFetch([jsonResponse({ text: 'hello' })]);
  await createWhisperLocalStt({ fetchImpl }).transcribe({ buffer: Buffer.from('x'), mimeType: 'audio/mp4', filename: 'note.bin' });
  assert.equal(fetchImpl.calls[0].init.body.get('file').name, 'note.m4a');
});

test('a configured language is sent as the language field and mapped in the result', async () => {
  const fetchImpl = fakeFetch([jsonResponse({ text: 'hello', language: 'english' })]);
  const result = await createWhisperLocalStt({ language: 'en', fetchImpl }).transcribe({ buffer: Buffer.from('x') });
  assert.equal(fetchImpl.calls[0].init.body.get('language'), 'en');
  assert.equal(result.language, 'en');
});

test('a response language name is mapped (urdu -> ur)', async () => {
  const fetchImpl = fakeFetch([jsonResponse({ text: 'salam', language: 'urdu' })]);
  const result = await createWhisperLocalStt({ fetchImpl }).transcribe({ buffer: Buffer.from('x') });
  assert.equal(result.language, 'ur');
});

test('Devanagari output triggers one retry forced to ur when no language is configured', async () => {
  const fetchImpl = fakeFetch([
    jsonResponse({ text: 'नमस्ते पाँच हज़ार', language: 'hindi' }),
    jsonResponse({ text: 'پانچ ہزار کی سیل' }),
  ]);
  const result = await createWhisperLocalStt({ fetchImpl }).transcribe({ buffer: Buffer.from('x') });

  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(fetchImpl.calls[0].init.body.get('language'), 'auto');
  assert.equal(fetchImpl.calls[1].init.body.get('language'), 'ur');
  assert.equal(result.text, 'پانچ ہزار کی سیل');
  assert.equal(result.language, 'ur');
});

test('no retry when the language is configured', async () => {
  const fetchImpl = fakeFetch([jsonResponse({ text: 'नमस्ते' })]);
  await createWhisperLocalStt({ language: 'hi', fetchImpl }).transcribe({ buffer: Buffer.from('x') });
  assert.equal(fetchImpl.calls.length, 1);
});

test('an unreachable server throws STT_LOCAL_UNREACHABLE', async () => {
  const fetchImpl = fakeFetch([new TypeError('fetch failed')]);
  await assert.rejects(
    createWhisperLocalStt({ fetchImpl }).transcribe({ buffer: Buffer.from('x') }),
    /STT_LOCAL_UNREACHABLE/,
  );
});

test('a timeout throws STT_LOCAL_TIMEOUT', async () => {
  const err = new Error('The operation was aborted due to timeout');
  err.name = 'TimeoutError';
  const fetchImpl = fakeFetch([err]);
  await assert.rejects(createWhisperLocalStt({ fetchImpl }).transcribe({ buffer: Buffer.from('x') }), /STT_LOCAL_TIMEOUT/);
});

test('non-2xx throws STT_LOCAL_HTTP_<status>', async () => {
  const fetchImpl = fakeFetch([new Response('boom', { status: 500 })]);
  await assert.rejects(createWhisperLocalStt({ fetchImpl }).transcribe({ buffer: Buffer.from('x') }), /STT_LOCAL_HTTP_500/);
});

test('a missing url is rejected at construction', () => {
  assert.throws(() => createWhisperLocalStt({ url: '' }), /STT_LOCAL_NO_URL/);
});

test('createStt selects whisper-local and passes localUrl and language', async () => {
  const fetchImpl = fakeFetch([jsonResponse({ text: 'hello' })]);
  const stt = createStt(
    { provider: 'whisper-local', localUrl: 'http://127.0.0.1:9999', language: 'ur', apiKey: '' },
    { fetchImpl },
  );
  assert.equal(stt.name, 'whisper-local');
  const result = await stt.transcribe({ buffer: Buffer.from('x') });
  assert.equal(result.provider, 'whisper-local');
  assert.equal(fetchImpl.calls[0].url, 'http://127.0.0.1:9999/inference');
  assert.equal(fetchImpl.calls[0].init.body.get('language'), 'ur');
});
