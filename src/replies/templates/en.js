// English replies (6.14). Helpers `h` come from replies/format.js.
// NOTE: intent and field labels stay in Roman Urdu for en, as format.js specifies.
export default {
  welcome: (d) =>
    `Welcome ${d.name}! Your bookkeeping is now on this WhatsApp number. Send a voice note or message, for example "5000 sale today". Send "help" for assistance.`,

  sale_recorded: (d, h) => {
    const detail = h.itemPhrase(d);
    const who = h.present(d.contactName)
      ? ` - ${d.contactName}${d.paymentMode === 'credit' ? ' (credit)' : ''}`
      : '';
    return `Sale recorded: ${h.formatRs(d.amount)}${detail ? ` - ${detail}` : ''}${who}. Entry #${d.txnNo}.${balTail(d, h)}`;
  },

  purchase_recorded: (d, h) => {
    const detail = h.itemPhrase(d);
    const who = h.present(d.contactName)
      ? ` - ${d.contactName}${d.paymentMode === 'credit' ? ' (credit)' : ''}`
      : '';
    return `Purchase recorded: ${h.formatRs(d.amount)}${detail ? ` - ${detail}` : ''}${who}. Entry #${d.txnNo}.${balTail(d, h)}`;
  },

  expense_recorded: (d, h) =>
    `Expense recorded: ${h.formatRs(d.amount)} (${d.category}). Entry #${d.txnNo}.`,

  payment_received_recorded: (d, h) =>
    `Payment received from ${d.contactName}: ${h.formatRs(d.amount)}. Entry #${d.txnNo}.${balTail(d, h)}`,

  payment_made_recorded: (d, h) =>
    `Payment made to ${d.contactName}: ${h.formatRs(d.amount)}. Entry #${d.txnNo}.${balTail(d, h)}`,

  credit_given_recorded: (d, h) =>
    `Credit given to ${d.contactName}: ${h.formatRs(d.amount)}. Entry #${d.txnNo}.${balTail(d, h)}`,

  credit_taken_recorded: (d, h) =>
    `Credit taken from ${d.contactName}: ${h.formatRs(d.amount)}. Entry #${d.txnNo}.${balTail(d, h)}`,

  undo_done: (d, h) =>
    `Entry #${d.txnNo} (${h.intentLabel(h.intentForTxnType(d.type), 'en')}) ${h.formatRs(d.amount)} has been cancelled.`,

  staff_added: (d) =>
    d.created === false
      ? `${d.staffName}'s number was updated: ${d.staffPhone}.`
      : `${d.staffName} (${d.staffPhone}) has been added as staff.`,

  task_assigned: (d, h) => {
    const due = h.present(d.dueDate) ? ` - due ${h.formatDate(d.dueDate)}` : '';
    const notice = d.staffNotified
      ? ` ${d.staffName} has been notified on WhatsApp.`
      : ` ${d.staffName} has no WhatsApp number on file, please tell them yourself.`;
    return `Task #${d.taskNo} assigned to ${d.staffName}: ${d.description}${due}.${notice}`;
  },

  task_notification: (d, h) => {
    const due = h.present(d.dueDate) ? ` - due ${h.formatDate(d.dueDate)}` : '';
    return `New task #${d.taskNo} from ${d.businessName}: ${d.description}${due}. When it is done, send "task ${d.taskNo} ho gaya".`;
  },

  task_completed: (d) => `Thank you! Task #${d.taskNo} marked complete: ${d.description}.`,

  task_completed_owner_notice: (d) => `${d.staffName} completed task #${d.taskNo}: ${d.description}.`,

  task_list: (d, h) => {
    const tasks = d.tasks ?? [];
    if (tasks.length === 0) return 'No open tasks.';
    const head = `Open tasks${h.present(d.staffName) ? ` (${d.staffName})` : ''}:`;
    const lines = tasks.map((t) =>
      `#${t.taskNo} ${t.description} - ${t.staffName}${h.present(t.dueDate) ? ` (due ${h.formatDate(t.dueDate)})` : ''}`,
    );
    return [head, ...lines].join('\n');
  },

  daily_summary: (d, h) => {
    const to = h.present(d.to) && d.to !== d.from ? ` to ${h.formatDate(d.to)}` : '';
    return [
      `${h.periodLabel(d.period, 'en')} summary (${h.formatDate(d.from)}${to}):`,
      `Sales: ${h.formatRs(d.sales)}`,
      `Purchases: ${h.formatRs(d.purchases)}`,
      `Expenses: ${h.formatRs(d.expenses)}`,
      `Received: ${h.formatRs(d.received)}`,
      `Paid: ${h.formatRs(d.paid)}`,
      `Estimated profit: ${h.formatRs(d.net)}`,
      `Cash: ${h.formatRs(d.cashBalance)}`,
      `Entries: ${d.txnCount}`,
    ].join('\n');
  },

  balance: (d, h) =>
    [
      `Cash: ${h.formatRs(d.cash)}`,
      `Bank: ${h.formatRs(d.bank)}`,
      `Receivables: ${h.formatRs(d.receivables)}`,
      `Payables: ${h.formatRs(d.payables)}`,
    ].join('\n'),

  contact_balance: (d, h) => h.balanceLine(d.contactName, d.balance, 'en'),

  help: () =>
    [
      'You can say or type:',
      '- "5000 sale today"',
      '- "Bought 10 thousand worth of goods from Bilal"',
      '- "Paid electricity bill 3500"',
      '- "Ahmed returned 5000"',
      '- "Gave Ahmed 2000 on credit"',
      '- "Give Ali a task: deliver cement by tomorrow"',
      '- "today\'s sales" / "balance" / "Ahmed ka hisaab"',
      '- "the last entry is wrong"',
    ].join('\n'),

  confirm_request: (d, h) => {
    const amount = h.present(d.amount) ? ` ${h.formatRs(d.amount)}` : '';
    const contact = h.present(d.contactName) ? ` - ${d.contactName}` : '';
    const staff = h.present(d.staffName) ? ` - ${d.staffName}` : '';
    const desc = h.present(d.description) ? ` - ${d.description}` : '';
    return `Please confirm: ${h.intentLabel(d.intent, 'en')}${amount}${contact}${staff}${desc}. Reply "haan" to confirm or "nahi" to cancel.`;
  },

  cancelled: () => 'OK, cancelled.',

  nothing_to_confirm: () => 'Nothing is waiting for confirmation.',

  missing_info: (d, h) =>
    `For ${h.intentLabel(d.intent, 'en')}, please tell me: ${(d.missing ?? []).map((f) => h.missingLabel(f, 'en')).join(', ')}. Please send the full sentence again.`,

  not_found_contact: (d) => `No account found named "${d.name}".`,

  not_found_staff: (d) =>
    `No staff member named "${d.name}" was found. Add them first: "${d.name} ko staff mein add karo 03XXXXXXXXX".`,

  not_found_task: (d, h) =>
    h.present(d.taskRef) ? `Task #${d.taskRef} not found.` : 'No open task found.',

  nothing_to_undo: () => 'No recent entry found to cancel.',

  phone_taken: (d) => `This number (${d.phone}) is already registered to another business.`,

  permission_denied: () => 'Sorry, only the owner can do this.',

  unknown: () => 'Sorry, I did not understand. Please say it again or send "help".',

  not_registered: () => 'This number is not registered. Please contact your owner.',

  error: () => 'Sorry, something went wrong. Please try again in a little while.',

  transcription_failed: () =>
    'Sorry, I could not make out the voice. Please speak clearly again or send it as text.',

  unsupported_message: () => 'Please send a voice note or a text message only.',
};

function balTail(d, h) {
  return h.present(d.contactBalance) ? ` ${h.balanceLine(d.contactName, d.contactBalance, 'en')}` : '';
}
