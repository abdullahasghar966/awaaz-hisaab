import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/db.js';
import { fixedClock } from '../helpers/clock.js';
import { createServices } from '../../src/domain/index.js';

function setup() {
  const db = createTestDb();
  const svc = createServices(db, { clock: fixedClock(), timezone: 'Asia/Karachi' });
  return { db, ...svc };
}

test('duplicate waMessageId yields duplicate:true with the same id', () => {
  const { messages, db } = setup();
  const a = messages.recordInbound({ waMessageId: 'wamid.1', phone: '923001234567', msgType: 'text', body: 'hi' });
  assert.equal(a.duplicate, false);
  const b = messages.recordInbound({ waMessageId: 'wamid.1', phone: '923001234567', msgType: 'text', body: 'hi' });
  assert.equal(b.duplicate, true);
  assert.equal(b.id, a.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 1);
  const c = messages.recordInbound({ waMessageId: 'wamid.2', phone: '923001234567', msgType: 'audio', mediaId: 'm1' });
  assert.equal(c.duplicate, false);
  assert.notEqual(c.id, a.id);
});

test('null waMessageId is never a duplicate', () => {
  const { messages } = setup();
  const a = messages.recordInbound({ phone: '923001234567', msgType: 'text' });
  const b = messages.recordInbound({ phone: '923001234567', msgType: 'text' });
  assert.equal(b.duplicate, false);
  assert.notEqual(a.id, b.id);
});

test('updateInbound only changes provided keys', () => {
  const { messages, businesses } = setup();
  const o = businesses.registerOwner({ phone: '923001234567' });
  const { id } = messages.recordInbound({ waMessageId: 'w1', phone: '923001234567', msgType: 'audio', mediaId: 'm' });
  messages.updateInbound(id, { transcript: 'aaj 5000 ki sale', language: 'roman-ur' });
  let row = messages.list({})[0];
  assert.equal(row.transcript, 'aaj 5000 ki sale');
  assert.equal(row.status, 'received');
  assert.equal(row.businessId, null);
  messages.updateInbound(id, { businessId: o.businessId, intent: 'record_sale', intentJson: { intent: 'record_sale' }, status: 'processed' });
  row = messages.list({})[0];
  assert.equal(row.businessId, o.businessId);
  assert.equal(row.transcript, 'aaj 5000 ki sale');
  assert.equal(row.intentJson, '{"intent":"record_sale"}');
  assert.equal(row.status, 'processed');
  messages.updateInbound(id, {});
  messages.updateInbound(id, { error: 'boom', status: 'error' });
  assert.equal(messages.list({})[0].error, 'boom');
});

test('outbound logging and list filtering, newest first', () => {
  const { messages, businesses } = setup();
  const o1 = businesses.registerOwner({ phone: '923001111111' });
  const o2 = businesses.registerOwner({ phone: '923002222222' });
  const inId = messages.recordInbound({ waMessageId: 'w1', phone: '923001111111', msgType: 'text', body: 'x', businessId: o1.businessId }).id;
  const outId = messages.recordOutbound({ phone: '923001111111', body: 'reply', businessId: o1.businessId, status: 'sent', inReplyTo: inId, waMessageId: 'out1' });
  messages.recordOutbound({ phone: '923002222222', body: 'other', businessId: o2.businessId, status: 'failed', error: 'x' });
  const list1 = messages.list({ businessId: o1.businessId });
  assert.deepEqual(list1.map((m) => m.id), [outId, inId]);
  assert.equal(list1[0].direction, 'out');
  assert.equal(list1[0].inReplyTo, inId);
  assert.equal(list1[0].waMessageId, 'out1');
  assert.equal(list1[0].status, 'sent');
  assert.equal(messages.list({ businessId: o2.businessId })[0].error, 'x');
  assert.equal(messages.list({}).length, 3);
  assert.equal(messages.list({ limit: 2 }).length, 2);
  assert.equal(list1[1].createdAt, '2026-11-24T05:00:00.000Z');
});
