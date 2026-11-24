import { formatRs } from '../utils/money.js';

export { formatRs };

// Labels are Roman Urdu for every language except Urdu, which gets Urdu script.
// NOTE: pa/ps/sd and en use these Roman Urdu labels too, as 6.14 specifies.
const INTENT_LABELS = {
  record_sale: { roman: 'Sale', ur: 'فروخت' },
  record_purchase: { roman: 'Khareedari', ur: 'خریداری' },
  record_expense: { roman: 'Kharcha', ur: 'خرچہ' },
  payment_received: { roman: 'Wusooli', ur: 'وصولی' },
  payment_made: { roman: 'Adaigi', ur: 'ادائیگی' },
  credit_given: { roman: 'Udhaar diya', ur: 'ادھار دیا' },
  credit_taken: { roman: 'Udhaar liya', ur: 'ادھار لیا' },
  add_staff: { roman: 'Naya mulazim', ur: 'نیا ملازم' },
  assign_task: { roman: 'Kaam', ur: 'کام' },
  complete_task: { roman: 'Kaam mukammal', ur: 'کام مکمل' },
  undo_last: { roman: 'Aakhri entry cancel', ur: 'آخری اندراج منسوخ' },
};

// Ledger transaction type -> intent, used by the undo reply.
const TXN_TYPE_INTENTS = {
  sale: 'record_sale',
  purchase: 'record_purchase',
  expense: 'record_expense',
  payment_in: 'payment_received',
  payment_out: 'payment_made',
  credit_given: 'credit_given',
  credit_taken: 'credit_taken',
};

const MISSING_LABELS = {
  amount: { roman: 'raqam', ur: 'رقم' },
  contactName: { roman: 'kis ka naam', ur: 'نام' },
  staffName: { roman: 'mulazim ka naam', ur: 'ملازم کا نام' },
  staffPhone: { roman: 'mobile number (03XX-XXXXXXX)', ur: 'موبائل نمبر' },
  taskDescription: { roman: 'kaam ki tafseel', ur: 'کام کی تفصیل' },
  taskRef: { roman: 'task number', ur: 'کام کا نمبر' },
};

const PERIOD_LABELS = {
  today: { roman: 'Aaj', ur: 'آج' },
  yesterday: { roman: 'Kal', ur: 'کل' },
  week: { roman: 'Is hafte', ur: 'اس ہفتے' },
  month: { roman: 'Is mahine', ur: 'اس مہینے' },
};

function pick(table, key, lang) {
  const entry = table[key];
  if (!entry) return key ?? '';
  return lang === 'ur' ? entry.ur : entry.roman;
}

// intent + lang -> label. Only 'ur' gets Urdu script; every other language uses the Roman Urdu label.
export function intentLabel(intent, lang = 'roman-ur') {
  return pick(INTENT_LABELS, intent, lang);
}

export function intentForTxnType(type) {
  return TXN_TYPE_INTENTS[type] ?? null;
}

// Label for a missing entity field, used by the missing_info reply.
export function missingLabel(field, lang = 'roman-ur') {
  return pick(MISSING_LABELS, field, lang);
}

// Label for a report period (today|yesterday|week|month).
export function periodLabel(period, lang = 'roman-ur') {
  return pick(PERIOD_LABELS, period, lang);
}

// True when a value should appear in a reply (null, undefined and '' are omitted; 0 is kept).
export function present(value) {
  return value !== null && value !== undefined && value !== '';
}

// '20 bori cement' style phrase from quantity, unit and item; '' when all are absent.
export function itemPhrase(d = {}) {
  return [d.quantity, d.unit, d.item].filter(present).join(' ');
}

// 'YYYY-MM-DD' -> 'DD-MM-YYYY'. Other input is returned as text.
// NOTE: digits stay ASCII in every language, matching formatRs.
export function formatDate(dateStr, lang = 'roman-ur') {
  void lang;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr ?? ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(dateStr ?? '');
}

// One sentence about a contact balance. balance > 0 means the contact owes us; < 0 means we owe them.
export function balanceLine(name, balance, lang = 'roman-ur') {
  const amount = Math.abs(Number(balance));
  const rs = formatRs(amount);
  const n = Number(balance);

  if (lang === 'ur') {
    if (n > 0) return `${name} کے ذمے ${rs} باقی ہیں۔`;
    if (n < 0) return `آپ نے ${name} کو ${rs} دینے ہیں۔`;
    return `${name} کا حساب برابر ہے۔`;
  }
  if (lang === 'en') {
    if (n > 0) return `${name} owes you ${rs}.`;
    if (n < 0) return `You owe ${name} ${rs}.`;
    return `${name}'s account is settled.`;
  }
  // roman-ur, and the fallback for any other language
  if (n > 0) return `${name} ne aap ko ${rs} dene hain.`;
  if (n < 0) return `Aap ne ${name} ko ${rs} dene hain.`;
  return `${name} ka hisaab barabar hai.`;
}
