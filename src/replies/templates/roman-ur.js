// Roman Urdu replies (6.14). Helpers `h` come from replies/format.js.
export default {
  welcome: (d) =>
    `Assalam o Alaikum ${d.name}! Aap ka hisaab-kitaab ab isi WhatsApp number par hai. Voice note ya message bhejein, jaise "aaj 5000 ki sale hui". Madad ke liye "help" bhejein.`,

  sale_recorded: (d, h) => {
    const detail = h.itemPhrase(d);
    const who = h.present(d.contactName)
      ? ` - ${d.contactName}${d.paymentMode === 'credit' ? ' (udhaar)' : ''}`
      : '';
    const bal = h.present(d.contactName) && h.present(d.contactBalance)
      ? ` ${h.balanceLine(d.contactName, d.contactBalance, 'roman-ur')}`
      : '';
    return `Sale darj ho gayi: ${h.formatRs(d.amount)}${detail ? ` - ${detail}` : ''}${who}. Entry #${d.txnNo}.${bal}`;
  },

  purchase_recorded: (d, h) => {
    const detail = h.itemPhrase(d);
    const who = h.present(d.contactName)
      ? ` - ${d.contactName}${d.paymentMode === 'credit' ? ' (udhaar)' : ''}`
      : '';
    const bal = h.present(d.contactName) && h.present(d.contactBalance)
      ? ` ${h.balanceLine(d.contactName, d.contactBalance, 'roman-ur')}`
      : '';
    return `Khareedari darj: ${h.formatRs(d.amount)}${detail ? ` - ${detail}` : ''}${who}. Entry #${d.txnNo}.${bal}`;
  },

  expense_recorded: (d, h) =>
    `Kharcha darj: ${h.formatRs(d.amount)} (${d.category}). Entry #${d.txnNo}.`,

  payment_received_recorded: (d, h) =>
    `${d.contactName} se ${h.formatRs(d.amount)} wusool darj. Entry #${d.txnNo}.${balTail(d, h)}`,

  payment_made_recorded: (d, h) =>
    `${d.contactName} ko ${h.formatRs(d.amount)} adaigi darj. Entry #${d.txnNo}.${balTail(d, h)}`,

  credit_given_recorded: (d, h) =>
    `${d.contactName} ko ${h.formatRs(d.amount)} udhaar diya darj. Entry #${d.txnNo}.${balTail(d, h)}`,

  credit_taken_recorded: (d, h) =>
    `${d.contactName} se ${h.formatRs(d.amount)} udhaar liya darj. Entry #${d.txnNo}.${balTail(d, h)}`,

  undo_done: (d, h) =>
    `Entry #${d.txnNo} (${h.intentLabel(h.intentForTxnType(d.type), 'roman-ur')}) ${h.formatRs(d.amount)} cancel kar di gayi.`,

  staff_added: (d) =>
    d.created === false
      ? `${d.staffName} ka number update ho gaya: ${d.staffPhone}.`
      : `${d.staffName} (${d.staffPhone}) ko mulazim ke taur par shamil kar liya gaya.`,

  task_assigned: (d, h) => {
    const due = h.present(d.dueDate) ? ` - aakhri tareekh ${h.formatDate(d.dueDate)}` : '';
    const notice = d.staffNotified
      ? ` ${d.staffName} ko WhatsApp par bata diya gaya.`
      : ` ${d.staffName} ka WhatsApp number darj nahi, unhein khud bata dein.`;
    return `Kaam #${d.taskNo} ${d.staffName} ko de diya gaya: ${d.description}${due}.${notice}`;
  },

  task_notification: (d, h) => {
    const due = h.present(d.dueDate) ? ` - ${h.formatDate(d.dueDate)} tak` : '';
    return `${d.businessName} ki taraf se naya kaam #${d.taskNo}: ${d.description}${due}. Kaam mukammal hone par "task ${d.taskNo} ho gaya" bhejein.`;
  },

  task_completed: (d) =>
    `Shukriya! Kaam #${d.taskNo} mukammal darj ho gaya: ${d.description}.`,

  task_completed_owner_notice: (d) =>
    `${d.staffName} ne kaam #${d.taskNo} mukammal kar diya: ${d.description}.`,

  task_list: (d, h) => {
    const tasks = d.tasks ?? [];
    if (tasks.length === 0) return 'Koi baqi kaam nahi.';
    const head = `Baqi kaam${h.present(d.staffName) ? ` (${d.staffName})` : ''}:`;
    const lines = tasks.map((t) =>
      `#${t.taskNo} ${t.description} - ${t.staffName}${h.present(t.dueDate) ? ` (${h.formatDate(t.dueDate)} tak)` : ''}`,
    );
    return [head, ...lines].join('\n');
  },

  daily_summary: (d, h) => {
    // NOTE: single-day periods show one date; ranges read "A se B tak" (from A to B).
    const to = h.present(d.to) && d.to !== d.from ? ` se ${h.formatDate(d.to)} tak` : '';
    return [
      `${h.periodLabel(d.period, 'roman-ur')} ka hisaab (${h.formatDate(d.from)}${to}):`,
      `Sale: ${h.formatRs(d.sales)}`,
      `Khareedari: ${h.formatRs(d.purchases)}`,
      `Kharcha: ${h.formatRs(d.expenses)}`,
      `Wusooli: ${h.formatRs(d.received)}`,
      `Adaigi: ${h.formatRs(d.paid)}`,
      `Munafa (andaza): ${h.formatRs(d.net)}`,
      `Galla (cash): ${h.formatRs(d.cashBalance)}`,
      `Kul entries: ${d.txnCount}`,
    ].join('\n');
  },

  balance: (d, h) =>
    [
      `Galla (cash): ${h.formatRs(d.cash)}`,
      `Bank: ${h.formatRs(d.bank)}`,
      `Logon ne dene hain: ${h.formatRs(d.receivables)}`,
      `Aap ne dene hain: ${h.formatRs(d.payables)}`,
    ].join('\n'),

  contact_balance: (d, h) => h.balanceLine(d.contactName, d.balance, 'roman-ur'),

  help: () =>
    [
      'Aap yeh bol ya likh sakte hain:',
      '- "aaj 5000 ki sale hui"',
      '- "Bilal se 10 hazar ka maal khareeda"',
      '- "bijli ka bill 3500 diya"',
      '- "Ahmed ne 5000 wapas kiye"',
      '- "Ahmed ko 2000 udhaar diya"',
      '- "Ali ko kal tak cement deliver karne ka kaam do"',
      '- "aaj ki sale batao" / "balance batao" / "Ahmed ka hisaab batao"',
      '- "pichli entry galat hai"',
    ].join('\n'),

  confirm_request: (d, h) => {
    const amount = h.present(d.amount) ? ` ${h.formatRs(d.amount)}` : '';
    const contact = h.present(d.contactName) ? ` - ${d.contactName}` : '';
    const staff = h.present(d.staffName) ? ` - ${d.staffName}` : '';
    const desc = h.present(d.description) ? ` - ${d.description}` : '';
    return `Tasdeeq karein: ${h.intentLabel(d.intent, 'roman-ur')}${amount}${contact}${staff}${desc}. Sahi hai to "haan" bhejein, warna "nahi".`;
  },

  cancelled: () => 'Theek hai, cancel kar diya.',

  nothing_to_confirm: () => 'Koi entry tasdeeq ke liye baqi nahi.',

  missing_info: (d, h) =>
    `${h.intentLabel(d.intent, 'roman-ur')} ke liye yeh batayein: ${(d.missing ?? []).map((f) => h.missingLabel(f, 'roman-ur')).join(', ')}. Dobara poora jumla bhejein.`,

  not_found_contact: (d) => `"${d.name}" naam ka koi khata nahi mila.`,

  not_found_staff: (d) =>
    `"${d.name}" naam ka koi mulazim nahi mila. Pehle add karein: "${d.name} ko staff mein add karo 03XXXXXXXXX".`,

  not_found_task: (d, h) =>
    h.present(d.taskRef) ? `Kaam #${d.taskRef} nahi mila.` : 'Koi khula kaam nahi mila.',

  nothing_to_undo: () => 'Cancel karne ke liye koi haaliya entry nahi mili.',

  phone_taken: (d) => `Yeh number (${d.phone}) kisi aur karobar mein darj hai.`,

  permission_denied: () => 'Maazrat, yeh kaam sirf maalik kar sakta hai.',

  unknown: () => 'Maazrat, samajh nahi aaya. Dobara bolein ya "help" bhejein.',

  not_registered: () => 'Yeh number registered nahi hai. Apne maalik se rabta karein.',

  error: () => 'Maazrat, koi masla aa gaya. Thori der baad dobara koshish karein.',

  transcription_failed: () =>
    'Maazrat, awaaz samajh nahi aayi. Dobara saaf awaaz mein bolein ya likh kar bhejein.',

  unsupported_message: () => 'Sirf voice note ya text message bhejein.',
};

// " Balance sentence" when the contact and its balance are known, otherwise ''.
function balTail(d, h) {
  return h.present(d.contactBalance) ? ` ${h.balanceLine(d.contactName, d.contactBalance, 'roman-ur')}` : '';
}
