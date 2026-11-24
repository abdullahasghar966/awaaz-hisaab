import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPaisa, fromPaisa, formatRs } from '../../src/utils/money.js';
import { normalizePhone, isValidPkMobile, extractPhone } from '../../src/utils/phone.js';
import { todayLocal, addDays, periodRange, nowIso } from '../../src/utils/time.js';
import { toAsciiDigits, normalizeText, tokenize, isArabicScript, titleCase } from '../../src/utils/text.js';
import { createLogger } from '../../src/utils/logger.js';

// ---- money ----

test('toPaisa converts rupees to integer paisa', () => {
  assert.equal(toPaisa(1250.5), 125050);
  assert.equal(toPaisa('10'), 1000);
  assert.equal(toPaisa(0), 0);
  assert.equal(toPaisa(-5), -500);
});

test('toPaisa throws RangeError for non-finite input', () => {
  assert.throws(() => toPaisa('abc'), RangeError);
  assert.throws(() => toPaisa(Infinity), RangeError);
  assert.throws(() => toPaisa(undefined), RangeError);
});

test('fromPaisa converts paisa back to rupees', () => {
  assert.equal(fromPaisa(125050), 1250.5);
  assert.equal(fromPaisa(100), 1);
});

test('formatRs uses Indian grouping and drops .00', () => {
  assert.equal(formatRs(150000), 'Rs 1,50,000');
  assert.equal(formatRs(1250.5), 'Rs 1,250.5');
  assert.equal(formatRs(500), 'Rs 500');
  assert.equal(formatRs(10000000), 'Rs 1,00,00,000');
});

test('formatRs keeps at most 2 decimals and renders negatives as Rs -500', () => {
  assert.equal(formatRs(1234.567), 'Rs 1,234.57');
  assert.equal(formatRs(-500), 'Rs -500');
});

// ---- phone ----

test('normalizePhone handles the common Pakistani forms', () => {
  assert.equal(normalizePhone('0300-1234567'), '923001234567');
  assert.equal(normalizePhone('+92 300 1234567'), '923001234567');
  assert.equal(normalizePhone('00923001234567'), '923001234567');
  assert.equal(normalizePhone('923001234567'), '923001234567');
  assert.equal(normalizePhone('۰۳۰۰۱۲۳۴۵۶۷'), '923001234567');
  assert.equal(normalizePhone('٠٣٠٠١٢٣٤٥٦٧'), '923001234567');
});

test('normalizePhone returns null for fewer than 10 digits', () => {
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone(null), null);
});

test('isValidPkMobile accepts only 923 followed by 9 digits', () => {
  assert.equal(isValidPkMobile('923001234567'), true);
  assert.equal(isValidPkMobile('923401234567'), true);
  assert.equal(isValidPkMobile('92300123456'), false);
  assert.equal(isValidPkMobile('923001234567 '), false);
  assert.equal(isValidPkMobile('03001234567'), false);
  assert.equal(isValidPkMobile('921001234567'), false);
});

test('extractPhone finds and normalizes a number inside text', () => {
  assert.equal(extractPhone('mera number 0300-1234567 hai'), '923001234567');
  assert.equal(extractPhone('Ali ko bhejo +923001234567 pe'), '923001234567');
  assert.equal(extractPhone('ye number 03001234567 hai'), '923001234567');
  assert.equal(extractPhone('is number ko ۰۳۰۰۱۲۳۴۵۶۷ pe bhejo'), '923001234567');
});

test('extractPhone returns null when there is no mobile number', () => {
  assert.equal(extractPhone('aaj 5000 ki sale hui'), null);
  assert.equal(extractPhone('kaam ho gaya'), null);
});

// ---- time ----

test('todayLocal shifts to the next day in Karachi at 20:00Z', () => {
  const at = new Date('2026-11-24T20:00:00Z'); // 01:00 on 25 Nov in Asia/Karachi (UTC+5)
  assert.equal(todayLocal('Asia/Karachi', at), '2026-11-25');
  assert.equal(todayLocal('UTC', at), '2026-11-24');
});

test('todayLocal at 05:00Z is still the same day in Karachi', () => {
  assert.equal(todayLocal('Asia/Karachi', new Date('2026-11-24T05:00:00Z')), '2026-11-24');
});

test('addDays moves across month and year boundaries', () => {
  assert.equal(addDays('2026-11-24', 1), '2026-11-25');
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-03-01', -1), '2024-02-29');
  assert.equal(addDays('2026-11-24', -1), '2026-11-23');
});

test('periodRange today and yesterday', () => {
  const now = new Date('2026-11-24T05:00:00Z');
  assert.deepEqual(periodRange('today', 'Asia/Karachi', now), { from: '2026-11-24', to: '2026-11-24' });
  assert.deepEqual(periodRange('yesterday', 'Asia/Karachi', now), { from: '2026-11-23', to: '2026-11-23' });
});

