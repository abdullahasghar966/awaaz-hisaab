// Sindhi partial set (6.14). Missing keys fall back to ur, roman-ur, en.
import ur from './ur.js';
import { intentLabel, formatRs, present } from '../format.js';

export default {
  unknown: () => 'معاف ڪجو، سمجهه ۾ نه آيو. ٻيهر چئو يا "help" لکو.',

  confirm_request: (d) =>
    `تصديق: ${intentLabel(d.intent, 'ur')}${present(d.amount) ? ` ${formatRs(d.amount)}` : ''}. صحيح هجي ته "ها" چئو، نه ته "نه".`,

  // Reuses the Urdu text, as 6.14 allows.
  help: ur.help,
  cancelled: ur.cancelled,
};
