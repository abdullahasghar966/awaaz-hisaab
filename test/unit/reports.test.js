import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/db.js';
import { fixedClock } from '../helpers/clock.js';
import { createServices } from '../../src/domain/index.js';

function setup() {
  const db = createTestDb();
  const clock = fixedClock();
  const svc = createServices(db, { clock, timezone: 'Asia/Karachi' });
  const owner = svc.businesses.registerOwner({ phone: '923001234567' });
  return { clock, ctx: { businessId: owner.businessId, userId: owner.id }, ...svc };
}

test('empty summary is all zeros', () => {
  const { reports, ctx } = setup();
  const s = reports.summary(ctx.businessId);
  assert.deepEqual(s, {
    period: 'today', from: '2026-11-24', to: '2026-11-24', sales: 0, purchases: 0, expenses: 0, received: 0,
    paid: 0, creditGiven: 0, creditTaken: 0, net: 0, txnCount: 0, cashBalance: 0,
  });
});

test('today / yesterday / month sums with clock.set', () => {
  const { reports, ledger, clock, ctx } = setup();
  clock.set('2026-11-23T08:00:00Z'); // yesterday
  ledger.recordSale(ctx, { amount: 1000 });
  clock.set('2026-11-10T08:00:00Z');
  ledger.recordSale(ctx, { amount: 500 });
  clock.set('2026-10-30T08:00:00Z'); // previous month
  ledger.recordSale(ctx, { amount: 99 });
  clock.set('2026-11-24T05:00:00Z');
  ledger.recordSale(ctx, { amount: 5000 });
  ledger.recordPurchase(ctx, { amount: 2000 });
  ledger.recordExpense(ctx, { amount: 300 });
  ledger.recordCreditGiven(ctx, { amount: 400, contactName: 'Ahmed' });
  ledger.recordCreditTaken(ctx, { amount: 600, contactName: 'Bilal' });
  ledger.recordPaymentReceived(ctx, { amount: 100, contactName: 'Ahmed' });
  ledger.recordPaymentMade(ctx, { amount: 50, contactName: 'Bilal' });

  const t = reports.summary(ctx.businessId, 'today');
  assert.equal(t.sales, 5000);
  assert.equal(t.purchases, 2000);
  assert.equal(t.expenses, 300);
  assert.equal(t.net, 2700);
  assert.equal(t.creditGiven, 400);
  assert.equal(t.creditTaken, 600);
  assert.equal(t.received, 100);
  assert.equal(t.paid, 50);
  assert.equal(t.txnCount, 7);
  assert.equal(t.from, '2026-11-24');
  // cash: 99+500+1000+5000-2000-300-400+600+100-50
  assert.equal(t.cashBalance, 4549);

  const y = reports.summary(ctx.businessId, 'yesterday');
  assert.equal(y.sales, 1000);
  assert.equal(y.txnCount, 1);
  assert.equal(y.from, '2026-11-23');

  const m = reports.summary(ctx.businessId, 'month');
  assert.equal(m.from, '2026-11-01');
  assert.equal(m.sales, 6500);

  const w = reports.summary(ctx.businessId, 'week'); // Mon 2026-11-23 .. today
  assert.equal(w.from, '2026-11-23');
  assert.equal(w.sales, 6000);
});

test('voided transactions are excluded; other business excluded', () => {
  const { reports, ledger, businesses, ctx } = setup();
  ledger.recordSale(ctx, { amount: 1000 });
  ledger.recordExpense(ctx, { amount: 200 });
  ledger.voidLastTransaction(ctx);
  const s = reports.summary(ctx.businessId, 'today');
  assert.equal(s.expenses, 0);
  assert.equal(s.txnCount, 1);
  assert.equal(s.net, 1000);
  const o2 = businesses.registerOwner({ phone: '923002222222' });
  assert.equal(reports.summary(o2.businessId, 'today').sales, 0);
});

test('summary uses business-local date (Karachi) near midnight UTC', () => {
  const { reports, ledger, clock, ctx } = setup();
  clock.set('2026-11-23T20:00:00Z'); // 2026-11-24 01:00 PKT
  ledger.recordSale(ctx, { amount: 700 });
  assert.equal(reports.summary(ctx.businessId, 'today').sales, 700);
});
