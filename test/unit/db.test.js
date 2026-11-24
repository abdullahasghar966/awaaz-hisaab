import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/db.js';
import { withTransaction } from '../../src/db/index.js';

const EXPECTED_TABLES = [
  'accounts',
  'businesses',
  'contacts',
  'ledger_entries',
  'messages',
  'pending_confirmations',
  'tasks',
  'transactions',
  'users',
];

function insertBusiness(db, phone = '923001234567') {
  const r = db
    .prepare('INSERT INTO businesses (name, owner_phone, created_at) VALUES (?, ?, ?)')
    .run('Test Shop', phone, '2026-11-24T05:00:00Z');
  return Number(r.lastInsertRowid);
}

function countBusinesses(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM businesses').get().n;
}

test('schema creates all tables', () => {
  const db = createTestDb();
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  const names = rows.map((r) => r.name);
  for (const table of EXPECTED_TABLES) {
    assert.ok(names.includes(table), `missing table ${table}`);
  }
  db.close();
});

test('openDatabase enables foreign keys', () => {
  const db = createTestDb();
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  db.close();
});

test('withTransaction commits on success', () => {
  const db = createTestDb();
  const id = withTransaction(db, () => insertBusiness(db));
  assert.ok(id > 0);
  assert.equal(countBusinesses(db), 1);
  db.close();
});

test('withTransaction returns the value of fn', () => {
  const db = createTestDb();
  assert.equal(withTransaction(db, () => 42), 42);
  db.close();
});

test('withTransaction rolls back when fn throws and rethrows', () => {
  const db = createTestDb();
  assert.throws(
    () =>
      withTransaction(db, () => {
        insertBusiness(db);
        throw new Error('boom');
      }),
    /boom/,
  );
  assert.equal(countBusinesses(db), 0);
  // The handle must be usable again afterwards (no dangling transaction).
  insertBusiness(db, '923000000001');
  assert.equal(countBusinesses(db), 1);
  db.close();
});

test('withTransaction is re-entrant: nested calls share the outer transaction', () => {
  const db = createTestDb();
  const result = withTransaction(db, () => {
    insertBusiness(db, '923000000001');
    const inner = withTransaction(db, () => {
      insertBusiness(db, '923000000002');
      return 'inner';
    });
    assert.equal(inner, 'inner');
    return 'outer';
  });
  assert.equal(result, 'outer');
  assert.equal(countBusinesses(db), 2);
  db.close();
});

test('re-entrant: an inner throw rolls back the whole outer transaction', () => {
  const db = createTestDb();
  assert.throws(() =>
    withTransaction(db, () => {
      insertBusiness(db, '923000000001');
      withTransaction(db, () => {
        insertBusiness(db, '923000000002');
        throw new Error('inner failure');
      });
    }),
  );
  assert.equal(countBusinesses(db), 0);
  db.close();
});

test('ledger CHECK rejects a line with both debit and credit', () => {
  const db = createTestDb();
  const businessId = insertBusiness(db);
  const accountId = Number(
    db
      .prepare("INSERT INTO accounts (business_id, code, name, type) VALUES (?, 'CASH', 'Cash in hand (Galla)', 'asset')")
      .run(businessId).lastInsertRowid,
  );
  const txnId = Number(
    db
      .prepare(
        `INSERT INTO transactions (business_id, txn_no, type, amount_paisa, txn_date, created_at)
         VALUES (?, 1, 'sale', 100000, '2026-11-24', '2026-11-24T05:00:00Z')`,
      )
      .run(businessId).lastInsertRowid,
  );

  assert.throws(
    () =>
      db
        .prepare(
          'INSERT INTO ledger_entries (transaction_id, business_id, account_id, debit_paisa, credit_paisa) VALUES (?, ?, ?, 100, 100)',
        )
        .run(txnId, businessId, accountId),
    /CHECK constraint failed/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          'INSERT INTO ledger_entries (transaction_id, business_id, account_id, debit_paisa, credit_paisa) VALUES (?, ?, ?, 0, 0)',
        )
        .run(txnId, businessId, accountId),
    /CHECK constraint failed/,
  );
  // A valid single-sided line is accepted.
  db.prepare(
    'INSERT INTO ledger_entries (transaction_id, business_id, account_id, debit_paisa, credit_paisa) VALUES (?, ?, ?, 100000, 0)',
  ).run(txnId, businessId, accountId);
  db.close();
});