test('periodRange week runs Monday to today', () => {
  // 2026-11-24 is a Tuesday, so the week starts Monday 2026-11-23.
  const now = new Date('2026-11-24T05:00:00Z');
  assert.deepEqual(periodRange('week', 'Asia/Karachi', now), { from: '2026-11-23', to: '2026-11-24' });
  // On a Monday the week starts that day.
  assert.deepEqual(periodRange('week', 'Asia/Karachi', new Date('2026-11-23T05:00:00Z')), {
    from: '2026-11-23',
    to: '2026-11-23',
  });
  // On a Sunday the week started the previous Monday.
  assert.deepEqual(periodRange('week', 'Asia/Karachi', new Date('2026-11-29T05:00:00Z')), {
    from: '2026-11-23',
    to: '2026-11-29',
  });
});

test('periodRange month runs from the 1st to today', () => {
  const now = new Date('2026-11-24T05:00:00Z');
  assert.deepEqual(periodRange('month', 'Asia/Karachi', now), { from: '2026-11-01', to: '2026-11-24' });
});

test('periodRange throws on an unknown period', () => {
  assert.throws(() => periodRange('decade', 'Asia/Karachi', new Date()), RangeError);
});

test('nowIso returns a UTC ISO string', () => {
  assert.equal(nowIso(new Date('2026-11-24T05:00:00Z')), '2026-11-24T05:00:00.000Z');
});

// ---- text ----

test('toAsciiDigits maps Urdu and Arabic-Indic digits to 0-9', () => {
  assert.equal(toAsciiDigits('۰۱۲۳۴۵۶۷۸۹'), '0123456789');
  assert.equal(toAsciiDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
  assert.equal(toAsciiDigits('abc 42'), 'abc 42');
});

test('normalizeText maps digits, removes thousands commas and unifies Arabic letters', () => {
  assert.equal(normalizeText('۵۰۰۰'), '5000');
  assert.equal(normalizeText('5,000'), '5000');
  assert.equal(normalizeText('5,000,000'), '5000000');
  assert.equal(normalizeText('يہ'), 'یہ');
  assert.equal(normalizeText('ك'), 'ک');
  assert.equal(normalizeText('ه'), 'ہ');
  assert.equal(normalizeText('ة'), 'ہ');
});

test('normalizeText splits digit-letter joints and removes punctuation', () => {
  assert.equal(normalizeText('5000روپے'), '5000 روپے');
  assert.equal(normalizeText('Rs5000'), 'rs 5000');
  assert.equal(normalizeText('Ali, aaj!'), 'ali aaj');
  assert.equal(normalizeText('  a   b  '), 'a b');
});

test('normalizeText keeps the decimal point between digits', () => {
  assert.equal(normalizeText('2.5 kg'), '2.5 kg');
});

test('normalizeText strips Arabic diacritics and tatweel', () => {
  assert.equal(normalizeText('بَ'), 'ب');
  assert.equal(normalizeText('کـــتاب'), 'کتاب');
});

test('tokenize splits digit-letter joints into tokens', () => {
  assert.deepEqual(tokenize('5000روپے'), ['5000', 'روپے']);
  assert.deepEqual(tokenize('aaj 5000 ki sale hui'), ['aaj', '5000', 'ki', 'sale', 'hui']);
});

test('isArabicScript detects Urdu, Pashto and Sindhi letters but not Latin', () => {
  assert.equal(isArabicScript('آج کی سیل'), true);
  assert.equal(isArabicScript('څلور'), true);
  assert.equal(isArabicScript('aaj ki sale'), false);
  assert.equal(isArabicScript('5000'), false);
});

test('titleCase capitalizes Latin words and leaves Arabic script unchanged', () => {
  assert.equal(titleCase('ahmed ali'), 'Ahmed Ali');
  assert.equal(titleCase('AHMED'), 'Ahmed');
  assert.equal(titleCase('احمد'), 'احمد');
});

// ---- logger ----

test('createLogger filters by level and writes ISO time + level', () => {
  const calls = { log: [], warn: [], error: [] };
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...a) => calls.log.push(a);
  console.warn = (...a) => calls.warn.push(a);
  console.error = (...a) => calls.error.push(a);
  try {
    const log = createLogger('warn');
    log.debug('hidden');
    log.info('hidden too');
    log.warn('visible warn', { a: 1 });
    log.error('visible error');
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
  assert.equal(calls.log.length, 0);
  assert.equal(calls.warn.length, 1);
  assert.equal(calls.error.length, 1);
  assert.match(calls.warn[0][0], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z WARN visible warn$/);
  assert.deepEqual(calls.warn[0][1], { a: 1 });
  assert.match(calls.error[0][0], / ERROR visible error$/);
});
