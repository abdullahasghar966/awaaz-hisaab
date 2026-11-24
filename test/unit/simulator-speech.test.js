import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STT_LANGUAGES,
  STT_WAIT_MS,
  createSpeechSession,
  readSavedLanguage,
  saveLanguage,
  speechRecognitionCtor,
} from '../../public/dev/simulator.js';

// A stand-in for SpeechRecognition. stop() fires onend, as browsers do after the final result.
function fakeCtor({ endOnStop = true } = {}) {
  const instances = [];
  class FakeRecognition {
    constructor() {
      this.started = 0;
      this.stopped = 0;
      instances.push(this);
    }
    start() {
      this.started += 1;
    }
    stop() {
      this.stopped += 1;
      if (endOnStop) this.onend?.();
    }
  }
  FakeRecognition.instances = instances;
  return FakeRecognition;
}

const result = (transcript, isFinal) => Object.assign([{ transcript }], { isFinal });

test('STT_LANGUAGES lists the five languages with Urdu first', () => {
  assert.deepEqual(STT_LANGUAGES.map((l) => l.code), ['ur-PK', 'en-US', 'pa-Guru-IN', 'ps-AF', 'sd-IN']);
});

test('speechRecognitionCtor prefers the standard name, then the webkit prefix, else null', () => {
  const A = function A() {};
  const B = function B() {};
  assert.equal(speechRecognitionCtor({ SpeechRecognition: A, webkitSpeechRecognition: B }), A);
  assert.equal(speechRecognitionCtor({ webkitSpeechRecognition: B }), B);
  assert.equal(speechRecognitionCtor({}), null);
});

test('session configures continuous interim recognition and returns the final text', async () => {
  const Ctor = fakeCtor();
  const seen = [];
  const session = createSpeechSession(Ctor, { lang: 'ur-PK', onInterim: (t) => seen.push(t) });
  const rec = Ctor.instances[0];
  assert.equal(rec.lang, 'ur-PK');
  assert.equal(rec.continuous, true);
  assert.equal(rec.interimResults, true);
  assert.equal(rec.started, 1);

  rec.onresult({ resultIndex: 0, results: [result('aaj 5000', true)] });
  rec.onresult({ resultIndex: 1, results: [result('aaj 5000', true), result('ki sale', false)] });
  assert.deepEqual(seen, ['aaj 5000', 'aaj 5000 ki sale']);

  const out = await session.finish();
  assert.equal(rec.stopped, 1);
  assert.deepEqual(out, { text: 'aaj 5000 ki sale', blocked: false });
});

test('no recognized words resolves with empty text', async () => {
  const Ctor = fakeCtor();
  const session = createSpeechSession(Ctor, {});
  const out = await session.finish();
  assert.deepEqual(out, { text: '', blocked: false });
});

test('not-allowed marks the session blocked and reports the error', async () => {
  const Ctor = fakeCtor();
  const errors = [];
  const session = createSpeechSession(Ctor, { onError: (code) => errors.push(code) });
  Ctor.instances[0].onerror({ error: 'not-allowed' });
  assert.equal(session.blocked, true);
  assert.deepEqual(errors, ['not-allowed']);
  const out = await session.finish();
  assert.equal(out.blocked, true);
});

test('no-speech and aborted errors are not reported to the user', () => {
  const Ctor = fakeCtor();
  const errors = [];
  createSpeechSession(Ctor, { onError: (code) => errors.push(code) });
  Ctor.instances[0].onerror({ error: 'no-speech' });
  Ctor.instances[0].onerror({ error: 'aborted' });
  assert.deepEqual(errors, []);
});

test('the recognizer restarts when the browser ends it while the button is still held', () => {
  const Ctor = fakeCtor();
  createSpeechSession(Ctor, {});
  const rec = Ctor.instances[0];
  rec.onend();
  assert.equal(rec.started, 2);
});

test('finish gives up after STT_WAIT_MS when the browser never fires onend', async () => {
  const Ctor = fakeCtor({ endOnStop: false });
  const session = createSpeechSession(Ctor, {});
  const began = Date.now();
  const out = await session.finish();
  assert.ok(Date.now() - began >= STT_WAIT_MS - 50, 'waited about the configured time');
  assert.equal(out.text, '');
});

test('saved language is read back, and bad or unreadable storage falls back to ur-PK', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(readSavedLanguage(storage), 'ur-PK');
  saveLanguage('en-US', storage);
  assert.equal(readSavedLanguage(storage), 'en-US');
  store.set('awaaz-hisaab.sttLang', 'fr-FR');
  assert.equal(readSavedLanguage(storage), 'ur-PK');

  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(readSavedLanguage(broken), 'ur-PK');
  assert.doesNotThrow(() => saveLanguage('en-US', broken));
  assert.equal(readSavedLanguage(null), 'ur-PK');
});
