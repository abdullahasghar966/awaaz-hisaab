import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/db.js';
import { fixedClock } from '../helpers/clock.js';
import { createServices } from '../../src/domain/index.js';

function setup(ttl) {
  const db = createTestDb();
  const clock = fixedClock();
  const svc = createServices(db, { clock, timezone: 'Asia/Karachi', confirmTtlMinutes: ttl });
  const owner = svc.businesses.registerOwner({ phone: '923001234567' });
  return { db, clock, owner, ctx: { businessId: owner.businessId, userId: owner.id }, ...svc };
}

const sale = (amount) => ({ intent: 'record_sale', entities: { amount }, confidence: 0.9, language: 'en', provider: 'rules' });

test('create then getActive round-trips the intent result', () => {
  const { confirmations, ctx } = setup();
  assert.equal(confirmations.getActive(ctx.userId), null);
  confirmations.create({ ...ctx, sourceMessageId: null }, sale(60000));
  const a = confirmations.getActive(ctx.userId);
  assert.deepEqual(a.intentResult, sale(60000));
  assert.equal(a.sourceMessageId, null);
  assert.equal(a.createdAt, '2026-11-24T05:00:00.000Z');
});

test('create replaces an existing pending confirmation', () => {
  const { confirmations, db, ctx } = setup();
  confirmations.create(ctx, sale(60000));
  confirmations.create(ctx, sale(70000));
  assert.equal(confirmations.getActive(ctx.userId).intentResult.entities.amount, 70000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pending_confirmations').get().n, 1);
});

test('expires after ttl and is deleted', () => {
  const { confirmations, clock, db, ctx } = setup(10);
  confirmations.create(ctx, sale(60000));
  clock.set('2026-11-24T05:09:59Z');
  assert.ok(confirmations.getActive(ctx.userId));
  clock.set('2026-11-24T05:10:01Z');
  assert.equal(confirmations.getActive(ctx.userId), null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pending_confirmations').get().n, 0);
});

test('custom ttl and clear', () => {
  const { confirmations, clock, ctx } = setup(1);
  confirmations.create(ctx, sale(1));
  clock.set('2026-11-24T05:01:30Z');
  assert.equal(confirmations.getActive(ctx.userId), null);
  confirmations.create(ctx, sale(2));
  confirmations.clear(ctx.userId);
  assert.equal(confirmations.getActive(ctx.userId), null);
});

test('confirmations are per user', () => {
  const { confirmations, businesses, ctx } = setup();
  const staff = businesses.addStaff(ctx.businessId, { name: 'Ali', phone: '923111111111' }).user;
  confirmations.create(ctx, sale(1));
  assert.equal(confirmations.getActive(staff.id), null);
  confirmations.clear(staff.id);
  assert.ok(confirmations.getActive(ctx.userId));
});
