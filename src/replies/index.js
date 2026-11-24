import * as format from './format.js';
import roman from './templates/roman-ur.js';
import ur from './templates/ur.js';
import en from './templates/en.js';
import pa from './templates/pa.js';
import ps from './templates/ps.js';
import sd from './templates/sd.js';

export const REPLY_KEYS = [
  'welcome',
  'sale_recorded',
  'purchase_recorded',
  'expense_recorded',
  'payment_received_recorded',
  'payment_made_recorded',
  'credit_given_recorded',
  'credit_taken_recorded',
  'undo_done',
  'staff_added',
  'task_assigned',
  'task_notification',
  'task_completed',
  'task_completed_owner_notice',
  'task_list',
  'daily_summary',
  'balance',
  'contact_balance',
  'help',
  'confirm_request',
  'cancelled',
  'nothing_to_confirm',
  'missing_info',
  'not_found_contact',
  'not_found_staff',
  'not_found_task',
  'nothing_to_undo',
  'phone_taken',
  'permission_denied',
  'unknown',
  'not_registered',
  'error',
  'transcription_failed',
  'unsupported_message',
];

const TEMPLATES = { ur, 'roman-ur': roman, en, pa, ps, sd };

// Order in which languages are tried for a reply. Pashto and Sindhi and Punjabi fall back to Urdu first.
export function fallbackChain(lang) {
  switch (lang) {
    case 'pa':
    case 'ps':
    case 'sd':
      return [lang, 'ur', 'roman-ur', 'en'];
    case 'ur':
      return ['ur', 'roman-ur', 'en'];
    case 'roman-ur':
      return ['roman-ur', 'en'];
    case 'en':
      return ['en', 'roman-ur'];
    default:
      return ['roman-ur', 'en'];
  }
}

// Renders a reply. The first template found along the fallback chain wins; an unknown key renders 'error'.
export function composeReply(key, data = {}, lang = 'roman-ur') {
  const resolvedKey = REPLY_KEYS.includes(key) ? key : 'error';
  const payload = data ?? {};

  for (const code of fallbackChain(lang)) {
    const render = TEMPLATES[code]?.[resolvedKey];
    if (typeof render === 'function') return render(payload, format);
  }
  // Unreachable: every chain ends in roman-ur or en, and both define every key.
  return TEMPLATES['roman-ur'].error(payload, format);
}
