import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWithRules, quickMatch } from '../../src/nlp/rules.js';

const ctx = { today: '2026-11-24', knownStaff: ['Ali'], knownContacts: ['Ahmed', 'Bilal'] };

// [text, intent, expected entity subset]
const CASES = [
  ['aaj 5000 ki sale hui', 'record_sale', { amount: 5000, paymentMode: 'cash' }],
  ['20 bori cement 30 hazar ki bechi', 'record_sale', { amount: 30000, quantity: 20, unit: 'bori', item: 'cement' }],
  ['Ahmed ko 8000 ka maal udhaar par becha', 'record_sale', { amount: 8000, paymentMode: 'credit', contactName: 'Ahmed' }],
  ['آج پانچ ہزار کی سیل ہوئی', 'record_sale', { amount: 5000 }],
  ['aj panj hazar da maal vechya', 'record_sale', { amount: 5000 }],
  ['نن مې پنځه زره روپۍ مال وپلوره', 'record_sale', { amount: 5000 }],
  ['Bilal se 1 lakh ka maal khareeda udhaar par', 'record_purchase', { amount: 100000, paymentMode: 'credit', contactName: 'Bilal' }],
  ['10 hazar ka cement khareeda', 'record_purchase', { amount: 10000, paymentMode: 'cash' }],
  ['بلال سے ایک لاکھ کا مال خریدا', 'record_purchase', { amount: 100000 }],
  ['bijli ka bill 3500 diya', 'record_expense', { amount: 3500, category: 'electricity' }],
  ['ڈھائی ہزار کا خرچہ ہوا', 'record_expense', { amount: 2500, category: 'general' }],
  ['dukaan ka kiraya 25 hazar diya', 'record_expense', { amount: 25000, category: 'rent' }],
  ['Ahmed ne 5000 wapas kiye', 'payment_received', { amount: 5000, contactName: 'Ahmed' }],
  ['احمد نے پانچ ہزار واپس کیے', 'payment_received', { amount: 5000, contactName: 'احمد' }],
  ['Ahmed se 2000 mil gaye', 'payment_received', { amount: 2000, contactName: 'Ahmed' }],
  ['Bilal ko 20 hazar ada kiye', 'payment_made', { amount: 20000, contactName: 'Bilal' }],
  ['بلال کو بیس ہزار دے دیے', 'payment_made', { amount: 20000, contactName: 'بلال' }],
  ['Ahmed ko 2 hazar udhaar diya', 'credit_given', { amount: 2000, contactName: 'Ahmed' }],
  ['احمد کو دو ہزار ادھار دیا', 'credit_given', { amount: 2000, contactName: 'احمد' }],
  ['Bilal se 50 hazar udhaar liya', 'credit_taken', { amount: 50000, contactName: 'Bilal' }],
  ['Kamran ko staff mein add karo 0300-1234567', 'add_staff', { staffName: 'Kamran', staffPhone: '923001234567' }],
  ['کامران کو ملازم بنا دو 03001234567', 'add_staff', { staffName: 'کامران', staffPhone: '923001234567' }],
  ['Ali ko kal tak 50 bori cement deliver karne ka kaam do', 'assign_task',
    { staffName: 'Ali', dueDate: '2026-11-25', taskDescription: '50 bori cement deliver karne' }],
  ['علی کو کل تک پچاس بوری سیمنٹ پہنچانے کا کام دو', 'assign_task',
    { staffName: 'علی', dueDate: '2026-11-25', taskDescription: 'پچاس بوری سیمنٹ پہنچانے' }],
  ['Ali nu kal tak 50 bori cement deliver karan da kam de do', 'assign_task',
    { staffName: 'Ali', dueDate: '2026-11-25', taskDescription: '50 bori cement deliver karan' }],
  ['task 3 ho gaya', 'complete_task', { taskRef: 3 }],
  ['kaam ho gaya', 'complete_task', { taskRef: null }],
  ['کام نمبر تین مکمل ہو گیا', 'complete_task', { taskRef: 3 }],
  ['kaam batao', 'list_tasks', { staffName: null }],
  ['Ali ke kaam dikhao', 'list_tasks', { staffName: 'Ali' }],
  ['کاموں کی فہرست دکھاؤ', 'list_tasks', {}],
  ['aaj ki sale batao', 'daily_summary', { period: 'today' }],
  ['kal ka hisaab batao', 'daily_summary', { period: 'yesterday' }],
  ['is mahine ka hisaab batao', 'daily_summary', { period: 'month' }],
  ['آج کا حساب بتاؤ', 'daily_summary', { period: 'today' }],
  ['aj di sale dasso', 'daily_summary', { period: 'today' }],
  ['د نن ورځې حساب راته ووایه', 'daily_summary', { period: 'today' }],
  ['اڄ جو حساب ٻڌايو', 'daily_summary', { period: 'today' }],
  ['balance batao', 'balance_query', {}],
  ['galle mein kitne paise hain', 'balance_query', {}],
  ['بیلنس بتاؤ', 'balance_query', {}],
  ['Ahmed ka hisaab batao', 'contact_balance', { contactName: 'Ahmed' }],
  ['احمد کا ادھار کتنا ہے', 'contact_balance', { contactName: 'احمد' }],
  ['Ahmed ne kitne dene hain', 'contact_balance', { contactName: 'Ahmed' }],
  ['pichli entry galat hai cancel karo', 'undo_last', {}],
  ['aakhri entry hatao', 'undo_last', {}],
  ['آخری اندراج غلط ہے', 'undo_last', {}],
  ['help', 'help', {}],
  ['madad', 'help', {}],
  ['مدد', 'help', {}],
  ['mausam kaisa hai', 'unknown', {}],
];

