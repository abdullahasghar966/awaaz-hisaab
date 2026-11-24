// Lexicon for the rules parser (spec 6.4). Raw arrays/objects are exported, plus lookup structures
// whose keys are always passed through normalizeText so matching stays consistent with tokenize().
import { normalizeText, tokenize } from '../utils/text.js';

export const NUMBER_WORDS = {
  // Roman Urdu 1-10
  ek: 1, aik: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, panch: 5, paanch: 5, panj: 5,
  chhe: 6, chay: 6, che: 6, saat: 7, sat: 7, aath: 8, ath: 8, nau: 9, das: 10,
  // 11-19
  gyarah: 11, barah: 12, terah: 13, chaudah: 14, pandrah: 15, solah: 16, satrah: 17, atharah: 18, unees: 19,
  // tens
  bees: 20, pachees: 25, tees: 30, chalees: 40, pachas: 50, pachaas: 50, saath: 60, sattar: 70, assi: 80, nabbe: 90,
  // Urdu script
  'ایک': 1, 'دو': 2, 'تین': 3, 'چار': 4, 'پانچ': 5, 'چھ': 6, 'سات': 7, 'آٹھ': 8, 'نو': 9, 'دس': 10,
  'گیارہ': 11, 'بارہ': 12, 'تیرہ': 13, 'چودہ': 14, 'پندرہ': 15, 'سولہ': 16, 'سترہ': 17, 'اٹھارہ': 18, 'انیس': 19,
  'بیس': 20, 'پچیس': 25, 'تیس': 30, 'چالیس': 40, 'پچاس': 50, 'ساٹھ': 60, 'ستر': 70, 'اسی': 80, 'نوے': 90,
  // Punjabi
  'اک': 1, ikk: 1, 'تن': 3, 'پنج': 5, 'ست': 7, 'اٹھ': 8,
  // Pashto
  'یو': 1, 'دوه': 2, 'درې': 3, 'څلور': 4, 'پنځه': 5, 'شپږ': 6, 'اووه': 7, 'اته': 8, 'نهه': 9, 'لس': 10, 'شل': 20,
  // Sindhi
  'هڪ': 1, 'ٻه': 2, 'ٽي': 3, 'ڇهه': 6, 'اٺ': 8, 'ڏهه': 10, 'ويهه': 20,
};

export const FRACTIONS = {
  dedh: 1.5, deedh: 1.5, 'ڈیڑھ': 1.5,
  dhai: 2.5, dhaai: 2.5, adhai: 2.5, 'ڈھائی': 2.5, 'اڑھائی': 2.5,
  aadha: 0.5, 'آدھا': 0.5,
};

export const MODIFIERS = {
  sarhe: 0.5, saadhe: 0.5, sade: 0.5, saade: 0.5, saarhe: 0.5, sadhe: 0.5, 'ساڑھے': 0.5, 'ساڈھے': 0.5,
  sava: 0.25, sawa: 0.25, 'سوا': 0.25,
  paune: -0.25, 'پونے': -0.25,
};

export const HUNDRED = ['sau', 'سو', 'سل', 'سؤ'];

export const BIG = {
  hazar: 1000, hazaar: 1000, hzar: 1000, hajar: 1000, 'ہزار': 1000, 'هزار': 1000, 'زر': 1000, 'زره': 1000,
  lakh: 100000, lac: 100000, laakh: 100000, 'لاکھ': 100000, 'لکھ': 100000, 'لک': 100000,
  crore: 10000000, karor: 10000000, karod: 10000000, 'کروڑ': 10000000,
};

export const CURRENCY_WORDS = [
  'rs', 'rupay', 'rupaye', 'rupee', 'rupees', 'rupye', 'pkr',
  'روپے', 'روپیہ', 'روپئے', 'روپۍ', 'روپیو', 'رپیا',
];

// canonical unit -> spellings
export const UNIT_WORDS = {
  bori: ['bori', 'boriyan', 'بوری', 'بوریاں'],
  kg: ['kilo', 'kg', 'کلو'],
  maund: ['man', 'maund', 'من'],
  carton: ['dabba', 'dabbe', 'ڈبہ', 'carton'],
  piece: ['piece', 'pc', 'adad', 'عدد'],
  litre: ['litre', 'liter', 'لیٹر'],
  dozen: ['darjan', 'dozen', 'درجن'],
  bag: ['bag', 'bags'],
  ton: ['ton'],
  feet: ['feet', 'fut'],
};

export const PARTICLES = {
  agent: ['ne', 'نے'],
  dative: ['ko', 'کو', 'nu', 'noon', 'نوں'],
  ablative: ['se', 'سے', 'ton', 'توں'],
  genitive: ['ka', 'ki', 'ke', 'کا', 'کی', 'کے', 'da', 'di', 'de', 'دا', 'دی', 'دے'],
};

