import { toAsciiDigits } from './text.js';

// Digits only, international form without '+'. '03..' (11 digits) -> countryCode + rest; '00..' -> rest.
export function normalizePhone(input, countryCode = '92') {
  if (input === null || input === undefined) return null;
  let digits = toAsciiDigits(String(input)).replace(/\D/g, '');
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = countryCode + digits.slice(1);
  }
  return digits.length >= 10 ? digits : null;
}

export function isValidPkMobile(p) {
  return /^923\d{9}$/.test(String(p));
}

export const PK_PHONE_RE = /(?<!\d)(?:\+?92[\s-]?|0)3\d{2}[\s-]?\d{3}[\s-]?\d{4}(?!\d)/;

export function extractPhone(text) {
  // Accepts "+92300...", "92300...", "0300..." and the spaced/dashed forms ("+92 300 1234567", "0300-123-4567").
  const match = toAsciiDigits(String(text)).match(PK_PHONE_RE);
  return match ? normalizePhone(match[0]) : null;
}
