import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPLY_KEYS, composeReply, fallbackChain } from '../../src/replies/index.js';
import { balanceLine, formatDate, intentLabel } from '../../src/replies/format.js';

const SAMPLES = {
  welcome: { name: 'Bilal', businessName: 'Bilal Traders' },
  sale_recorded: { amount: 5000, contactName: 'Ahmed', paymentMode: 'credit', item: 'cement', quantity: 20, unit: 'bori', txnNo: 3, contactBalance: 5000 },
  purchase_recorded: { amount: 30000, contactName: 'Bilal', paymentMode: 'cash', item: 'cement', quantity: 20, unit: 'bori', txnNo: 4, contactBalance: null },
  expense_recorded: { amount: 3500, category: 'bijli', txnNo: 5 },
  payment_received_recorded: { amount: 2000, contactName: 'Ahmed', txnNo: 6, contactBalance: 3000 },
  payment_made_recorded: { amount: 1000, contactName: 'Bilal', txnNo: 7, contactBalance: -1000 },
  credit_given_recorded: { amount: 2000, contactName: 'Ali', txnNo: 8, contactBalance: 2000 },
  credit_taken_recorded: { amount: 50000, contactName: 'Bilal', txnNo: 9, contactBalance: -50000 },
  undo_done: { txnNo: 9, type: 'sale', amount: 5000 },
  staff_added: { staffName: 'Ali', staffPhone: '923001112233', created: true },
  task_assigned: { taskNo: 2, staffName: 'Ali', description: 'cement deliver karna', dueDate: '2026-11-25', staffNotified: true },
  task_notification: { taskNo: 2, businessName: 'Bilal Traders', description: 'cement deliver karna', dueDate: '2026-11-25' },
  task_completed: { taskNo: 2, description: 'cement deliver karna' },
  task_completed_owner_notice: { taskNo: 2, description: 'cement deliver karna', staffName: 'Ali' },
  task_list: { staffName: 'Ali', tasks: [{ taskNo: 1, description: 'bijli ka meter', staffName: 'Ali', dueDate: null, status: 'open' }] },
  daily_summary: {
    period: 'today', from: '2026-11-24', to: '2026-11-24',
    sales: 5000, purchases: 0, expenses: 0, received: 0, paid: 0,
    creditGiven: 0, creditTaken: 0, net: 5000, txnCount: 1, cashBalance: 5000,
  },
  balance: { cash: 5000, bank: 0, receivables: 2000, payables: 1000 },
  contact_balance: { contactName: 'Ahmed', balance: -300 },
  help: {},
  confirm_request: { intent: 'record_sale', amount: 60000, contactName: null, staffName: null, description: null },
  cancelled: {},
  nothing_to_confirm: {},
  missing_info: { intent: 'record_sale', missing: ['amount', 'contactName'] },
  not_found_contact: { name: 'Zafar' },
  not_found_staff: { name: 'Zafar' },
  not_found_task: { taskRef: null },
  nothing_to_undo: {},
  phone_taken: { phone: '923001234567' },
  permission_denied: {},
  unknown: {},
  not_registered: {},
  error: {},
  transcription_failed: {},
  stt_not_configured: {},
  unsupported_message: {},
};

test('SAMPLES covers every REPLY_KEY', () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), [...REPLY_KEYS].sort());
});

for (const lang of ['ur', 'roman-ur', 'en']) {
  test(`every REPLY_KEY renders a non-empty string in ${lang}`, () => {
    for (const key of REPLY_KEYS) {
      const text = composeReply(key, SAMPLES[key], lang);
      assert.equal(typeof text, 'string', `${key}/${lang}`);
      assert.ok(text.trim().length > 0, `${key}/${lang} is empty`);
      assert.ok(!text.includes('undefined'), `${key}/${lang} leaked undefined: ${text}`);
      assert.ok(!text.includes('null'), `${key}/${lang} leaked null: ${text}`);
    }
  });
}

test('every REPLY_KEY renders for the partial languages too (with fallback)', () => {
  for (const lang of ['pa', 'ps', 'sd']) {
    for (const key of REPLY_KEYS) {
      const text = composeReply(key, SAMPLES[key], lang);
      assert.ok(text.trim().length > 0, `${key}/${lang}`);
    }
  }
});

test('ps falls back to ur for sale_recorded', () => {
  assert.equal(composeReply('sale_recorded', SAMPLES.sale_recorded, 'ps'), composeReply('sale_recorded', SAMPLES.sale_recorded, 'ur'));
});

