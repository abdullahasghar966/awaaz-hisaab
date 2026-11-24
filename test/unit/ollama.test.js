import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaParser, buildMessages } from '../../src/nlp/ollama.js';
import { createNlp } from '../../src/nlp/index.js';
import { LLM_OUTPUT_SCHEMA } from '../../src/nlp/schema.js';

const ctx = { today: '2026-11-24', knownContacts: ['Ahmed', 'Bilal'], knownStaff: ['Ali'] };

const SALE = {
  intent: 'record_sale', language: 'roman-ur', confidence: 0.93, amount: 5000, quantity: null, unit: null, item: null,
  contactName: null, paymentMode: 'cash', category: null, staffName: null, staffPhone: null, taskDescription: null,
  dueDate: null, taskRef: null, period: null, note: null,
};

function fakeFetch(responder) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return responder(url, init);
  };
  fn.calls = calls;
  return fn;
}
const okJson = (obj) => ({ ok: true, status: 200, json: async () => ({ message: { role: 'assistant', content: JSON.stringify(obj) } }) });

test('request body targets /api/chat with schema, stream false, temperature 0', async () => {
  const f = fakeFetch(() => okJson(SALE));
  const p = createOllamaParser({ url: 'http://host:11434/', model: 'qwen2.5:7b', timeoutMs: 5000, fetchImpl: f });
  await p.parse('aaj 5000 ka maal becha', ctx);
  const { url, body, init } = f.calls[0];
  assert.equal(url, 'http://host:11434/api/chat');
  assert.equal(init.method, 'POST');
  assert.equal(body.model, 'qwen2.5:7b');
  assert.equal(body.stream, false);
  assert.deepEqual(body.format, LLM_OUTPUT_SCHEMA);
  assert.equal(body.options.temperature, 0);
  assert.equal(body.messages[0].role, 'system');
  const last = body.messages.at(-1);
  assert.equal(last.role, 'user');
  assert.match(last.content, /Today: 2026-11-24/);
  assert.match(last.content, /Known contacts: Ahmed, Bilal/);
  assert.match(last.content, /aaj 5000 ka maal becha/);
  assert.ok(body.messages.length >= 9, 'few-shot examples included');
  assert.ok(init.signal, 'timeout signal set');
});

test('successful sale parse', async () => {
  const p = createOllamaParser({ fetchImpl: fakeFetch(() => okJson(SALE)) });
  const r = await p.parse('aaj 5000 ka maal becha', ctx);
  assert.equal(r.intent, 'record_sale');
  assert.equal(r.entities.amount, 5000);
  assert.equal(r.entities.paymentMode, 'cash');
  assert.equal(r.entities.contactName, null);
  assert.equal(r.language, 'roman-ur');
  assert.equal(r.provider, 'llm');
});

test('Urdu-script entities and string amounts are normalised', async () => {
  const obj = { ...SALE, intent: 'credit_given', language: 'ur', amount: '2000', contactName: 'احمد', paymentMode: 'credit' };
  const p = createOllamaParser({ fetchImpl: fakeFetch(() => okJson(obj)) });
  const r = await p.parse('احمد کو دو ہزار ادھار دیا', ctx);
  assert.equal(r.intent, 'credit_given');
  assert.equal(r.entities.amount, 2000);
  assert.equal(r.entities.contactName, 'احمد');
  assert.equal(r.language, 'ur');
});

test('invalid JSON throws', async () => {
  const f = fakeFetch(() => ({ ok: true, status: 200, json: async () => ({ message: { content: 'not json {' } }) }));
  await assert.rejects(createOllamaParser({ fetchImpl: f }).parse('x', ctx), /OLLAMA_INVALID_JSON/);
});

test('non-2xx throws', async () => {
  const f = fakeFetch(() => ({ ok: false, status: 500, text: async () => 'boom' }));
  await assert.rejects(createOllamaParser({ fetchImpl: f }).parse('x', ctx), /OLLAMA_HTTP_500/);
});

test('network failure throws', async () => {
  const f = fakeFetch(() => { throw new Error('ECONNREFUSED'); });
  await assert.rejects(createOllamaParser({ fetchImpl: f }).parse('x', ctx), /OLLAMA_UNREACHABLE.*ECONNREFUSED/);
});

test('createNlp ollama falls back to rules when fetch fails', async () => {
  const f = fakeFetch(() => { throw new Error('down'); });
  const nlp = createNlp({ provider: 'ollama', ollamaUrl: 'http://x:1' }, { fetchImpl: f });
  assert.equal(nlp.providerName, 'ollama');
  const r = await nlp.parse('aaj 5000 ka maal becha', ctx);
  assert.equal(f.calls.length, 1);
  assert.equal(r.fallback, true);
  assert.notEqual(r.provider, 'llm');
});

test('createNlp ollama uses ollama result on success', async () => {
  const f = fakeFetch(() => okJson(SALE));
  const nlp = createNlp({ provider: 'ollama', ollamaModel: 'llama3.2' }, { fetchImpl: f });
  const r = await nlp.parse('kuch bhi aaj ka sauda', ctx);
  assert.equal(r.intent, 'record_sale');
  assert.equal(f.calls[0].body.model, 'llama3.2');
});

test('createNlp ollama quickMatch "haan" never calls fetch', async () => {
  const f = fakeFetch(() => { throw new Error('should not be called'); });
  const nlp = createNlp({ provider: 'ollama' }, { fetchImpl: f });
  const r = await nlp.parse('haan', ctx);
  assert.equal(r.intent, 'confirm');
  assert.equal(f.calls.length, 0);
});

test('memory options default to num_ctx 2048, temperature 0 and keep_alive 10m', async () => {
  const f = fakeFetch(() => okJson(SALE));
  await createOllamaParser({ fetchImpl: f }).parse('aaj 5000 ka maal becha', ctx);
  const { body } = f.calls[0];
  assert.equal(body.model, 'qwen2.5:3b');
  assert.equal(body.keep_alive, '10m');
  assert.deepEqual(body.options, { temperature: 0, num_ctx: 2048 });
});

test('numCtx and keepAlive are sent as given', async () => {
  const f = fakeFetch(() => okJson(SALE));
  await createOllamaParser({ numCtx: 4096, keepAlive: '0', fetchImpl: f }).parse('haan ji 5000', ctx);
  assert.equal(f.calls[0].body.options.num_ctx, 4096);
  assert.equal(f.calls[0].body.keep_alive, '0');
});

test('system prompt plus few-shots plus the message fit in a 2048-token window (about 4 chars per token)', () => {
  const messages = buildMessages('aaj 5000 ka maal becha aur Ahmed ko 2000 udhaar diya', {
    today: '2026-11-24', knownContacts: ['Ahmed', 'Bilal', 'Kamran'], knownStaff: ['Ali', 'Kamran'],
  });
  const chars = messages.reduce((n, m) => n + [...m.content].length, 0);
  // Reply is a schema-constrained JSON object of about 300 characters.
  const estimatedTokens = Math.ceil(chars / 4) + 100;
  assert.ok(estimatedTokens <= 2048, `estimated ${estimatedTokens} tokens`);
});
