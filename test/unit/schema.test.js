import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTENTS, WRITE_INTENTS, LANGUAGES, ENTITY_FIELDS, INTENT_REQUIRED, LLM_OUTPUT_SCHEMA,
  emptyEntities, normalizeIntentResult, validateIntent,
} from '../../src/nlp/schema.js';

test('constants', () => {
  assert.equal(INTENTS.length, 19);
  assert.equal(WRITE_INTENTS.length, 11);
  assert.deepEqual(LANGUAGES, ['ur', 'roman-ur', 'pa', 'ps', 'sd', 'en']);
  assert.equal(ENTITY_FIELDS.length, 14);
  assert.deepEqual(INTENT_REQUIRED.assign_task, ['staffName', 'taskDescription']);
  assert.deepEqual(LLM_OUTPUT_SCHEMA.properties.intent.enum, INTENTS);
  assert.equal(LLM_OUTPUT_SCHEMA.required.length, 17);
});

test('emptyEntities has every field null', () => {
  const e = emptyEntities();
  assert.deepEqual(Object.keys(e), ENTITY_FIELDS);
  assert.ok(Object.values(e).every((v) => v === null));
});

test('normalizeIntentResult coerces a flat LLM object', () => {
  const r = normalizeIntentResult({
    intent: 'record_sale', language: 'roman-ur', confidence: 1.7, amount: '5000', quantity: 0, unit: ' bori ',
    item: '', contactName: ' Ahmed ', paymentMode: 'CREDIT', staffPhone: '0300-1234567', dueDate: '2026-11-25',
    taskRef: 3, period: 'decade',
  }, 'llm');
  assert.equal(r.intent, 'record_sale');
  assert.equal(r.provider, 'llm');
  assert.equal(r.confidence, 1);
  assert.equal(r.language, 'roman-ur');
  assert.equal(r.entities.amount, 5000);
  assert.equal(r.entities.quantity, null);
  assert.equal(r.entities.unit, 'bori');
  assert.equal(r.entities.item, null);
  assert.equal(r.entities.contactName, 'Ahmed');
  assert.equal(r.entities.paymentMode, 'credit');
  assert.equal(r.entities.staffPhone, '923001234567');
  assert.equal(r.entities.dueDate, '2026-11-25');
  assert.equal(r.entities.taskRef, 3);
  assert.equal(r.entities.period, null);
});

test('normalizeIntentResult handles nested entities, bad values and unknown intents', () => {
  const r = normalizeIntentResult({
    intent: 'fly_to_moon', confidence: 'abc', entities: { amount: -5, dueDate: 'tomorrow', taskRef: 2.5 },
  }, 'rules');
  assert.equal(r.intent, 'unknown');
  assert.equal(r.confidence, 0.5);
  assert.equal(r.language, null);
  assert.equal(r.entities.amount, null);
  assert.equal(r.entities.dueDate, null);
  assert.equal(r.entities.taskRef, null);
  assert.equal(normalizeIntentResult({ intent: 'help', confidence: -2, amount: NaN }, 'x').confidence, 0);
  assert.equal(normalizeIntentResult(null, 'x').intent, 'unknown');
});

test('validateIntent reports missing fields', () => {
  const v = (intent, entities) => validateIntent(normalizeIntentResult({ intent, ...entities }, 'rules'));
  assert.deepEqual(v('record_sale', { amount: 100 }), { ok: true, missing: [] });
  assert.deepEqual(v('record_sale', {}), { ok: false, missing: ['amount'] });
  assert.deepEqual(v('payment_received', { amount: 5 }), { ok: false, missing: ['contactName'] });
  assert.deepEqual(v('assign_task', { staffName: 'Ali' }), { ok: false, missing: ['taskDescription'] });
  assert.deepEqual(v('contact_balance', {}), { ok: false, missing: ['contactName'] });
  assert.deepEqual(v('daily_summary', {}), { ok: true, missing: [] });
});

test('credit sale without contact is missing contactName', () => {
  assert.deepEqual(
    validateIntent(normalizeIntentResult({ intent: 'record_sale', amount: 8000, paymentMode: 'credit' }, 'rules')),
    { ok: false, missing: ['contactName'] },
  );
  assert.deepEqual(
    validateIntent(normalizeIntentResult({ intent: 'record_purchase', amount: 8000, paymentMode: 'credit' }, 'rules')),
    { ok: false, missing: ['contactName'] },
  );
});

test('add_staff requires a valid Pakistani mobile', () => {
  const bad = normalizeIntentResult({ intent: 'add_staff', staffName: 'Kamran', staffPhone: '1234567890' }, 'rules');
  assert.deepEqual(validateIntent(bad), { ok: false, missing: ['staffPhone'] });
  const none = normalizeIntentResult({ intent: 'add_staff', staffName: 'Kamran' }, 'rules');
  assert.deepEqual(validateIntent(none), { ok: false, missing: ['staffPhone'] });
  const good = normalizeIntentResult({ intent: 'add_staff', staffName: 'Kamran', staffPhone: '03001234567' }, 'rules');
  assert.deepEqual(validateIntent(good), { ok: true, missing: [] });
});