const BASE_STOPWORDS = [
  'aaj', 'aj', 'kal', 'parson', 'ne', 'ko', 'se', 'ka', 'ki', 'ke', 'hai', 'hain', 'tha', 'mein', 'main',
  'sale', 'maal', 'rupay', 'rs', 'hazar', 'lakh', 'sau', 'aur', 'bhi', 'ye', 'wo', 'us', 'is', 'mera', 'meri',
  'apna', 'total', 'entry', 'task', 'kaam', 'staff',
  'آج', 'کل', 'میں', 'اور', 'نے', 'کو', 'سے', 'کا', 'کی', 'کے', 'ہے', 'ہیں', 'مال', 'سیل', 'کام',
  // NOTE: extra function words that are never names (added beyond the spec list).
  'tak', 'تک', 'par', 'پر', 'ho', 'gaya', 'gaye', 'hui', 'hua', 'kiye', 'kiya', 'karo', 'karna', 'jo', 'جو',
  'number', 'no', 'نمبر', 'فہرست', 'kamon', 'kaamon', 'کاموں', 'tasks', 'dukaan', 'دکان', 'galle', 'گلے',
];

// Intent keyword phrases (raw). NOTE: the spec group "returned/received" is exposed as `received`.
export const INTENT_KEYWORDS = {
  query: ['batao', 'bataen', 'bataiye', 'bataao', 'dikhao', 'kitna', 'kitni', 'kitne', 'kya hai', 'dasso', 'daso',
    'بتاؤ', 'بتائیں', 'بتاو', 'دکھاؤ', 'کتنا', 'کتنی', 'کتنے', 'دسو', 'ووایه', 'ٻڌايو'],
  sale: ['bechi', 'becha', 'bechay', 'beche', 'bech', 'bechain', 'sale hui', 'sale ki', 'farokht', 'vechya', 'vechi',
    'بیچا', 'بیچی', 'بیچے', 'فروخت', 'سیل', 'ویچیا', 'وپلوره', 'وڪرو', 'وڪيو'],
  purchase: ['khareeda', 'kharida', 'khareedi', 'kharidi', 'khareede', 'purchase', 'mangwaya',
    'خریدا', 'خریدی', 'خریدے', 'منگوایا', 'واخیست', 'خريد'],
  expense: ['kharcha', 'kharch', 'expense', 'bill', 'kiraya', 'kiraaya', 'tankhwah', 'salary', 'bijli', 'gas bill',
    'petrol', 'diesel', 'chai', 'خرچہ', 'خرچ', 'بل', 'کرایہ', 'تنخواہ', 'بجلی'],
  udhaar: ['udhaar', 'udhar', 'udhaar par', 'qarz', 'qarza', 'credit', 'ادھار', 'قرض', 'قرضہ'],
  gave: ['diya', 'diye', 'di', 'de diye', 'de diya', 'dia', 'ada kiye', 'ada kiya', 'bheje', 'payment ki', 'dita',
    'ditte', 'دیا', 'دیے', 'دئیے', 'دی', 'دے دیے', 'ادا کیے', 'ادا کیا', 'بھیجے', 'دتا', 'ورکړل'],
  took: ['liya', 'liye', 'li', 'le liye', 'لیا', 'لیے', 'لی'],
  received: ['wapas', 'wapis', 'lautaye', 'wusool', 'wasool', 'mil gaye', 'mile', 'jama karaye', 'received',
    'واپس', 'وصول', 'مل گئے', 'ملے', 'راکړې', 'ڏنا'],
  task: ['kaam', 'kam', 'task', 'zimma', 'duty', 'کام', 'ذمہ',
    // NOTE: plural forms added so "کاموں کی فہرست دکھاؤ" reads as a task query.
    'کاموں', 'kaamon', 'kamon', 'tasks'],
  taskGive: ['kaam do', 'kaam de do', 'kam de do', 'kaam dena', 'task do', 'assign', 'کام دو', 'کام دے دو', 'ذمہ لگاؤ'],
  taskDone: ['ho gaya', 'hogaya', 'ho gya', 'mukammal', 'done', 'khatam', 'kar diya', 'poora',
    'ہو گیا', 'مکمل', 'ختم', 'کر دیا'],
  staff: ['staff', 'mulazim', 'worker', 'karigar', 'naukar', 'banda rakho', 'ملازم', 'سٹاف', 'کاریگر'],
  addVerb: ['add karo', 'add', 'shamil karo', 'rakh lo', 'bana do', 'شامل کرو', 'بنا دو', 'رکھ لو'],
  balance: ['balance', 'cash', 'galla', 'galle', 'paise', 'paisay', 'بیلنس', 'کیش', 'گلہ', 'گلے', 'پیسے'],
  ledgerWords: ['hisaab', 'hisab', 'khata', 'baqaya', 'udhaar', 'dene', 'lene', 'حساب', 'کھاتہ', 'بقایا', 'ادھار', 'دینے', 'لینے'],
  summary: ['sale', 'hisaab', 'hisab', 'report', 'khulasa', 'summary', 'kharcha', 'سیل', 'حساب', 'رپورٹ', 'خلاصہ'],
  undo: ['galat entry', 'ghalat', 'galat', 'undo', 'pichli entry', 'aakhri entry', 'last entry', 'hatao', 'mita do',
    'غلط', 'آخری اندراج', 'پچھلی انٹری', 'مٹا دو'],
  help: ['help', 'madad', 'kya kar sakte', 'مدد', 'ہیلپ'],
  confirm: ['haan', 'han', 'haa', 'ha', 'ji', 'jee', 'ji haan', 'ok', 'okay', 'theek', 'theek hai', 'thik hai', 'yes',
    'sahi', 'ho', 'ہاں', 'جی', 'ٹھیک', 'ٹھیک ہے', 'درست', 'هو', 'ها'],
  cancel: ['nahi', 'nahin', 'nai', 'na', 'no', 'cancel', 'mat karo', 'radd', 'rehne do', 'نہیں', 'نہ', 'نئیں', 'منسوخ', 'نه'],
};

