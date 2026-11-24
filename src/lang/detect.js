// Language detection for transcripts / text messages (spec 6.6).
import { normalizeText, tokenize } from '../utils/text.js';

const WHISPER = {
  urdu: 'ur', ur: 'ur', punjabi: 'pa', pa: 'pa', pashto: 'ps', ps: 'ps', sindhi: 'sd', sd: 'sd',
  english: 'en', en: 'en', hindi: 'ur', hi: 'ur',
};

export function mapWhisperLanguage(name) {
  if (!name) return null;
  return WHISPER[String(name).trim().toLowerCase()] ?? null;
}

const SINDHI_RE = /[ٻڀٽٿٺڄڃڇڊڌڍڏڦڪڳڱ]/;
const PASHTO_RE = /[ټډړږښځڅڼېۍګ]/;
const DEVANAGARI_RE = /[\u0900-\u097F]/;
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

const norm = (arr) => new Set(arr.map((w) => normalizeText(w)));
const PA_WORDS = norm(['نوں', 'دا', 'دی', 'دے', 'اے', 'ویچیا', 'کیتا', 'کیتے', 'دسو', 'تسی', 'ساڈا', 'اج', 'نئیں', 'دتا']);
const UR_WORDS = norm(['کا', 'کی', 'کے', 'ہے', 'آج']);
const ROMAN_MARKERS = norm([
  'hai', 'hain', 'ka', 'ki', 'ke', 'ko', 'ne', 'se', 'kal', 'aaj', 'aj', 'hazar', 'hazaar', 'lakh', 'rupay', 'batao',
  'diye', 'diya', 'kiye', 'karo', 'wapas', 'udhaar', 'udhar', 'kharcha', 'becha', 'bechi', 'khareeda', 'kaam', 'haan',
  'nahi', 'mein', 'hisaab', 'nu', 'vechya', 'kitte', 'dasso',
]);

export function detectLanguage(text, { sttLanguage = null, fallback = 'roman-ur' } = {}) {
  const raw = text == null ? '' : String(text);
  if (!raw.trim()) return fallback;
  if (DEVANAGARI_RE.test(raw)) return 'ur';

  if (ARABIC_RE.test(raw)) {
    if (SINDHI_RE.test(raw)) return 'sd';
    if (PASHTO_RE.test(raw)) return 'ps';
    const hinted = mapWhisperLanguage(sttLanguage);
    if (hinted === 'pa' || hinted === 'ps' || hinted === 'sd') return hinted;
    const tokens = tokenize(raw);
    let score = 0;
    for (const t of tokens) {
      if (PA_WORDS.has(t)) score++;
      if (UR_WORDS.has(t)) score--;
    }
    return score >= 2 ? 'pa' : 'ur';
  }

  const tokens = tokenize(raw);
  // 'sale hui' counts as a marker phrase; 'hui' on its own is also a strong Roman Urdu signal.
  if (tokens.some((t) => ROMAN_MARKERS.has(t)) || (tokens.includes('sale') && tokens.includes('hui'))) return 'roman-ur';
  const alpha = tokens.filter((t) => /[a-z]/.test(t));
  if (alpha.length >= 2) return 'en';
  return fallback;
}
