import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/db.js';
import { fixedClock } from '../helpers/clock.js';
import { createServices } from '../../src/domain/index.js';

function setup() {
  const db = createTestDb();
  const clock = fixedClock();
  const svc = createServices(db, { clock, timezone: 'Asia/Karachi' });
  const owner = svc.businesses.registerOwner({ phone: '923001234567', name: 'Ahmed' });
  const ctx = { businessId: owner.businessId, userId: owner.id };
  return { db, clock, owner, ctx, ...svc };
}

function bal(ledger, businessId, code) {
  return ledger.trialBalance(businessId).accounts.find((a) => a.code === code);
}

test('cash sale: debit CASH, credit SALES', () => {
  const { ledger, ctx } = setup();
  const r = ledger.recordSale(ctx, { amount: 5000, item: 'cement', quantity: 2, unit: 'bori' });
  assert.equal(r.txnNo, 1);
  assert.equal(r.type, 'sale');
  assert.equal(r.amount, 5000);
  assert.equal(r.txnDate, '2026-11-24');
  assert.equal(r.contact, null);
  assert.equal(bal(ledger, ctx.businessId, 'CASH').debit, 5000);
  assert.equal(bal(ledger, ctx.businessId, 'SALES').credit, 5000);
  assert.equal(ledger.getBalances(ctx.businessId).cash, 5000);
});

test('bank sale hits BANK', () => {
  const { ledger, ctx } = setup();
  ledger.recordSale(ctx, { amount: 1200.5, paymentMode: 'bank' });
  const b = ledger.getBalances(ctx.businessId);
  assert.equal(b.bank, 1200.5);
  assert.equal(b.cash, 0);
});

test('credit sale needs a contact and posts AR', () => {
  const { ledger, ctx } = setup();
  assert.throws(() => ledger.recordSale(ctx, { amount: 100, paymentMode: 'credit' }), { code: 'CONTACT_NOT_FOUND' });
  const r = ledger.recordSale(ctx, { amount: 8000, paymentMode: 'credit', contactName: 'Ahmed' });
  assert.equal(r.contact.name, 'Ahmed');
  assert.equal(r.contactBalance, 8000);
  assert.equal(ledger.getBalances(ctx.businessId).receivables, 8000);
  assert.equal(ledger.getBalances(ctx.businessId).cash, 0);
});

test('credit sale then payment_received settles contact to 0', () => {
  const { ledger, ctx } = setup();
  ledger.recordSale(ctx, { amount: 8000, paymentMode: 'credit', contactName: 'Ahmed' });
  const r = ledger.recordPaymentReceived(ctx, { amount: 8000, contactName: 'Ahmed' });
  assert.equal(r.type, 'payment_in');
  assert.equal(r.contactBalance, 0);
  assert.equal(ledger.getBalances(ctx.businessId).cash, 8000);
  assert.equal(ledger.getBalances(ctx.businessId).receivables, 0);
});

test('purchase cash and credit', () => {
  const { ledger, ctx } = setup();
  ledger.recordPurchase(ctx, { amount: 3000 });
  assert.equal(bal(ledger, ctx.businessId, 'PURCHASES').debit, 3000);
  assert.equal(ledger.getBalances(ctx.businessId).cash, -3000);
  assert.throws(() => ledger.recordPurchase(ctx, { amount: 10, paymentMode: 'credit' }), { code: 'CONTACT_NOT_FOUND' });
  const r = ledger.recordPurchase(ctx, { amount: 7000, paymentMode: 'credit', contactName: 'Bilal' });
  assert.equal(r.contactBalance, -7000);
  assert.equal(ledger.getBalances(ctx.businessId).payables, 7000);
});

test('expense posts EXPENSES; credit mode treated as cash', () => {
  const { ledger, ctx } = setup();
  const r = ledger.recordExpense(ctx, { amount: 900, category: 'electricity', paymentMode: 'credit' });
  assert.equal(r.paymentMode, 'cash');
  assert.equal(bal(ledger, ctx.businessId, 'EXPENSES').debit, 900);
  assert.equal(ledger.getBalances(ctx.businessId).cash, -900);
  const t = ledger.listTransactions(ctx.businessId, {})[0];
  assert.equal(t.category, 'electricity');
});

