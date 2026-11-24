import { fromPaisa } from '../utils/money.js';
import { periodRange } from '../utils/time.js';

export function createReportService(db, { clock, timezone, ledger }) {
  const sums = db.prepare(
    `SELECT type, COALESCE(SUM(amount_paisa), 0) AS total, COUNT(*) AS n
     FROM transactions
     WHERE business_id = ? AND voided = 0 AND txn_date BETWEEN ? AND ?
     GROUP BY type`,
  );

  function summary(businessId, period = 'today') {
    const { from, to } = periodRange(period, timezone, clock.now());
    const by = {};
    let count = 0;
    for (const r of sums.all(businessId, from, to)) {
      by[r.type] = Number(r.total);
      count += Number(r.n);
    }
    const g = (t) => by[t] ?? 0;
    return {
      period,
      from,
      to,
      sales: fromPaisa(g('sale')),
      purchases: fromPaisa(g('purchase')),
      expenses: fromPaisa(g('expense')),
      received: fromPaisa(g('payment_in')),
      paid: fromPaisa(g('payment_out')),
      creditGiven: fromPaisa(g('credit_given')),
      creditTaken: fromPaisa(g('credit_taken')),
      net: fromPaisa(g('sale') - g('purchase') - g('expense')),
      txnCount: count,
      cashBalance: ledger.getBalances(businessId).cash,
    };
  }

  return { summary };
}
