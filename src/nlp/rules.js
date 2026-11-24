// Deterministic rules parser (spec 6.8). First matching rule wins.
import { normalizeText, tokenize, titleCase } from '../utils/text.js';
import { extractPhone } from '../utils/phone.js';
import { addDays, todayLocal } from '../utils/time.js';
import { detectLanguage } from '../lang/detect.js';
import {
  INTENT_PHRASES, PARTICLE_SETS, STOPWORD_SET, DAY_SETS, CATEGORY_PHRASES,
} from './lexicon.js';
import { extractAmount, extractNumbers, extractQuantity } from './numbers.js';
import { normalizeIntentResult, validateIntent, emptyEntities } from './schema.js';

// ---- token helpers ----

function phraseAt(tokens, phrase, i) {
  for (let k = 0; k < phrase.length; k++) if (tokens[i + k] !== phrase[k]) return false;
  return true;
}
function findPhrase(tokens, phrase, from = 0) {
  for (let i = from; i + phrase.length <= tokens.length; i++) if (phraseAt(tokens, phrase, i)) return i;
  return -1;
}
function has(tokens, group) {
  return INTENT_PHRASES[group].some((p) => findPhrase(tokens, p) >= 0);
}
// True when the whole token list is made only of phrases of the group (greedy, longest first).
function coveredBy(tokens, group) {
  const phrases = [...INTENT_PHRASES[group]].sort((a, b) => b.length - a.length);
  let i = 0;
  while (i < tokens.length) {
    const p = phrases.find((ph) => phraseAt(tokens, ph, i));
    if (!p) return false;
    i += p.length;
  }
  return tokens.length > 0;
}
const anyIn = (tokens, set) => tokens.some((t) => set.has(t));
const isNumberish = (t) => /^\d/.test(t);
const isNameToken = (t) => !STOPWORD_SET.has(t) && !isNumberish(t);

const DATIVE = PARTICLE_SETS.dative;
const GENITIVE = PARTICLE_SETS.genitive;
const AGENT = PARTICLE_SETS.agent;
const ABLATIVE = PARTICLE_SETS.ablative;
const union = (...sets) => new Set(sets.flatMap((s) => [...s]));
const BANK_WORDS = new Set(['bank', 'online', 'easypaisa', 'jazzcash', 'cheque']);
const TASK_MARKERS = new Set(['task', 'kaam', 'kam', 'کام', 'number', 'no', '#', 'نمبر']);
const TAK = new Set(['tak', 'تک']);

const MONEY_INTENTS = new Set(['record_sale', 'record_purchase', 'record_expense', 'payment_received', 'payment_made',
  'credit_given', 'credit_taken']);

// ---- quickMatch ----

export function quickMatch(text) {
  const tokens = tokenize(String(text ?? ''));
  if (tokens.length === 0 || tokens.length > 3) return null;
  let intent = null;
  if (coveredBy(tokens, 'confirm')) intent = 'confirm';
  else if (coveredBy(tokens, 'cancel')) intent = 'cancel';
  else if (coveredBy(tokens, 'help')) intent = 'help';
  if (!intent) return null;
  return {
    intent,
    entities: emptyEntities(),
    confidence: 0.95,
    language: detectLanguage(text),
    provider: 'quick',
  };
}

// ---- entity helpers ----

function findKnown(tokens, list) {
  let best = null;
  for (const name of list ?? []) {
    const nt = tokenize(name);
    if (!nt.length) continue;
    const idx = findPhrase(tokens, nt);
    if (idx >= 0 && (!best || nt.length > best.len)) best = { name, idx, len: nt.length };
  }
  return best;
}

// 1-2 name tokens immediately before the first particle (of the given set) that has any.
function nameBefore(tokens, particles) {
  for (let i = 0; i < tokens.length; i++) {
    if (!particles.has(tokens[i])) continue;
    const parts = [];
    for (let k = i - 1; k >= 0 && parts.length < 2 && isNameToken(tokens[k]); k--) parts.unshift(tokens[k]);
    if (parts.length) return titleCase(parts.join(' '));
  }
  return null;
}