test('payment_made reduces what we owe', () => {
  const { ledger, ctx } = setup();
  ledger.recordCreditTaken(ctx, { amount: 50000, contactName: 'Bilal' });
  const r = ledger.recordPaymentMade(ctx, { amount: 20000, contactName: 'Bilal', paymentMode: 'bank' });
  assert.equal(r.contactBalance, -30000);
  assert.equal(ledger.getBalances(ctx.businessId).bank, -20000);
  assert.equal(ledger.getBalances(ctx.businessId).payables, 30000);
});

test('credit_given is +2000 and credit_taken is -50000', () => {
  const { ledger, ctx } = setup();
  const g = ledger.recordCreditGiven(ctx, { amount: 2000, contactName: 'Ahmed' });
  assert.equal(g.contactBalance, 2000);
  assert.equal(ledger.getBalances(ctx.businessId).cash, -2000);
  const t = ledger.recordCreditTaken(ctx, { amount: 50000, contactName: 'Bilal' });
  assert.equal(t.contactBalance, -50000);
  assert.equal(ledger.getBalances(ctx.businessId).cash, 48000);
  assert.throws(() => ledger.recordCreditGiven(ctx, { amount: 5 }), { code: 'CONTACT_NOT_FOUND' });
});

test('trial balance stays balanced after a mixed sequence', () => {
  const { ledger, ctx } = setup();
  ledger.recordSale(ctx, { amount: 5000 });
  ledger.recordSale(ctx, { amount: 8000, paymentMode: 'credit', contactName: 'Ahmed' });
  ledger.recordPurchase(ctx, { amount: 2500.75, paymentMode: 'bank' });
  ledger.recordPurchase(ctx, { amount: 4000, paymentMode: 'credit', contactName: 'Bilal' });
  ledger.recordExpense(ctx, { amount: 333.33 });
  ledger.recordPaymentReceived(ctx, { amount: 1000, contactName: 'Ahmed' });
  ledger.recordPaymentMade(ctx, { amount: 1000, contactName: 'Bilal' });
  ledger.recordCreditGiven(ctx, { amount: 10, contactName: 'Sara' });
  ledger.recordCreditTaken(ctx, { amount: 20, contactName: 'Zain' });
  ledger.voidLastTransaction(ctx);
  const tb = ledger.trialBalance(ctx.businessId);
  assert.equal(tb.accounts.length, 8);
  assert.equal(tb.totalDebit, tb.totalCredit);
  assert.ok(tb.totalDebit > 0);
});

test('void excludes from balances and reports; txn marked voided', () => {
  const { ledger, reports, ctx } = setup();
  ledger.recordSale(ctx, { amount: 1000 });
  ledger.recordSale(ctx, { amount: 8000, paymentMode: 'credit', contactName: 'Ahmed' });
  const v = ledger.voidLastTransaction(ctx);
  assert.equal(v.txnNo, 2);
  assert.equal(v.contactBalance, 0);
  assert.equal(ledger.getBalances(ctx.businessId).receivables, 0);
  assert.equal(reports.summary(ctx.businessId, 'today').sales, 1000);
  const list = ledger.listTransactions(ctx.businessId, {});
  assert.equal(list[0].voided, true);
  assert.equal(list[1].voided, false);
  // the next undo hits the previous one
  assert.equal(ledger.voidLastTransaction(ctx).txnNo, 1);
  assert.throws(() => ledger.voidLastTransaction(ctx), { code: 'NOTHING_TO_UNDO' });
});

test('NOTHING_TO_UNDO when none, older than 24h, or created by someone else', () => {
  const { ledger, clock, ctx, businesses } = setup();
  assert.throws(() => ledger.voidLastTransaction(ctx), { code: 'NOTHING_TO_UNDO' });
  ledger.recordSale(ctx, { amount: 100 });
  const staff = businesses.addStaff(ctx.businessId, { name: 'Ali', phone: '923111111111' }).user;
  assert.throws(() => ledger.voidLastTransaction({ businessId: ctx.businessId, userId: staff.id }), { code: 'NOTHING_TO_UNDO' });
  clock.set('2026-11-25T05:00:01Z');
  assert.throws(() => ledger.voidLastTransaction(ctx), { code: 'NOTHING_TO_UNDO' });
  clock.set('2026-11-25T04:00:00Z');
  assert.equal(ledger.voidLastTransaction(ctx).txnNo, 1);
});

