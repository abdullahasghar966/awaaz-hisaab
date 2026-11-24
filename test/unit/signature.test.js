import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSignature, verifySignature } from '../../src/whatsapp/signature.js';

const SECRET = 'test-app-secret';
const BODY = Buffer.from('{"object":"whatsapp_business_account"}', 'utf8');

test('computeSignature returns sha256= plus hex HMAC', () => {
  const sig = computeSignature(BODY, SECRET);
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
});

test('verifySignature accepts a valid signature', () => {
  const header = computeSignature(BODY, SECRET);
  assert.equal(verifySignature(BODY, header, SECRET), true);
});

test('verifySignature accepts a string body as well as a Buffer', () => {
  const header = computeSignature(BODY.toString('utf8'), SECRET);
  assert.equal(verifySignature(BODY, header, SECRET), true);
});

test('verifySignature rejects a tampered body', () => {
  const header = computeSignature(BODY, SECRET);
  const tampered = Buffer.from('{"object":"whatsapp_business_account","x":1}', 'utf8');
  assert.equal(verifySignature(tampered, header, SECRET), false);
});

test('verifySignature rejects a different secret', () => {
  const header = computeSignature(BODY, 'other-secret');
  assert.equal(verifySignature(BODY, header, SECRET), false);
});

test('verifySignature returns false for a missing or malformed header', () => {
  assert.equal(verifySignature(BODY, undefined, SECRET), false);
  assert.equal(verifySignature(BODY, '', SECRET), false);
  assert.equal(verifySignature(BODY, 'md5=abcdef', SECRET), false);
  assert.equal(verifySignature(BODY, computeSignature(BODY, SECRET).replace('sha256=', ''), SECRET), false);
});

test('verifySignature treats a wrong-length signature as a mismatch, not an exception', () => {
  assert.equal(verifySignature(BODY, 'sha256=abc', SECRET), false);
  assert.doesNotThrow(() => verifySignature(BODY, 'sha256=', SECRET));
});

test('verifySignature fails closed when no secret is configured', () => {
  assert.equal(verifySignature(BODY, computeSignature(BODY, SECRET), ''), false);
});