export const DAY_WORDS = {
  today: ['aaj', 'aj', 'آج', 'اج', 'نن', 'اڄ'],
  nextOrPrev: ['kal', 'کل', 'سبا'],
  plus2: ['parson', 'پرسوں'],
  week: ['hafta', 'hafte', 'week', 'ہفتہ', 'ہفتے'],
  month: ['mahina', 'mahine', 'month', 'مہینہ', 'مہینے'],
};

export const EXPENSE_CATEGORIES = {
  electricity: ['bijli', 'بجلی', 'light bill'],
  rent: ['kiraya', 'کرایہ'],
  salary: ['tankhwah', 'salary', 'تنخواہ'],
  food: ['chai', 'khana', 'کھانا', 'چائے'],
  fuel: ['petrol', 'diesel', 'پٹرول'],
  transport: ['rickshaw', 'gaari', 'transport', 'bhara', 'بھاڑا'],
};

// ---- lookup structures (keys normalized) ----

function mapOf(obj) {
  const m = new Map();
  for (const [k, v] of Object.entries(obj)) m.set(normalizeText(k), v);
  return m;
}
function setOf(arr) {
  return new Set(arr.map((w) => normalizeText(w)).filter(Boolean));
}

export const NUMBER_MAP = mapOf(NUMBER_WORDS);
export const FRACTION_MAP = mapOf(FRACTIONS);
export const MODIFIER_MAP = mapOf(MODIFIERS);
export const HUNDRED_SET = setOf(HUNDRED);
export const BIG_MAP = mapOf(BIG);
export const CURRENCY_SET = setOf(CURRENCY_WORDS);

export const UNIT_MAP = new Map();
for (const [canonical, words] of Object.entries(UNIT_WORDS)) {
  for (const w of words) UNIT_MAP.set(normalizeText(w), canonical);
}

export const PARTICLE_SETS = Object.fromEntries(
  Object.entries(PARTICLES).map(([k, v]) => [k, setOf(v)]),
);

/** group -> array of token arrays (normalized phrases). */
export const INTENT_PHRASES = Object.fromEntries(
  Object.entries(INTENT_KEYWORDS).map(([g, list]) => [g, list.map((p) => tokenize(p)).filter((t) => t.length)]),
);

export const DAY_SETS = Object.fromEntries(Object.entries(DAY_WORDS).map(([k, v]) => [k, setOf(v)]));

export const CATEGORY_PHRASES = Object.fromEntries(
  Object.entries(EXPENSE_CATEGORIES).map(([c, list]) => [c, list.map((p) => tokenize(p))]),
);

/** Tokens that can never be (part of) a person's name. */
export const STOPWORD_SET = new Set(BASE_STOPWORDS.map((w) => normalizeText(w)));
for (const m of [NUMBER_MAP, FRACTION_MAP, MODIFIER_MAP, BIG_MAP, UNIT_MAP]) for (const k of m.keys()) STOPWORD_SET.add(k);
for (const s of [HUNDRED_SET, CURRENCY_SET, ...Object.values(DAY_SETS), ...Object.values(PARTICLE_SETS)]) {
  for (const k of s) STOPWORD_SET.add(k);
}
for (const phrases of Object.values(INTENT_PHRASES)) for (const p of phrases) for (const t of p) STOPWORD_SET.add(t);
