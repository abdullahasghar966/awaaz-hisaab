import { createHmac, timingSafeEqual } from 'node:crypto';

// Meta signs the raw request body: X-Hub-Signature-256 = 'sha256=' + HMAC-SHA256(appSecret, rawBody) in hex.
function toBuffer(rawBody) {
  return Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8');
}

export function computeSignature(rawBody, appSecret) {
  return 'sha256=' + createHmac('sha256', String(appSecret)).update(toBuffer(rawBody)).digest('hex');
}

export function verifySignature(rawBody, header, appSecret) {
  // NOTE: without a secret nothing can be verified, so verification fails closed.
  if (!appSecret) return false;
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;

  const expected = Buffer.from(computeSignature(rawBody, appSecret), 'utf8');
  const actual = Buffer.from(header.trim(), 'utf8');
  // timingSafeEqual throws on unequal lengths, so a wrong length is a plain mismatch.
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
