// Pashto partial set (6.14). Missing keys fall back to ur, roman-ur, en.
import ur from './ur.js';
import { intentLabel, formatRs, present } from '../format.js';

export default {
  unknown: () => 'بښنه غواړم، پوه نه شوم. بیا ووایاست یا "help" ولیکئ.',

  confirm_request: (d) =>
    `تایید: ${intentLabel(d.intent, 'ur')}${present(d.amount) ? ` ${formatRs(d.amount)}` : ''}. که سم وي "هو" ووایاست، که نه "نه".`,

  // Reuses the Urdu text, as 6.14 allows.
  help: ur.help,
  cancelled: ur.cancelled,

  // Reuses the Urdu text, as the other partial keys do.
  stt_not_configured: ur.stt_not_configured,
};