function resolveName(tokens, known, particles) {
  const k = findKnown(tokens, known);
  if (k) return k.name;
  return nameBefore(tokens, particles);
}

function dayOffset(tokens) {
  if (anyIn(tokens, DAY_SETS.today)) return 0;
  if (anyIn(tokens, DAY_SETS.nextOrPrev)) return 1;
  if (anyIn(tokens, DAY_SETS.plus2)) return 2;
  return null;
}

function periodOf(tokens) {
  if (anyIn(tokens, DAY_SETS.month)) return 'month';
  if (anyIn(tokens, DAY_SETS.week)) return 'week';
  if (anyIn(tokens, DAY_SETS.nextOrPrev)) return 'yesterday'; // for questions "kal" = yesterday
  return 'today';
}

function categoryOf(tokens) {
  for (const [cat, phrases] of Object.entries(CATEGORY_PHRASES)) {
    if (phrases.some((p) => p.length && findPhrase(tokens, p) >= 0)) return cat;
  }
  return 'general';
}

function taskRefOf(text) {
  const tokens = tokenize(text);
  const seqs = extractNumbers(tokens).filter((s) => Number.isInteger(s.value) && s.value > 0);
  for (const s of seqs) {
    if (s.start > 0 && TASK_MARKERS.has(tokens[s.start - 1])) return s.value;
  }
  return seqs.length === 1 ? seqs[0].value : null;
}

function taskDescriptionOf(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const nw = words.map((w) => normalizeText(w));
  const drop = new Array(words.length).fill(false);

  // staff name + dative particle at the start
  const d = nw.findIndex((w) => DATIVE.has(w));
  if (d >= 0 && d <= 2) for (let i = 0; i <= d; i++) drop[i] = true;

  // day word + tak
  for (let i = 0; i + 1 < nw.length; i++) {
    if ((DAY_SETS.today.has(nw[i]) || DAY_SETS.nextOrPrev.has(nw[i]) || DAY_SETS.plus2.has(nw[i])) && TAK.has(nw[i + 1])) {
      drop[i] = drop[i + 1] = true;
    }
  }

  // last trailing trigger phrase (+ the genitive particle before it)
  let cut = null;
  for (const p of INTENT_PHRASES.taskGive) {
    for (let i = nw.length - p.length; i >= 0; i--) {
      if (phraseAt(nw, p, i) && (!cut || i > cut.start)) { cut = { start: i, len: p.length }; break; }
    }
  }
  if (cut) {
    for (let i = cut.start; i < cut.start + cut.len; i++) drop[i] = true;
    if (cut.start > 0 && GENITIVE.has(nw[cut.start - 1])) drop[cut.start - 1] = true;
  }

  const kept = words.filter((_, i) => !drop[i]).join(' ').replace(/^[\s,.\-:]+|[\s,.\-:]+$/g, '');
  return kept || null;
}

// ---- decision tree ----

function decide(tokens, text, ctx) {
  const phone = extractPhone(text);
  const query = has(tokens, 'query') || /[?؟]\s*$/.test(String(text).trim());
  const udhaar = has(tokens, 'udhaar');
  const task = has(tokens, 'task');
  const taskDone = has(tokens, 'taskDone');
  const gave = has(tokens, 'gave');

  if (has(tokens, 'undo')) return ['undo_last', 0.9];
  if (tokens.length <= 4 && has(tokens, 'help')) return ['help', 0.9];
  if (has(tokens, 'staff') && phone) return ['add_staff', 0.9];
  if (has(tokens, 'taskGive') || (task && anyIn(tokens, DATIVE) && !query)) return ['assign_task', 0.9];
  if (task && taskDone) return ['complete_task', 0.9];
  if (taskDone && tokens.length <= 4) return ['complete_task', 0.9];
  if (task && query) return ['list_tasks', 0.9];

  if (query) {
    const ledger = has(tokens, 'ledgerWords');
    const hasGenitiveUdhaar = anyIn(tokens, GENITIVE) && udhaar;
    if (ledger || hasGenitiveUdhaar) {
      const name = resolveName(tokens, ctx.knownContacts, union(GENITIVE, AGENT));
      if (name) return ['contact_balance', 0.9];
    }
    if (has(tokens, 'balance')) return ['balance_query', 0.9];
    return ['daily_summary', 0.9];
  }

  if (udhaar && has(tokens, 'sale')) return ['record_sale', 0.9];
  if (udhaar && has(tokens, 'purchase')) return ['record_purchase', 0.9];
  if (udhaar && has(tokens, 'took')) return ['credit_taken', 0.9];
  if (udhaar && gave) return ['credit_given', 0.9];

  if (has(tokens, 'received') || (anyIn(tokens, AGENT) && gave)) return ['payment_received', 0.9];
  if (has(tokens, 'purchase')) return ['record_purchase', 0.9];
  if (has(tokens, 'sale')) return ['record_sale', 0.9];
  if (tokens.includes('sale') && extractAmount(text) !== null) return ['record_sale', 0.7];
  if (has(tokens, 'expense')) return ['record_expense', 0.9];
  if (anyIn(tokens, DATIVE) && gave && extractAmount(text) !== null) return ['payment_made', 0.7];
  return ['unknown', 0.3];
}

