import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWebhookPayload } from '../../src/whatsapp/parse.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/webhook/${name}.json`, import.meta.url), 'utf8'));

function wrap(messages, contacts = []) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'X', changes: [{ field: 'messages', value: { messages, contacts } }] }],
  };
}

test('text fixture becomes one text InboundMessage with profile name', () => {
  const [msg] = parseWebhookPayload(fixture('text'));
  assert.deepEqual(msg, {
    waMessageId: 'wamid.TEXT0001',
    from: '923001234567',
    type: 'text',
    text: 'aaj 5000 ki sale hui',
    mediaId: null,
    mimeType: null,
    profileName: 'Bilal Traders',
    timestamp: 1764000000,
  });
});

test('audio fixture (voice note) carries mediaId and mimeType', () => {
  const [msg] = parseWebhookPayload(fixture('audio'));
  assert.equal(msg.type, 'audio');
  assert.equal(msg.waMessageId, 'wamid.AUDIO0001');
  assert.equal(msg.mediaId, 'MEDIA_ID_0001');
  assert.equal(msg.mimeType, 'audio/ogg; codecs=opus');
  assert.equal(msg.text, null);
  assert.equal(msg.profileName, 'Bilal Traders');
});

test('status-only payload yields no messages', () => {
  assert.deepEqual(parseWebhookPayload(fixture('status')), []);
});

test('interactive button reply is treated as text', () => {
  const body = wrap([
    {
      from: '923001234567',
      id: 'wamid.BTN1',
      timestamp: '1764000100',
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'yes', title: 'haan' } },
    },
  ]);
  const [msg] = parseWebhookPayload(body);
  assert.equal(msg.type, 'text');
  assert.equal(msg.text, 'haan');
});

test('other message types (image) become type other', () => {
  const body = wrap([{ from: '923001234567', id: 'wamid.IMG1', type: 'image', image: { id: 'Y' } }]);
  const [msg] = parseWebhookPayload(body);
  assert.equal(msg.type, 'other');
  assert.equal(msg.text, null);
  assert.equal(msg.mediaId, null);
});

test('profileName is null when no contact matches the sender', () => {
  const body = wrap([{ from: '923009999999', id: 'wamid.Q1', type: 'text', text: { body: 'hi' } }]);
  const [msg] = parseWebhookPayload(body);
  assert.equal(msg.profileName, null);
});

test('malformed input returns [] and never throws', () => {
  const inputs = [
    null,
    undefined,
    'not json',
    42,
    {},
    { entry: 'bad' },
    { entry: [null, { changes: 'x' }] },
    { entry: [{ changes: [{ field: 'account_update' }] }] },
    wrap([null, {}, { id: 'a' }, { from: '9230', type: 'text' }]),
  ];
  for (const input of inputs) {
    assert.doesNotThrow(() => parseWebhookPayload(input));
    assert.deepEqual(parseWebhookPayload(input), []);
  }
});