test('partial languages use their own text for unknown and confirm_request', () => {
  assert.match(composeReply('unknown', {}, 'ps'), /بښنه/);
  assert.match(composeReply('confirm_request', SAMPLES.confirm_request, 'sd'), /تصديق/);
  assert.match(composeReply('confirm_request', SAMPLES.confirm_request, 'pa'), /پکا کرو/);
});

test('fallbackChain follows the spec for every language', () => {
  assert.deepEqual(fallbackChain('pa'), ['pa', 'ur', 'roman-ur', 'en']);
  assert.deepEqual(fallbackChain('ps'), ['ps', 'ur', 'roman-ur', 'en']);
  assert.deepEqual(fallbackChain('sd'), ['sd', 'ur', 'roman-ur', 'en']);
  assert.deepEqual(fallbackChain('ur'), ['ur', 'roman-ur', 'en']);
  assert.deepEqual(fallbackChain('roman-ur'), ['roman-ur', 'en']);
  assert.deepEqual(fallbackChain('en'), ['en', 'roman-ur']);
  assert.deepEqual(fallbackChain('xx'), ['roman-ur', 'en']);
});

test('an unknown key renders the error reply', () => {
  assert.equal(composeReply('no_such_key', {}, 'roman-ur'), composeReply('error', {}, 'roman-ur'));
});

test('balanceLine: owes us, we owe, settled (roman-ur)', () => {
  assert.equal(balanceLine('Ahmed', 300, 'roman-ur'), 'Ahmed ne aap ko Rs 300 dene hain.');
  assert.equal(balanceLine('Ahmed', -300, 'roman-ur'), 'Aap ne Ahmed ko Rs 300 dene hain.');
  assert.equal(balanceLine('Ahmed', 0, 'roman-ur'), 'Ahmed ka hisaab barabar hai.');
});

test('balanceLine: same three cases in Urdu and English', () => {
  assert.equal(balanceLine('احمد', 1500, 'ur'), 'احمد کے ذمے Rs 1,500 باقی ہیں۔');
  assert.equal(balanceLine('احمد', -1500, 'ur'), 'آپ نے احمد کو Rs 1,500 دینے ہیں۔');
  assert.equal(balanceLine('احمد', 0, 'ur'), 'احمد کا حساب برابر ہے۔');
  assert.equal(balanceLine('Ahmed', 300, 'en'), 'Ahmed owes you Rs 300.');
  assert.equal(balanceLine('Ahmed', -300, 'en'), 'You owe Ahmed Rs 300.');
  assert.equal(balanceLine('Ahmed', 0, 'en'), "Ahmed's account is settled.");
});

test('amounts use Indian digit grouping', () => {
  const text = composeReply('sale_recorded', { ...SAMPLES.sale_recorded, amount: 150000, contactName: null, contactBalance: null }, 'roman-ur');
  assert.match(text, /Rs 1,50,000/);
});

test('sale_recorded: credit sales mark (udhaar) and show the balance; cash sales do not', () => {
  const credit = composeReply('sale_recorded', SAMPLES.sale_recorded, 'roman-ur');
  assert.match(credit, /Ahmed \(udhaar\)/);
  assert.match(credit, /Entry #3\./);
  assert.match(credit, /Ahmed ne aap ko Rs 5,000 dene hain\./);

  const cash = composeReply('sale_recorded', { amount: 800, txnNo: 4, contactName: null, contactBalance: null, paymentMode: 'cash' }, 'roman-ur');
  assert.equal(cash, 'Sale darj ho gayi: Rs 800. Entry #4.');
});

test('daily_summary shows the period label and the net line', () => {
  const text = composeReply('daily_summary', SAMPLES.daily_summary, 'roman-ur');
  assert.ok(text.startsWith('Aaj ka hisaab (24-11-2026):'));
  assert.ok(text.includes('Munafa (andaza): Rs 5,000'));
});

test('daily_summary shows a range as "A se B tak"', () => {
  const d = { ...SAMPLES.daily_summary, period: 'month', from: '2026-11-01', to: '2026-11-24' };
  const text = composeReply('daily_summary', d, 'roman-ur');
  assert.ok(text.includes('(01-11-2026 se 24-11-2026 tak):'));
});

test('formatDate converts YYYY-MM-DD to DD-MM-YYYY', () => {
  assert.equal(formatDate('2026-11-24', 'ur'), '24-11-2026');
  assert.equal(formatDate('soon', 'en'), 'soon');
});

test('intentLabel: Urdu script only for ur, Roman Urdu for everything else', () => {
  assert.equal(intentLabel('record_sale', 'ur'), 'فروخت');
  assert.equal(intentLabel('record_sale', 'roman-ur'), 'Sale');
  assert.equal(intentLabel('record_sale', 'en'), 'Sale');
});