test('txn_no is per business and starts at 1', () => {
  const { ledger, ctx, businesses } = setup();
  const o2 = businesses.registerOwner({ phone: '923002222222' });
  assert.equal(ledger.recordSale(ctx, { amount: 1 }).txnNo, 1);
  assert.equal(ledger.recordSale(ctx, { amount: 1 }).txnNo, 2);
  assert.equal(ledger.recordSale({ businessId: o2.businessId, userId: o2.id }, { amount: 1 }).txnNo, 1);
});

test('invalid amounts throw INVALID_AMOUNT and write nothing', () => {
  const { ledger, ctx, db } = setup();
  for (const amount of [0, -5, NaN, null, undefined, 'abc']) {
    assert.throws(() => ledger.recordSale(ctx, { amount }), { code: 'INVALID_AMOUNT' });
  }
  assert.throws(() => ledger.recordExpense(ctx, { amount: 0 }), { code: 'INVALID_AMOUNT' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, 0);
});

test('failed credit sale rolls back the contact creation', () => {
  const { ledger, ctx, contacts } = setup();
  assert.throws(() => ledger.recordSale(ctx, { amount: 0, paymentMode: 'credit', contactName: 'Ghost' }), { code: 'INVALID_AMOUNT' });
  assert.equal(contacts.findByName(ctx.businessId, 'Ghost'), null);
});

test('unbalanced posting is rejected by the post helper (via forced account failure)', () => {
  const { ledger, ctx, db } = setup();
  db.prepare("DELETE FROM accounts WHERE business_id = ? AND code = 'SALES'").run(ctx.businessId);
  assert.throws(() => ledger.recordSale(ctx, { amount: 10 }), { code: 'UNBALANCED_ENTRY' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n, 0);
});

test('business A cannot see business B', () => {
  const { ledger, ctx, businesses, contacts } = setup();
  const o2 = businesses.registerOwner({ phone: '923002222222' });
  const ctx2 = { businessId: o2.businessId, userId: o2.id };
  ledger.recordSale(ctx, { amount: 5000, paymentMode: 'credit', contactName: 'Ahmed' });
  ledger.recordSale(ctx2, { amount: 70 });
  assert.equal(ledger.getBalances(ctx2.businessId).cash, 70);
  assert.equal(ledger.getBalances(ctx2.businessId).receivables, 0);
  assert.equal(ledger.listTransactions(ctx2.businessId, {}).length, 1);
  assert.equal(ledger.listContactBalances(ctx2.businessId).length, 0);
  const ahmed = contacts.findByName(ctx.businessId, 'Ahmed');
  assert.equal(ledger.getContactBalance(ctx2.businessId, ahmed.id), 0);
  assert.throws(() => ledger.voidLastTransaction({ businessId: ctx2.businessId, userId: owner1Id(ctx) }), { code: 'NOTHING_TO_UNDO' });
});

function owner1Id(ctx) {
  return ctx.userId;
}

test('listTransactions filters by date and limit; listContactBalances', () => {
  const { ledger, clock, ctx } = setup();
  ledger.recordSale(ctx, { amount: 100, contactName: 'Ahmed', item: 'rice', quantity: 2.5, unit: 'kg' });
  clock.set('2026-11-25T05:00:00Z');
  ledger.recordSale(ctx, { amount: 200 });
  ledger.recordCreditGiven(ctx, { amount: 300, contactName: 'Sara' });
  assert.equal(ledger.listTransactions(ctx.businessId, {}).length, 3);
  assert.equal(ledger.listTransactions(ctx.businessId, { limit: 1 }).length, 1);
  assert.equal(ledger.listTransactions(ctx.businessId, { from: '2026-11-25' }).length, 2);
  const first = ledger.listTransactions(ctx.businessId, { to: '2026-11-24' })[0];
  assert.equal(first.contactName, 'Ahmed');
  assert.equal(first.quantity, 2.5);
  assert.equal(first.unit, 'kg');
  const cb = ledger.listContactBalances(ctx.businessId);
  assert.deepEqual(cb.map((c) => [c.name, c.balance]), [['Ahmed', 0], ['Sara', 300]]);
});

test('amounts round to integer paisa', () => {
  const { ledger, ctx, db } = setup();
  ledger.recordSale(ctx, { amount: 10.005 });
  const row = db.prepare('SELECT amount_paisa FROM transactions').get();
  assert.ok(Number.isInteger(row.amount_paisa));
});