function buildEntities(intent, text, tokens, ctx, today) {
  const e = emptyEntities();
  const known = { contacts: ctx.knownContacts ?? [], staff: ctx.knownStaff ?? [] };

  if (MONEY_INTENTS.has(intent)) e.amount = extractAmount(text);
  if (intent === 'record_sale' || intent === 'record_purchase') {
    const q = extractQuantity(text);
    if (q) { e.quantity = q.quantity; e.unit = q.unit; e.item = q.item; }
  }

  if (MONEY_INTENTS.has(intent)) {
    // NOTE: credit_given/credit_taken are already udhaar by definition, so they carry no paymentMode.
    if (intent === 'credit_given' || intent === 'credit_taken') e.paymentMode = null;
    else if (has(tokens, 'udhaar') && intent !== 'record_expense') e.paymentMode = 'credit';
    else if (anyIn(tokens, BANK_WORDS)) e.paymentMode = 'bank';
    else e.paymentMode = 'cash';
  }

  switch (intent) {
    case 'record_sale':
    case 'credit_given':
    case 'payment_made':
      e.contactName = resolveName(tokens, known.contacts, DATIVE);
      break;
    case 'record_purchase':
    case 'credit_taken':
      e.contactName = resolveName(tokens, known.contacts, ABLATIVE);
      break;
    case 'payment_received':
      e.contactName = resolveName(tokens, known.contacts, union(AGENT, ABLATIVE));
      break;
    case 'contact_balance':
      e.contactName = resolveName(tokens, known.contacts, union(GENITIVE, AGENT));
      break;
    default:
  }

  if (intent === 'record_expense') e.category = categoryOf(tokens);

  if (intent === 'add_staff') {
    e.staffName = resolveName(tokens, known.staff, DATIVE);
    e.staffPhone = extractPhone(text);
  } else if (intent === 'assign_task') {
    e.staffName = resolveName(tokens, known.staff, DATIVE);
    e.taskDescription = taskDescriptionOf(text);
    const off = dayOffset(tokens);
    if (off !== null) e.dueDate = addDays(today, off);
  } else if (intent === 'list_tasks') {
    e.staffName = resolveName(tokens, known.staff, GENITIVE);
  } else if (intent === 'complete_task') {
    e.taskRef = taskRefOf(text);
  } else if (intent === 'daily_summary') {
    e.period = periodOf(tokens);
  }
  return e;
}

export function parseWithRules(text, ctx = {}) {
  const raw = String(text ?? '');
  const today = ctx.today ?? todayLocal('Asia/Karachi');
  const tokens = tokenize(raw);
  const language = detectLanguage(raw);
  const quick = quickMatch(raw);
  if (quick) return quick;

  const [intent, base] = decide(tokens, raw, ctx);
  const entities = intent === 'unknown' ? emptyEntities() : buildEntities(intent, raw, tokens, ctx, today);
  const result = normalizeIntentResult({ intent, entities, confidence: base, language }, 'rules');
  if (intent !== 'unknown' && !validateIntent(result).ok) result.confidence = Math.min(result.confidence, 0.6);
  return result;
}
