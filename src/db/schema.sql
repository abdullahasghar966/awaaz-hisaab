CREATE TABLE IF NOT EXISTS businesses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  owner_phone   TEXT NOT NULL UNIQUE,
  currency      TEXT NOT NULL DEFAULT 'PKR',
  timezone      TEXT NOT NULL DEFAULT 'Asia/Karachi',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  phone         TEXT UNIQUE,                       -- NULL allowed (staff without WhatsApp)
  name          TEXT NOT NULL,
  name_norm     TEXT NOT NULL,                     -- normalizeText(name)
  role          TEXT NOT NULL CHECK (role IN ('owner','staff')),
  language      TEXT NOT NULL DEFAULT 'roman-ur',  -- last detected reply language
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_business_name ON users(business_id, name_norm);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id   INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
  direction     TEXT NOT NULL CHECK (direction IN ('in','out')),
  phone         TEXT NOT NULL,                     -- sender (in) or recipient (out)
  wa_message_id TEXT UNIQUE,                       -- idempotency key (NULL allowed)
  msg_type      TEXT NOT NULL,                     -- text|audio|other
  body          TEXT,                              -- text body or reply text
  media_id      TEXT,
  transcript    TEXT,
  language      TEXT,
  intent        TEXT,
  intent_json   TEXT,
  status        TEXT NOT NULL DEFAULT 'received',  -- received|processed|error|ignored|sent|failed|simulated
  error         TEXT,
  in_reply_to   INTEGER REFERENCES messages(id),
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_messages_business ON messages(business_id, id);

CREATE TABLE IF NOT EXISTS contacts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  name_norm     TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('customer','supplier','both','other')),
  phone         TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (business_id, name_norm)
);

CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id   INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,     -- CASH, BANK, AR, AP, SALES, PURCHASES, EXPENSES, EQUITY
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  UNIQUE (business_id, code)
);

CREATE TABLE IF NOT EXISTS transactions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id       INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  txn_no            INTEGER NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('sale','purchase','expense','payment_in','payment_out','credit_given','credit_taken')),
  amount_paisa      INTEGER NOT NULL CHECK (amount_paisa > 0),
  payment_mode      TEXT NOT NULL DEFAULT 'cash' CHECK (payment_mode IN ('cash','credit','bank')),
  contact_id        INTEGER REFERENCES contacts(id),
  item              TEXT,
  quantity          REAL,
  unit              TEXT,
  category          TEXT,
  note              TEXT,
  txn_date          TEXT NOT NULL,
  created_by        INTEGER REFERENCES users(id),
  source_message_id INTEGER REFERENCES messages(id),
  voided            INTEGER NOT NULL DEFAULT 0,
  voided_at         TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE (business_id, txn_no)
);
CREATE INDEX IF NOT EXISTS ix_txn_business_date ON transactions(business_id, txn_date);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  business_id    INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  account_id     INTEGER NOT NULL REFERENCES accounts(id),
  contact_id     INTEGER REFERENCES contacts(id),   -- set ONLY on AR/AP lines
  debit_paisa    INTEGER NOT NULL DEFAULT 0 CHECK (debit_paisa >= 0),
  credit_paisa   INTEGER NOT NULL DEFAULT 0 CHECK (credit_paisa >= 0),
  CHECK ((debit_paisa = 0) <> (credit_paisa = 0))
);
CREATE INDEX IF NOT EXISTS ix_le_business_account ON ledger_entries(business_id, account_id);
CREATE INDEX IF NOT EXISTS ix_le_contact ON ledger_entries(business_id, contact_id);

CREATE TABLE IF NOT EXISTS tasks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id       INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  task_no           INTEGER NOT NULL,
  description       TEXT NOT NULL,
  assignee_user_id  INTEGER NOT NULL REFERENCES users(id),
  created_by        INTEGER REFERENCES users(id),
  due_date          TEXT,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  source_message_id INTEGER REFERENCES messages(id),
  created_at        TEXT NOT NULL,
  completed_at      TEXT,
  UNIQUE (business_id, task_no)
);

CREATE TABLE IF NOT EXISTS pending_confirmations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id  INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  intent_json  TEXT NOT NULL,
  source_message_id INTEGER REFERENCES messages(id),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);
