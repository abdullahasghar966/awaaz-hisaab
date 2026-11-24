import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_PROMPT, buildUserMessage, createLlmParser } from '../../src/nlp/llm.js';
import { createNlp } from '../../src/nlp/index.js';
import { LLM_OUTPUT_SCHEMA } from '../../src/nlp/schema.js';

const ctx = { today: '2026-11-24', knownContacts: ['Ahmed', 'Bilal'], knownStaff: ['Ali'] };

const FLAT = {
  intent: 'record_sale', language: 'roman-ur', confidence: 0.93, amount: 5000, quantity: null, unit: null, item: null,
  contactName: null, paymentMode: 'cash', category: null, staffName: null, staffPhone: null, taskDescription: null,
  dueDate: null, taskRef: null, period: null, note: null,
};

function fakeClient(responder) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params, opts) => {
        calls.push({ params, opts });
        return responder(params, opts);
      },
    },
  };
}
const okResponse = (obj) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }] });

test('buildUserMessage format', () => {
  assert.equal(
    buildUserMessage('aaj 5000 ki sale hui', ctx),
    'Today: 2026-11-24 (Asia/Karachi)\nKnown contacts: Ahmed, Bilal\nKnown staff: Ali\nMessage: """aaj 5000 ki sale hui"""',
  );
  const empty = buildUserMessage('x', { today: '2026-11-24', knownContacts: [], knownStaff: [] });
  assert.match(empty, /Known contacts: none\nKnown staff: none/);
});

test('parse returns a normalized result and sends the right request', async () => {
  const client = fakeClient(() => okResponse(FLAT));
  const parser = createLlmParser({ apiKey: 'k', client, timeoutMs: 1234 });
  const r = await parser.parse('aaj 5000 ki sale hui', ctx);
  assert.equal(parser.name, 'llm');
  assert.equal(r.intent, 'record_sale');
  assert.equal(r.provider, 'llm');
  assert.equal(r.entities.amount, 5000);
  assert.equal(r.entities.paymentMode, 'cash');
  assert.equal(r.language, 'roman-ur');

  const { params, opts } = client.calls[0];
  assert.equal(params.model, 'claude-haiku-5-5');
  assert.equal(params.max_tokens, 1024);
  assert.equal(params.system, SYSTEM_PROMPT);
  assert.equal(params.output_config.format.type, 'json_schema');
  assert.equal(params.output_config.format.schema, LLM_OUTPUT_SCHEMA);
  assert.equal(params.output_config.effort, 'low');
  assert.equal('temperature' in params, false);
  assert.equal('thinking' in params, false);
  assert.equal('tool_choice' in params, false);
  assert.equal(params.messages.length, 1);
  assert.equal(params.messages[0].role, 'user');
  assert.match(params.messages[0].content, /Message: """aaj 5000 ki sale hui"""/);
  assert.deepEqual(opts, { timeout: 1234 });
});

test('custom model is passed through', async () => {
  const client = fakeClient(() => okResponse(FLAT));
  await createLlmParser({ client, model: 'my-model' }).parse('x', ctx);
  assert.equal(client.calls[0].params.model, 'my-model');
});

test('refusal, max_tokens and missing text throw', async () => {
  for (const stop of ['refusal', 'max_tokens']) {
    const client = fakeClient(() => ({ stop_reason: stop, content: [] }));
    await assert.rejects(createLlmParser({ client }).parse('x', ctx), new RegExp(`LLM_${stop}`));
  }
  const client = fakeClient(() => ({ stop_reason: 'end_turn', content: [{ type: 'thinking' }] }));
  await assert.rejects(createLlmParser({ client }).parse('x', ctx), /LLM_NO_TEXT/);
});

test('createNlp falls back to rules when the client throws', async () => {
  const client = fakeClient(() => { throw new Error('network down'); });
  const warnings = [];
  const nlp = createNlp({ provider: 'auto', apiKey: 'k' }, { client, logger: { warn: (m, o) => warnings.push([m, o]) } });
  assert.equal(nlp.providerName, 'llm');
  const r = await nlp.parse('aaj 5000 ki sale hui', ctx);
  assert.equal(r.intent, 'record_sale');
  assert.equal(r.provider, 'rules');
  assert.equal(r.fallback, true);
  assert.equal(warnings.length, 1);
});

test('quickMatch "haan" never calls the client', async () => {
  const client = fakeClient(() => okResponse(FLAT));
  const nlp = createNlp({ provider: 'auto', apiKey: 'k' }, { client });
  const r = await nlp.parse('haan', ctx);
  assert.equal(r.intent, 'confirm');
  assert.equal(r.provider, 'quick');
  assert.equal(client.calls.length, 0);
});

test('provider rules or auto without key never uses the client', async () => {
  const client = fakeClient(() => okResponse(FLAT));
  const a = createNlp({ provider: 'rules', apiKey: 'k' }, { client: null });
  const b = createNlp({ provider: 'auto', apiKey: '' });
  assert.equal(a.providerName, 'rules');
  assert.equal(b.providerName, 'rules');
  assert.equal((await b.parse('aaj 5000 ki sale hui', ctx)).provider, 'rules');
  assert.equal(client.calls.length, 0);
});

test('LLM result is returned when it is confident', async () => {
  const client = fakeClient(() => okResponse(FLAT));
  const nlp = createNlp({ provider: 'llm', apiKey: 'k' }, { client });
  const r = await nlp.parse('aaj 5000 ki sale hui', ctx);
  assert.equal(r.provider, 'llm');
  assert.equal(r.fallback, undefined);
});

test('low-confidence LLM unknown is overridden by a confident rules match', async () => {
  const client = fakeClient(() => okResponse({ ...FLAT, intent: 'unknown', confidence: 0.2, amount: null }));
  const nlp = createNlp({ provider: 'auto', apiKey: 'k' }, { client });
  const r = await nlp.parse('aaj 5000 ki sale hui', ctx);
  assert.equal(r.intent, 'record_sale');
  assert.equal(r.provider, 'rules');
  const still = await nlp.parse('mausam kaisa hai', ctx);
  assert.equal(still.intent, 'unknown');
  assert.equal(still.provider, 'llm');
});
