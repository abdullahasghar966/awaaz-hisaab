import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/db.js';
import { fixedClock } from '../helpers/clock.js';
import { createServices } from '../../src/domain/index.js';
import { extractPhone } from '../../src/utils/phone.js';
import { extractAmount } from '../../src/nlp/numbers.js';
import { parseWithRules } from '../../src/nlp/rules.js';

test('extractPhone accepts spaced and dashed forms', () => {
  assert.equal(extractPhone('Kamran ko add karo +92 300 1234567'), '923001234567');
  assert.equal(extractPhone('0300 1234567'), '923001234567');
  assert.equal(extractPhone('0300-123-4567'), '923001234567');
  assert.equal(extractPhone('92 300 1234567'), '923001234567');
});

test('spaced phone numbers are not read as amounts and add_staff parses them', () => {
  const r = parseWithRules('Kamran ko staff mein add karo +92 300 1234567', { today: '2026-11-24' });
  assert.equal(r.intent, 'add_staff');
  assert.equal(r.entities.staffPhone, '923001234567');
  assert.equal(extractAmount('Kamran ko 5000 diye +92 300 1234567'), 5000);
});

test('"saade" spelling is a half modifier', () => {
  assert.equal(extractAmount('saade teen hazar ka kharcha'), 3500);
});

test('addStaff with the owner name is rejected and leaves the owner untouched', () => {
  const db = createTestDb();
  const { businesses } = createServices(db, { clock: fixedClock(), timezone: 'Asia/Karachi' });
  const owner = businesses.registerOwner({ phone: '923001111111', name: 'Ahmed' });
  assert.throws(() => businesses.addStaff(owner.businessId, { name: 'Ahmed', phone: '923002222222' }), { code: 'NAME_TAKEN' });
  assert.equal(businesses.findUserByPhone('923001111111').role, 'owner');
  assert.equal(businesses.findUserByPhone('923002222222'), null);
});

import { toPaisa } from '../../src/utils/money.js';

test('toPaisa rounds half-paisa values up despite binary float noise', () => {
  assert.equal(toPaisa(1.005), 101);
  assert.equal(toPaisa(10.075), 1008);
  assert.equal(toPaisa(1250.5), 125050);
});

test('ledger rejects absurdly large amounts instead of overflowing', () => {
  const db = createTestDb();
  const { businesses, ledger } = createServices(db, { clock: fixedClock(), timezone: 'Asia/Karachi' });
  const o = businesses.registerOwner({ phone: '923001111111', name: 'Ahmed' });
  const ctx = { businessId: o.businessId, userId: o.id };
  assert.throws(() => ledger.recordSale(ctx, { amount: 1e22 }), { code: 'INVALID_AMOUNT' });
  assert.throws(() => ledger.recordSale(ctx, { amount: 1e12 }), { code: 'INVALID_AMOUNT' });
  assert.equal(ledger.recordSale(ctx, { amount: 5000 }).amount, 5000);
});
