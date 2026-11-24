// Number-word and digit parsing for Urdu / Roman Urdu / Punjabi / Pashto / Sindhi / English (spec 6.5).
import { tokenize, toAsciiDigits } from '../utils/text.js';
import { PK_PHONE_RE } from '../utils/phone.js';
import {
  NUMBER_MAP, FRACTION_MAP, MODIFIER_MAP, HUNDRED_SET, BIG_MAP, CURRENCY_SET, UNIT_MAP,
  PARTICLE_SETS, STOPWORD_SET,
} from './lexicon.js';

const DIGITS_RE = /^\d+(\.\d+)?$/;
const K_RE = /^(\d+(\.\d+)?)k$/;
const PHONE_RE = new RegExp(PK_PHONE_RE.source, 'g');
const round2 = (n) => Math.round(n * 100) / 100;

function stripPhones(text) {
  return toAsciiDigits(String(text)).replace(PHONE_RE, ' ');
}

// Greedy sequence parser starting at token index i. Returns { value, end (exclusive), consumed, hasDigit, hasMult }.
function parseSequence(tokens, i) {
  let total = 0;
  let current = 0;
  let pending = 0;
  let consumed = false;
  let hasDigit = false;
  let hasMult = false;
  let lastDigit = false;
  let j = i;
  let end = i; // end of the last token that really belonged to the number
  for (; j < tokens.length; j++) {
    const t = tokens[j];
    if (/^\d{10,}$/.test(t)) break; // phone-like
    if (DIGITS_RE.test(t)) {
      if (lastDigit) break; // two adjacent plain numbers are two numbers
      current += Number(t);
      consumed = hasDigit = true;
      lastDigit = true;
    } else if (K_RE.test(t)) {
      if (lastDigit) break;
      current += Number(t.match(K_RE)[1]) * 1000;
      consumed = hasDigit = hasMult = true;
      lastDigit = true;
    } else if (NUMBER_MAP.has(t) || FRACTION_MAP.has(t)) {
      // NOTE: with digits already present ("5000 do", "5 hazar do") a bare number word is not part of the
      // number unless a hundred/big multiplier follows it; this keeps "kaam do" style words out of amounts.
      if (hasDigit) {
        const nxt = tokens[j + 1];
        if (lastDigit || !(HUNDRED_SET.has(nxt) || BIG_MAP.has(nxt))) break;
      }
      if (NUMBER_MAP.has(t)) current += NUMBER_MAP.get(t) + pending;
      else current += FRACTION_MAP.get(t);
      pending = 0;
      consumed = true;
      lastDigit = false;
    } else if (MODIFIER_MAP.has(t)) {
      pending = MODIFIER_MAP.get(t);
      lastDigit = false;
      continue; // not consumed by itself
    } else if (HUNDRED_SET.has(t)) {
      const base = current || (1 + pending);
      current = base * 100;
      pending = 0;
      consumed = hasMult = true;
      lastDigit = false;
    } else if (BIG_MAP.has(t)) {
      const base = current || (1 + pending);
      total += base * BIG_MAP.get(t);
      current = 0;
      pending = 0;
      consumed = hasMult = true;
      lastDigit = false;
    } else {
      break;
    }
    end = j + 1;
  }
  return { value: round2(total + current), end, consumed, hasDigit, hasMult };
}

export function wordsToNumber(str) {
  const tokens = tokenize(String(str));
  if (!tokens.length) return null;
  const s = parseSequence(tokens, 0);
  return s.consumed && s.end === tokens.length ? s.value : null;
}

const GENITIVE_CURRENCY = new Set([...PARTICLE_SETS.genitive, 'جو']);

function analyze(input) {
  const tokens = Array.isArray(input) ? input.map(String) : tokenize(stripPhones(input));
  const seqs = [];
  let i = 0;
  while (i < tokens.length) {
    const s = parseSequence(tokens, i);
    if (!s.consumed) { i++; continue; }
    const next = tokens[s.end];
    const unitAfter = next !== undefined && UNIT_MAP.has(next) ? UNIT_MAP.get(next) : null;
    let currencyAfter = next !== undefined && CURRENCY_SET.has(next);
    if (!currencyAfter && next !== undefined && GENITIVE_CURRENCY.has(next) && (s.hasDigit || s.hasMult)) {
      const after = tokens[s.end + 1];
      currencyAfter = after !== undefined && !UNIT_MAP.has(after);
    }
    // start/end are token indexes (end exclusive)
    seqs.push({
      value: s.value, start: i, end: s.end, hasDigit: s.hasDigit, hasMultiplier: s.hasMult, unitAfter, currencyAfter,
    });
    i = s.end;
  }
  return { tokens, seqs };
}

export function extractNumbers(textOrTokens) {
  return analyze(textOrTokens).seqs;
}

export function extractAmount(text) {
  const { seqs } = analyze(String(text));
  const cur = seqs.find((s) => s.currencyAfter && s.value > 0);
  if (cur) return cur.value;
  let best = null;
  for (const s of seqs) {
    if (s.unitAfter || !(s.hasDigit || s.hasMultiplier) || s.value <= 0) continue;
    if (best === null || s.value > best) best = s.value;
  }
  return best;
}

export function extractQuantity(text) {
  const { tokens, seqs } = analyze(String(text));
  const q = seqs.find((s) => s.unitAfter && s.value > 0);
  if (!q) return null;
  let item = null;
  for (let k = q.end + 1; k < tokens.length; k++) {
    if (!STOPWORD_SET.has(tokens[k]) && !/^\d/.test(tokens[k])) { item = tokens[k]; break; }
  }
  return { quantity: q.value, unit: q.unitAfter, item };
}
