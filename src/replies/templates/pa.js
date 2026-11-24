// Punjabi (Shahmukhi) partial set (6.14). Missing keys fall back to ur, roman-ur, en.
import ur from './ur.js';
import { intentLabel, formatRs, present } from '../format.js';

export default {
  unknown: () => 'معاف کرنا، سمجھ نئیں آئی۔ دوبارہ بولو یا "help" لکھو۔',

  confirm_request: (d) =>
    `پکا کرو: ${intentLabel(d.intent, 'ur')}${present(d.amount) ? ` ${formatRs(d.amount)}` : ''}۔ ٹھیک اے تے "ہاں"، نئیں تے "نئیں"۔`,

  // Reuses the Urdu text, as 6.14 allows.
  help: ur.help,
  cancelled: ur.cancelled,
};
