import { withTransaction } from '../db/index.js';
import { fromPaisa, toPaisa } from '../utils/money.js';
import { nowIso, todayLocal } from '../utils/time.js';
import { DomainError } from './errors.js';

// 100 billion rupees: far beyond any real entry, but small enough that sums stay exact integers.
const MAX_PAISA = 1e13;
const DAY_MS = 24 * 60 * 60 * 1000;

function toPaisaChecked(amount) {
  let p;
  try {
    p = toPaisa(amount);
  } catch {
    throw new DomainError('INVALID_AMOUNT', 'Invalid amount', { amount });
  }
  if (!(p > 0) || !Number.isSafeInteger(p) || p > MAX_PAISA) throw new DomainError('INVALID_AMOUNT', 'Amount must be positive', { amount });
  return p;
}

export function createLedgerService(db, { clock, timezone, contacts }) {
  const q = {
    accountId: db.prepare('SELECT id FROM accounts WHERE business_id = ? AND code = ?'),
    nextTxnNo: db.prepare('SELECT COALESCE(MAX(txn_no), 0) + 1 AS n FROM transactions WHERE business_id = ?'),
    insTxn: db.prepare(
      `INSERT INTO transactions (business_id, txn_no, type, amount_paisa, payment_mode, contact_id, item, quantity,
         unit, category, note, txn_date, created_by, source_message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    insEntry: db.prepare(
      `INSERT INTO ledger_entries (transaction_id, business_id, account_id, contact_id, debit_paisa, credit_paisa)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    lastOwn: db.prepare(
      `SELECT id FROM transactions WHERE business_id = ? AND created_by = ? AND voided = 0 AND created_at >= ?
       ORDER BY id DESC LIMIT 1`,
    ),
    getTxn: db.prepare(
      `SELECT t.id, t.txn_no, t.type, t.amount_paisa, t.payment_mode, t.contact_id, t.txn_date, c.name AS contact_name
       FROM transactions t LEFT JOIN contacts c ON c.id = t.contact_id AND c.business_id = t.business_id
       WHERE t.business_id = ? AND t.id = ?`,
    ),
    voidTxn: db.prepare('UPDATE transactions SET voided = 1, voided_at = ? WHERE id = ? AND business_id = ?'),
    contactBalance: db.prepare(
      `SELECT COALESCE(SUM(CASE a.code WHEN 'AR' THEN le.debit_paisa - le.credit_paisa
                                       WHEN 'AP' THEN le.debit_paisa - le.credit_paisa ELSE 0 END), 0) AS bal
       FROM ledger_entries le
       JOIN transactions t ON t.id = le.transaction_id AND t.business_id = le.business_id
       JOIN accounts a ON a.id = le.account_id AND a.business_id = le.business_id
       WHERE le.business_id = ? AND le.contact_id = ? AND t.voided = 0`,
    ),
    accountTotals: db.prepare(
      `SELECT a.code, a.name, a.type,
              COALESCE(SUM(le.debit_paisa), 0) AS d, COALESCE(SUM(le.credit_paisa), 0) AS c
       FROM accounts a
       LEFT JOIN (SELECT le.account_id, le.debit_paisa, le.credit_paisa
                  FROM ledger_entries le JOIN transactions t ON t.id = le.transaction_id AND t.business_id = le.business_id
                  WHERE le.business_id = ? AND t.voided = 0) le ON le.account_id = a.id
       WHERE a.business_id = ?
       GROUP BY a.id ORDER BY a.id`,
    ),
    listTxns: db.prepare(
      `SELECT t.txn_no, t.type, t.amount_paisa, t.payment_mode, c.name AS contact_name, t.item, t.quantity, t.unit,
              t.category, t.note, t.txn_date, t.voided, t.created_at
       FROM transactions t LEFT JOIN contacts c ON c.id = t.contact_id AND c.business_id = t.business_id
       WHERE t.business_id = ? AND (? IS NULL OR t.txn_date >= ?) AND (? IS NULL OR t.txn_date <= ?)
       ORDER BY t.txn_no DESC LIMIT ?`,
    ),
    contactBalances: db.prepare(
      `SELECT c.id, c.name, c.type,
              COALESCE(SUM(CASE WHEN a.code IN ('AR','AP') AND t.voided = 0 THEN le.debit_paisa - le.credit_paisa ELSE 0 END), 0) AS bal
       FROM contacts c
       LEFT JOIN ledger_entries le ON le.contact_id = c.id AND le.business_id = c.business_id
       LEFT JOIN transactions t ON t.id = le.transaction_id AND t.business_id = le.business_id
       LEFT JOIN accounts a ON a.id = le.account_id AND a.business_id = le.business_id
       WHERE c.business_id = ?
       GROUP BY c.id ORDER BY c.name_norm`,
    ),
  };

  function accId(businessId, code) {
    const r = q.accountId.get(businessId, code);
    if (!r) throw new DomainError('UNBALANCED_ENTRY', `Missing account ${code}`, { code });
    return Number(r.id);
  }

  function getContactBalance(businessId, contactId) {
    return fromPaisa(Number(q.contactBalance.get(businessId, contactId).bal));
  }

  function txnResult(businessId, txnId) {
    const t = q.getTxn.get(businessId, txnId);
    return {
      txnId: Number(t.id),
      txnNo: Number(t.txn_no),
      type: t.type,
      amount: fromPaisa(Number(t.amount_paisa)),
      paymentMode: t.payment_mode,
      contact: t.contact_id ? { id: Number(t.contact_id), name: t.contact_name } : null,
      contactBalance: t.contact_id ? getContactBalance(businessId, Number(t.contact_id)) : null,
      txnDate: t.txn_date,
    };
  }

  // The single posting path. lines: [{ code, debit?, credit?, contactId? }] in paisa.
  // header: { type, amountPaisa, paymentMode, contactId, item, quantity, unit, category, note }
  function post(ctx, header, lines) {
    return withTransaction(db, () => {
      const { businessId } = ctx;
      if (!Number.isInteger(header.amountPaisa) || header.amountPaisa <= 0) {
        throw new DomainError('INVALID_AMOUNT', 'Amount must be positive');
      }
      if (!Array.isArray(lines) || lines.length < 2) {
        throw new DomainError('UNBALANCED_ENTRY', 'At least two lines required');
      }
      let debit = 0;
      let credit = 0;
      for (const l of lines) {
        debit += l.debit ?? 0;
        credit += l.credit ?? 0;
      }
      if (debit !== credit) {
        throw new DomainError('UNBALANCED_ENTRY', 'Debits must equal credits', { debit, credit });
      }
      const now = clock.now();
      const txnNo = Number(q.nextTxnNo.get(businessId).n);
      const txnId = Number(
        q.insTxn.run(
          businessId, txnNo, header.type, header.amountPaisa, header.paymentMode, header.contactId ?? null,
          header.item ?? null, header.quantity ?? null, header.unit ?? null, header.category ?? null,
          header.note ?? null, todayLocal(timezone, now), ctx.userId ?? null, ctx.sourceMessageId ?? null,
          nowIso(now),
        ).lastInsertRowid,
      );
      for (const l of lines) {
        q.insEntry.run(txnId, businessId, accId(businessId, l.code), l.contactId ?? null, l.debit ?? 0, l.credit ?? 0);
      }
      return txnResult(businessId, txnId);
    });
  }

  function needContact(ctx, contactName, typeHint) {
    if (!contactName || !String(contactName).trim()) {
      throw new DomainError('CONTACT_NOT_FOUND', 'Contact required');
    }
    return contacts.findOrCreate(ctx.businessId, contactName, typeHint);
  }

  const modeAccount = (mode) => (mode === 'bank' ? 'BANK' : 'CASH');

  function recordSale(ctx, { amount, contactName = null, paymentMode = 'cash', item = null, quantity = null, unit = null, note = null }) {
    const p = toPaisaChecked(amount);
    return withTransaction(db, () => {
      const credit = paymentMode === 'credit';
      const contact = credit
        ? needContact(ctx, contactName, 'customer')
        : contactName ? contacts.findOrCreate(ctx.businessId, contactName, 'customer') : null;
      const debitLine = credit
        ? { code: 'AR', debit: p, contactId: contact.id }
        : { code: modeAccount(paymentMode), debit: p };
      return post(
        ctx,
        { type: 'sale', amountPaisa: p, paymentMode, contactId: contact?.id, item, quantity, unit, note },
        [debitLine, { code: 'SALES', credit: p }],
      );
    });
  }

  function recordPurchase(ctx, { amount, contactName = null, paymentMode = 'cash', item = null, quantity = null, unit = null, note = null }) {
    const p = toPaisaChecked(amount);
    return withTransaction(db, () => {
      const credit = paymentMode === 'credit';
      const contact = credit
        ? needContact(ctx, contactName, 'supplier')
        : contactName ? contacts.findOrCreate(ctx.businessId, contactName, 'supplier') : null;
      const creditLine = credit
        ? { code: 'AP', credit: p, contactId: contact.id }
        : { code: modeAccount(paymentMode), credit: p };
      return post(
        ctx,
        { type: 'purchase', amountPaisa: p, paymentMode, contactId: contact?.id, item, quantity, unit, note },
        [{ code: 'PURCHASES', debit: p }, creditLine],
      );
    });
  }

  function recordExpense(ctx, { amount, category = 'general', paymentMode = 'cash', note = null }) {
    const p = toPaisaChecked(amount);
    // NOTE: credit mode is not allowed for expenses (per spec); it is treated as cash.
    const mode = paymentMode === 'bank' ? 'bank' : 'cash';
    return post(
      ctx,
      { type: 'expense', amountPaisa: p, paymentMode: mode, category: category ?? 'general', note },
      [{ code: 'EXPENSES', debit: p }, { code: modeAccount(mode), credit: p }],
    );
  }

  function recordPaymentReceived(ctx, { amount, contactName, paymentMode = 'cash' }) {
    const p = toPaisaChecked(amount);
    return withTransaction(db, () => {
      const contact = needContact(ctx, contactName, 'customer');
      // NOTE: 'credit' makes no sense for a payment; treat as cash.
      const mode = paymentMode === 'bank' ? 'bank' : 'cash';
      return post(
        ctx,
        { type: 'payment_in', amountPaisa: p, paymentMode: mode, contactId: contact.id },
        [{ code: modeAccount(mode), debit: p }, { code: 'AR', credit: p, contactId: contact.id }],
      );
    });
  }

  function recordPaymentMade(ctx, { amount, contactName, paymentMode = 'cash' }) {
    const p = toPaisaChecked(amount);
    return withTransaction(db, () => {
      const contact = needContact(ctx, contactName, 'supplier');
      const mode = paymentMode === 'bank' ? 'bank' : 'cash';
      return post(
        ctx,
        { type: 'payment_out', amountPaisa: p, paymentMode: mode, contactId: contact.id },
        [{ code: 'AP', debit: p, contactId: contact.id }, { code: modeAccount(mode), credit: p }],
      );
    });
  }

  function recordCreditGiven(ctx, { amount, contactName, note = null }) {
    const p = toPaisaChecked(amount);
    return withTransaction(db, () => {
      const contact = needContact(ctx, contactName, 'customer');
      return post(
        ctx,
        { type: 'credit_given', amountPaisa: p, paymentMode: 'credit', contactId: contact.id, note },
        [{ code: 'AR', debit: p, contactId: contact.id }, { code: 'CASH', credit: p }],
      );
    });
  }

  function recordCreditTaken(ctx, { amount, contactName, note = null }) {
    const p = toPaisaChecked(amount);
    return withTransaction(db, () => {
      const contact = needContact(ctx, contactName, 'supplier');
      return post(
        ctx,
        { type: 'credit_taken', amountPaisa: p, paymentMode: 'credit', contactId: contact.id, note },
        [{ code: 'CASH', debit: p }, { code: 'AP', credit: p, contactId: contact.id }],
      );
    });
  }

  function voidLastTransaction(ctx) {
    return withTransaction(db, () => {
      const since = new Date(clock.now().getTime() - DAY_MS).toISOString();
      const row = q.lastOwn.get(ctx.businessId, ctx.userId ?? -1, since);
      if (!row) throw new DomainError('NOTHING_TO_UNDO', 'Nothing to undo');
      q.voidTxn.run(nowIso(clock.now()), row.id, ctx.businessId);
      return txnResult(ctx.businessId, Number(row.id));
    });
  }

  function accountRows(businessId) {
    return q.accountTotals.all(businessId, businessId).map((r) => {
      const d = Number(r.d);
      const c = Number(r.c);
      const debitNormal = r.type === 'asset' || r.type === 'expense';
      return { code: r.code, name: r.name, type: r.type, d, c, bal: debitNormal ? d - c : c - d };
    });
  }

  function getBalances(businessId) {
    const by = Object.fromEntries(accountRows(businessId).map((r) => [r.code, r.bal]));
    return {
      cash: fromPaisa(by.CASH ?? 0),
      bank: fromPaisa(by.BANK ?? 0),
      receivables: fromPaisa(by.AR ?? 0),
      payables: fromPaisa(by.AP ?? 0),
    };
  }

  function trialBalance(businessId) {
    const rows = accountRows(businessId);
    return {
      accounts: rows.map((r) => ({
        code: r.code, name: r.name, type: r.type,
        debit: fromPaisa(r.d), credit: fromPaisa(r.c), balance: fromPaisa(r.bal),
      })),
      totalDebit: fromPaisa(rows.reduce((s, r) => s + r.d, 0)),
      totalCredit: fromPaisa(rows.reduce((s, r) => s + r.c, 0)),
    };
  }

  function listTransactions(businessId, { limit = 50, from = null, to = null } = {}) {
    return q.listTxns.all(businessId, from, from, to, to, limit).map((r) => ({
      txnNo: Number(r.txn_no),
      type: r.type,
      amount: fromPaisa(Number(r.amount_paisa)),
      paymentMode: r.payment_mode,
      contactName: r.contact_name,
      item: r.item,
      quantity: r.quantity,
      unit: r.unit,
      category: r.category,
      note: r.note,
      txnDate: r.txn_date,
      voided: r.voided === 1,
      createdAt: r.created_at,
    }));
  }

  function listContactBalances(businessId) {
    return q.contactBalances.all(businessId).map((r) => ({
      contactId: Number(r.id),
      name: r.name,
      type: r.type,
      balance: fromPaisa(Number(r.bal)),
    }));
  }

  return {
    recordSale,
    recordPurchase,
    recordExpense,
    recordPaymentReceived,
    recordPaymentMade,
    recordCreditGiven,
    recordCreditTaken,
    voidLastTransaction,
    getContactBalance,
    getBalances,
    listTransactions,
    listContactBalances,
    trialBalance,
  };
}
