// Text helpers shared by NLP, lexicon building and the domain layer.

// Eastern Arabic-Indic (U+0660..0669) and Extended Arabic-Indic / Urdu (U+06F0..06F9) digits -> 0-9.
export function toAsciiDigits(s) {
  return String(s)
    .replace(/[٠-٩]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x0660 + 48))
    .replace(/[۰-۹]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x06F0 + 48));
}

export function normalizeText(s) {
  let t = toAsciiDigits(s);                                  // 1
  t = t.toLowerCase();                                       // 2
  t = t.replace(/[ً-ٰٟـ]/g, '');         // 3 diacritics + tatweel
  t = t                                                      // 4 letter unification
    .replace(/[يى]/g, 'ی')                    //   ي ى -> ی
    .replace(/ك/g, 'ک')                            //   ك -> ک
    .replace(/[ةۃ]/g, 'ہ')                    //   ة ۃ -> ہ
    .replace(/ه/g, 'ہ');                           //   ه -> ہ (always, per 6.3 simplification)
  t = t.replace(/(\d),(?=\d{3})/g, '$1');                    // 5 thousands commas
  t = t.replace(/(\d)(?=[^\d\s.,k])/g, '$1 ');               // 6 digit-letter joints
  t = t.replace(/([^\d\s.])(?=\d)/g, '$1 ');                 //   letter-digit joints
  // 7 punctuation -> space. NOTE: '.' is also spaced unless it sits between two digits (decimal point).
  t = t.replace(/[،۔؟!?,;:"'()[\]/\-_]/g, ' ');
  t = t.replace(/(?<!\d)\.|\.(?!\d)/g, ' ');
  return t.replace(/\s+/g, ' ').trim();                      // 8 collapse + trim
}

export function tokenize(s) {
  return normalizeText(s).split(' ').filter(Boolean);
}

export function isArabicScript(s) {
  return /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/.test(String(s));
}

// Capitalizes Latin words only; Arabic-script text is returned unchanged.
export function titleCase(s) {
  return String(s).replace(/[A-Za-z]+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}
