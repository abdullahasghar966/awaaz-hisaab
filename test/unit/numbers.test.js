import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordsToNumber, extractNumbers, extractAmount, extractQuantity } from '../../src/nlp/numbers.js';

const CASES = [
  ['5000', 5000], ['5,000', 5000], ['۵۰۰۰', 5000], ['5k', 5000], ['5 hazar', 5000], ['panch hazar', 5000],
  ['پانچ ہزار', 5000], ['2.5 lakh', 250000], ['ڈیڑھ لاکھ', 150000], ['sarhe teen hazar', 3500],
  ['dhai hazaar', 2500], ['ek hazar paanch sau', 1500], ['do sau pachas', 250], ['sava sau', 125],
  ['paune do lakh', 175000], ['پنځه زره', 5000], ['ڏهه هزار', 10000], ['1250.50', 1250.5],
];

test('amounts from the spec list (extractAmount)', () => {
  for (const [input, expected] of CASES) assert.equal(extractAmount(input), expected, input);
});

test('wordsToNumber parses the whole string', () => {
  for (const [input, expected] of CASES) assert.equal(wordsToNumber(input), expected, input);
  assert.equal(wordsToNumber('kaam do'), null);
  assert.equal(wordsToNumber(''), null);
});

test('kaam do is never an amount', () => {
  assert.equal(extractAmount('kaam do'), null);
  assert.equal(extractAmount('Ali ko kaam do'), null);
});

test('word-only number followed by a currency word is an amount', () => {
  assert.equal(extractAmount('do rupay'), 2);
});

test('quantity + amount are separated', () => {
  const text = '20 bori cement 30 hazar ki bechi';
  assert.deepEqual(extractQuantity(text), { quantity: 20, unit: 'bori', item: 'cement' });
  assert.equal(extractAmount(text), 30000);
});

test('quantity is null without a unit', () => {
  assert.equal(extractQuantity('aaj 5000 ki sale hui'), null);
});

test('phone numbers are not amounts', () => {
  assert.equal(extractAmount('Kamran ko staff mein add karo 0300-1234567'), null);
  assert.equal(extractAmount('03001234567'), null);
  assert.equal(extractAmount('0300-1234567 par 5000 bhejo'), 5000);
});

test('currency-follow amount wins over a larger plain number', () => {
  assert.equal(extractAmount('10 hazar ka cement 50 bori'), 10000);
});

test('extractNumbers metadata', () => {
  const n = extractNumbers('20 bori cement 30 hazar ki bechi');
  assert.equal(n.length, 2);
  assert.equal(n[0].value, 20);
  assert.equal(n[0].unitAfter, 'bori');
  assert.equal(n[0].hasDigit, true);
  assert.equal(n[1].value, 30000);
  assert.equal(n[1].hasMultiplier, true);
  assert.equal(n[1].currencyAfter, true);
  assert.equal(n[1].unitAfter, null);
});

test('extractNumbers accepts tokens', () => {
  assert.equal(extractNumbers(['task', '3', 'ho', 'gaya'])[0].value, 3);
});
