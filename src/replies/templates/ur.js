// Urdu script replies (6.14). Helpers `h` come from replies/format.js.
// Full stop is '۔' and the comma is '،'. Amounts keep ASCII digits from formatRs.
export default {
  welcome: (d) =>
    `السلام علیکم ${d.name}! آپ کا حساب کتاب اب اسی واٹس ایپ نمبر پر ہے۔ وائس نوٹ یا میسج بھیجیں، جیسے "آج 5000 کی سیل ہوئی"۔ مدد کے لیے "help" بھیجیں۔`,

  sale_recorded: (d, h) => {
    const detail = h.itemPhrase(d);
    const who = h.present(d.contactName)
      ? ` - ${d.contactName}${d.paymentMode === 'credit' ? ' (ادھار)' : ''}`
      : '';
    return `فروخت درج ہو گئی: ${h.formatRs(d.amount)}${detail ? ` - ${detail}` : ''}${who}۔ اندراج نمبر ${d.txnNo}۔${balTail(d, h)}`;
  },

  purchase_recorded: (d, h) => {
    const detail = h.itemPhrase(d);
    const who = h.present(d.contactName)
      ? ` - ${d.contactName}${d.paymentMode === 'credit' ? ' (ادھار)' : ''}`
      : '';
    return `خریداری درج: ${h.formatRs(d.amount)}${detail ? ` - ${detail}` : ''}${who}۔ اندراج نمبر ${d.txnNo}۔${balTail(d, h)}`;
  },

  expense_recorded: (d, h) =>
    `خرچہ درج: ${h.formatRs(d.amount)} (${d.category})۔ اندراج نمبر ${d.txnNo}۔`,

  payment_received_recorded: (d, h) =>
    `${d.contactName} سے ${h.formatRs(d.amount)} وصول درج۔ اندراج نمبر ${d.txnNo}۔${balTail(d, h)}`,

  payment_made_recorded: (d, h) =>
    `${d.contactName} کو ${h.formatRs(d.amount)} ادائیگی درج۔ اندراج نمبر ${d.txnNo}۔${balTail(d, h)}`,

  credit_given_recorded: (d, h) =>
    `${d.contactName} کو ${h.formatRs(d.amount)} ادھار دیا درج۔ اندراج نمبر ${d.txnNo}۔${balTail(d, h)}`,

  credit_taken_recorded: (d, h) =>
    `${d.contactName} سے ${h.formatRs(d.amount)} ادھار لیا درج۔ اندراج نمبر ${d.txnNo}۔${balTail(d, h)}`,

  undo_done: (d, h) =>
    `اندراج نمبر ${d.txnNo} (${h.intentLabel(h.intentForTxnType(d.type), 'ur')}) ${h.formatRs(d.amount)} منسوخ کر دی گئی۔`,

  staff_added: (d) =>
    d.created === false
      ? `${d.staffName} کا نمبر اپ ڈیٹ ہو گیا: ${d.staffPhone}۔`
      : `${d.staffName} (${d.staffPhone}) کو ملازم کے طور پر شامل کر لیا گیا۔`,

  task_assigned: (d, h) => {
    const due = h.present(d.dueDate) ? ` - آخری تاریخ ${h.formatDate(d.dueDate)}` : '';
    const notice = d.staffNotified
      ? ` ${d.staffName} کو واٹس ایپ پر بتا دیا گیا۔`
      : ` ${d.staffName} کا واٹس ایپ نمبر درج نہیں، انہیں خود بتا دیں۔`;
    return `کام نمبر ${d.taskNo} ${d.staffName} کو دے دیا گیا: ${d.description}${due}۔${notice}`;
  },

  task_notification: (d, h) => {
    const due = h.present(d.dueDate) ? ` - ${h.formatDate(d.dueDate)} تک` : '';
    return `${d.businessName} کی طرف سے نیا کام نمبر ${d.taskNo}: ${d.description}${due}۔ کام مکمل ہونے پر "task ${d.taskNo} ho gaya" بھیجیں۔`;
  },

  task_completed: (d) => `شکریہ! کام نمبر ${d.taskNo} مکمل درج ہو گیا: ${d.description}۔`,

  task_completed_owner_notice: (d) =>
    `${d.staffName} نے کام نمبر ${d.taskNo} مکمل کر دیا: ${d.description}۔`,

  task_list: (d, h) => {
    const tasks = d.tasks ?? [];
    if (tasks.length === 0) return 'کوئی باقی کام نہیں۔';
    const head = `باقی کام${h.present(d.staffName) ? ` (${d.staffName})` : ''}:`;
    const lines = tasks.map((t) =>
      `#${t.taskNo} ${t.description} - ${t.staffName}${h.present(t.dueDate) ? ` (${h.formatDate(t.dueDate)} تک)` : ''}`,
    );
    return [head, ...lines].join('\n');
  },

  daily_summary: (d, h) => {
    // NOTE: single-day periods show one date; ranges read "A سے B تک".
    const to = h.present(d.to) && d.to !== d.from ? ` سے ${h.formatDate(d.to)} تک` : '';
    return [
      `${h.periodLabel(d.period, 'ur')} کا حساب (${h.formatDate(d.from)}${to}):`,
      `سیل: ${h.formatRs(d.sales)}`,
      `خریداری: ${h.formatRs(d.purchases)}`,
      `خرچہ: ${h.formatRs(d.expenses)}`,
      `وصولی: ${h.formatRs(d.received)}`,
      `ادائیگی: ${h.formatRs(d.paid)}`,
      `منافع (اندازاً): ${h.formatRs(d.net)}`,
      `گلہ (کیش): ${h.formatRs(d.cashBalance)}`,
      `کل اندراج: ${d.txnCount}`,
    ].join('\n');
  },

  balance: (d, h) =>
    [
      `گلہ (کیش): ${h.formatRs(d.cash)}`,
      `بینک: ${h.formatRs(d.bank)}`,
      `لوگوں کے ذمے: ${h.formatRs(d.receivables)}`,
      `آپ کے ذمے: ${h.formatRs(d.payables)}`,
    ].join('\n'),

  contact_balance: (d, h) => h.balanceLine(d.contactName, d.balance, 'ur'),

  help: () =>
    [
      'آپ یہ بول یا لکھ سکتے ہیں:',
      '- "آج 5000 کی سیل ہوئی"',
      '- "بلال سے 10 ہزار کا مال خریدا"',
      '- "بجلی کا بل 3500 دیا"',
      '- "احمد نے 5000 واپس کیے"',
      '- "احمد کو 2000 ادھار دیا"',
      '- "علی کو کل تک سیمنٹ پہنچانے کا کام دو"',
      '- "آج کی سیل بتاؤ" / "بیلنس بتاؤ" / "احمد کا حساب بتاؤ"',
      '- "آخری اندراج غلط ہے"',
    ].join('\n'),

  confirm_request: (d, h) => {
    const amount = h.present(d.amount) ? ` ${h.formatRs(d.amount)}` : '';
    const contact = h.present(d.contactName) ? ` - ${d.contactName}` : '';
    const staff = h.present(d.staffName) ? ` - ${d.staffName}` : '';
    const desc = h.present(d.description) ? ` - ${d.description}` : '';
    return `تصدیق کریں: ${h.intentLabel(d.intent, 'ur')}${amount}${contact}${staff}${desc}۔ درست ہے تو "ہاں" بھیجیں، ورنہ "نہیں"۔`;
  },

  cancelled: () => 'ٹھیک ہے، منسوخ کر دیا۔',

  nothing_to_confirm: () => 'تصدیق کے لیے کوئی اندراج باقی نہیں۔',

  missing_info: (d, h) =>
    `${h.intentLabel(d.intent, 'ur')} کے لیے یہ بتائیں: ${(d.missing ?? []).map((f) => h.missingLabel(f, 'ur')).join('، ')}۔ دوبارہ پورا جملہ بھیجیں۔`,

  not_found_contact: (d) => `"${d.name}" نام کا کوئی کھاتہ نہیں ملا۔`,

  not_found_staff: (d) =>
    `"${d.name}" نام کا کوئی ملازم نہیں ملا۔ پہلے شامل کریں: "${d.name} کو staff میں add کرو 03XXXXXXXXX"۔`,

  not_found_task: (d, h) =>
    h.present(d.taskRef) ? `کام نمبر ${d.taskRef} نہیں ملا۔` : 'کوئی کھلا کام نہیں ملا۔',

  nothing_to_undo: () => 'منسوخ کرنے کے لیے کوئی حالیہ اندراج نہیں ملی۔',

  phone_taken: (d) => `یہ نمبر (${d.phone}) کسی اور کاروبار میں درج ہے۔`,

  permission_denied: () => 'معذرت، یہ کام صرف مالک کر سکتا ہے۔',

  unknown: () => 'معذرت، سمجھ نہیں آیا۔ دوبارہ بولیں یا "help" بھیجیں۔',

  not_registered: () => 'یہ نمبر رجسٹرڈ نہیں ہے۔ اپنے مالک سے رابطہ کریں۔',

  error: () => 'معذرت، کوئی مسئلہ آ گیا۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔',

  transcription_failed: () => 'معذرت، آواز سمجھ نہیں آئی۔ دوبارہ صاف آواز میں بولیں یا لکھ کر بھیجیں۔',

  unsupported_message: () => 'صرف وائس نوٹ یا ٹیکسٹ میسج بھیجیں۔',
};

function balTail(d, h) {
  return h.present(d.contactBalance) ? ` ${h.balanceLine(d.contactName, d.contactBalance, 'ur')}` : '';
}
