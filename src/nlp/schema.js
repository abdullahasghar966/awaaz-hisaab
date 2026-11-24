// Intent catalogue, LLM output schema, normalization and validation (spec 5 and 6.7).
import { normalizePhone, isValidPkMobile } from '../utils/phone.js';

export const INTENTS = ['record_sale', 'record_purchase', 'record_expense', 'payment_received', 'payment_made',
  'credit_given', 'credit_taken', 'add_staff', 'assign_task', 'complete_task', 'list_tasks', 'daily_summary',
  'balance_query', 'contact_balance', 'undo_last', 'help', 'confirm', 'cancel', 'unknown'];

export const WRITE_INTENTS = ['record_sale', 'record_purchase', 'record_expense', 'payment_received', 'payment_made',
  'credit_given', 'credit_taken', 'add_staff', 'assign_task', 'complete_task', 'undo_last'];

export const LANGUAGES = ['ur', 'roman-ur', 'pa', 'ps', 'sd', 'en'];

export const ENTITY_FIELDS = ['amount', 'quantity', 'unit', 'item', 'contactName', 'paymentMode', 'category',
  'staffName', 'staffPhone', 'taskDescription', 'dueDate', 'taskRef', 'period', 'note'];

const PAYMENT_MODES = ['cash', 'credit', 'bank'];
const PERIODS = ['today', 'yesterday', 'week', 'month'];

// NOTE: complete_task has no hard requirement here (owners need a taskRef, but that is checked by the domain layer
// because staff may omit it).
export const INTENT_REQUIRED = {
  record_sale: ['amount'],
  record_purchase: ['amount'],
  record_expense: ['amount'],
  payment_received: ['amount', 'contactName'],
  payment_made: ['amount', 'contactName'],
  credit_given: ['amount', 'contactName'],
  credit_taken: ['amount', 'contactName'],
  add_staff: ['staffName', 'staffPhone'],
  assign_task: ['staffName', 'taskDescription'],
  complete_task: [],
  list_tasks: [],
  daily_summary: [],
  balance_query: [],
  contact_balance: ['contactName'],
  undo_last: [],
  help: [],
  confirm: [],
  cancel: [],
  unknown: [],
};

const nullable = (type, extra = {}) => ({ type: [type, 'null'], ...extra });

export const LLM_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'language', 'confidence', 'amount', 'quantity', 'unit', 'item', 'contactName', 'paymentMode',
    'category', 'staffName', 'staffPhone', 'taskDescription', 'dueDate', 'taskRef', 'period', 'note'],
  properties: {
    intent: { type: 'string', enum: [...INTENTS] },
    language: { type: 'string', enum: [...LANGUAGES] },
    confidence: { type: 'number' },
    amount: nullable('number'),
    quantity: nullable('number'),
    unit: nullable('string'),
    item: nullable('string'),
    contactName: nullable('string'),
    paymentMode: nullable('string', { enum: ['cash', 'credit', 'bank', null] }),
    category: nullable('string'),
    staffName: nullable('string'),
    staffPhone: nullable('string'),
    taskDescription: nullable('string'),
    dueDate: nullable('string'),
    taskRef: nullable('integer'),
    period: nullable('string', { enum: ['today', 'yesterday', 'week', 'month', null] }),
    note: nullable('string'),
  },
};

export function emptyEntities() {
  return Object.fromEntries(ENTITY_FIELDS.map((f) => [f, null]));
}

function str(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function positive(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function oneOf(v, list) {
  const s = str(v);
  if (!s) return null;
  const l = s.toLowerCase();
  return list.includes(l) ? l : null;
}

export function normalizeIntentResult(raw, provider) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const src = r.entities && typeof r.entities === 'object' ? r.entities : r;
  const e = emptyEntities();

  const amount = positive(src.amount);
  e.amount = amount === null ? null : Math.round(amount * 100) / 100;
  e.quantity = positive(src.quantity);
  e.unit = str(src.unit);
  e.item = str(src.item);
  e.contactName = str(src.contactName);
  e.paymentMode = oneOf(src.paymentMode, PAYMENT_MODES);
  e.category = str(src.category);
  e.staffName = str(src.staffName);
  const phone = str(src.staffPhone);
  e.staffPhone = phone ? normalizePhone(phone) : null;
  e.taskDescription = str(src.taskDescription);
  const due = str(src.dueDate);
  e.dueDate = due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null;
  const ref = positive(src.taskRef);
  e.taskRef = ref !== null && Number.isInteger(ref) ? ref : null;
  e.period = oneOf(src.period, PERIODS);
  e.note = str(src.note);

  const intent = INTENTS.includes(r.intent) ? r.intent : 'unknown';
  let confidence = Number(r.confidence);
  if (r.confidence === null || r.confidence === undefined || r.confidence === '' || !Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.min(1, Math.max(0, confidence));
  const language = LANGUAGES.includes(r.language) ? r.language : null;

  return { intent, entities: e, confidence, language, provider };
}

export function validateIntent(result) {
  const intent = result?.intent;
  const e = result?.entities ?? {};
  const missing = [...(INTENT_REQUIRED[intent] ?? [])].filter((f) => e[f] === null || e[f] === undefined);
  if ((intent === 'record_sale' || intent === 'record_purchase') && e.paymentMode === 'credit' && !e.contactName
    && !missing.includes('contactName')) {
    missing.push('contactName');
  }
  if (intent === 'add_staff' && !isValidPkMobile(e.staffPhone) && !missing.includes('staffPhone')) {
    missing.push('staffPhone');
  }
  return { ok: missing.length === 0, missing };
}
