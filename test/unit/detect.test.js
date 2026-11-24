import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, mapWhisperLanguage } from '../../src/lang/detect.js';

test('Urdu script', () => {
  assert.equal(detectLanguage('آج پانچ ہزار کی سیل ہوئی'), 'ur');
  assert.equal(detectLanguage('احمد کا ادھار کتنا ہے'), 'ur');
  assert.equal(detectLanguage('بلال سے ایک لاکھ کا مال خریدا'), 'ur');
});

test('Sindhi letters', () => {
  assert.equal(detectLanguage('اڄ پنج هزار جو سامان وڪرو'), 'sd');
  assert.equal(detectLanguage('ڏهه هزار جو سيمينٽ خريد ڪيو'), 'sd');
});

test('Pashto letters', () => {
  assert.equal(detectLanguage('نن مې پنځه زره روپۍ مال وپلوره'), 'ps');
  assert.equal(detectLanguage('احمد پنځه زره روپۍ بیرته راکړې'), 'ps');
});

test('Punjabi Shahmukhi', () => {
  assert.equal(detectLanguage('اج پنج ہزار دا مال ویچیا'), 'pa');
  assert.equal(detectLanguage('بجلی دا بل ساڈھے تن ہزار دتا'), 'pa');
});

test('sttLanguage punjabi with plain Urdu-script text -> pa', () => {
  assert.equal(detectLanguage('آج کا حساب بتاؤ', { sttLanguage: 'punjabi' }), 'pa');
  assert.equal(detectLanguage('آج کا حساب بتاؤ', { sttLanguage: 'urdu' }), 'ur');
});

test('Roman Urdu vs English', () => {
  assert.equal(detectLanguage('aaj 5000 ki sale hui'), 'roman-ur');
  assert.equal(detectLanguage('aj panj hazar da maal vechya'), 'roman-ur');
  assert.equal(detectLanguage('I sold five bags of cement today'), 'en');
});

test('Devanagari -> ur', () => {
  assert.equal(detectLanguage('आज पांच हज़ार की सेल'), 'ur');
});

test('empty and single-word fallbacks', () => {
  assert.equal(detectLanguage(''), 'roman-ur');
  assert.equal(detectLanguage('   ', { fallback: 'en' }), 'en');
  assert.equal(detectLanguage('madad'), 'roman-ur');
});

test('mapWhisperLanguage', () => {
  assert.equal(mapWhisperLanguage('urdu'), 'ur');
  assert.equal(mapWhisperLanguage('Punjabi'), 'pa');
  assert.equal(mapWhisperLanguage('ps'), 'ps');
  assert.equal(mapWhisperLanguage('sindhi'), 'sd');
  assert.equal(mapWhisperLanguage('english'), 'en');
  assert.equal(mapWhisperLanguage('hi'), 'ur');
  assert.equal(mapWhisperLanguage('french'), null);
  assert.equal(mapWhisperLanguage(null), null);
});