for (const [text, intent, entities] of CASES) {
  test(`rules: ${text}`, () => {
    const r = parseWithRules(text, ctx);
    assert.equal(r.intent, intent);
    for (const [k, v] of Object.entries(entities)) assert.equal(r.entities[k], v, `${text} -> ${k}`);
    assert.ok(['rules', 'quick'].includes(r.provider));
    assert.ok(r.confidence >= 0 && r.confidence <= 1);
  });
}

test('confirm phrases', () => {
  for (const t of ['haan', 'han', 'ji', 'jee', 'ok', 'theek hai', 'yes', 'ہاں', 'جی', 'ٹھیک ہے', 'ho', 'هو', 'ها']) {
    const r = parseWithRules(t, ctx);
    assert.equal(r.intent, 'confirm', t);
    assert.equal(r.provider, 'quick');
    assert.equal(r.confidence, 0.95);
  }
});

test('cancel phrases', () => {
  for (const t of ['nahi', 'nahin', 'na', 'no', 'cancel', 'mat karo', 'نہیں', 'نہ', 'نه', 'منسوخ']) {
    assert.equal(parseWithRules(t, ctx).intent, 'cancel', t);
  }
});

test('quickMatch only for short whole-phrase matches', () => {
  assert.equal(quickMatch('haan').intent, 'confirm');
  assert.equal(quickMatch('haan ji').intent, 'confirm');
  assert.equal(quickMatch('kaam ho gaya'), null);
  assert.equal(quickMatch('aaj 5000 ki sale hui'), null);
  assert.equal(quickMatch('haan haan haan haan'), null);
  assert.equal(quickMatch(''), null);
});

test('confidence levels', () => {
  assert.equal(parseWithRules('aaj 5000 ki sale hui', ctx).confidence, 0.9);
  assert.equal(parseWithRules('aaj ki sale 5000', ctx).confidence, 0.7); // bare sale + amount
  assert.equal(parseWithRules('Ahmed ko 8000 ka maal udhaar par becha', ctx).confidence, 0.9);
  assert.equal(parseWithRules('sale hui', ctx).confidence, 0.6); // amount missing
  assert.equal(parseWithRules('mausam kaisa hai', ctx).confidence, 0.3);
});

test('entities object always has every field', () => {
  const r = parseWithRules('aaj 5000 ki sale hui', ctx);
  assert.equal(Object.keys(r.entities).length, 14);
  assert.equal(r.language, 'roman-ur');
});

test('unknown contact name falls back to the token before the particle', () => {
  const r = parseWithRules('Zubair ne 700 wapas kiye', ctx);
  assert.equal(r.intent, 'payment_received');
  assert.equal(r.entities.contactName, 'Zubair');
});
