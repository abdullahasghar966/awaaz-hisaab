# Awaaz Hisaab: Voice-Driven Business Automation over WhatsApp
## Architecture and Implementation Plan (docs/ARCHITECTURE.md)

Read this whole document before writing code. Implement exactly what it says. If something is not specified, pick the simplest option that keeps every listed test passing, and add a `// NOTE:` comment explaining the choice.

---

## 1. Overview

Business owners in Pakistan send WhatsApp voice notes or text in Urdu, Roman Urdu, Punjabi, Pashto, Sindhi or English. The backend:
1. receives the Meta WhatsApp Cloud API webhook,
2. drops duplicates,
3. downloads the audio and transcribes it,
4. detects the language,
5. extracts the intent and its entities with Claude (`claude-haiku-5-5`, JSON-schema output), falling back to a deterministic rules parser,
6. validates the result, asks for confirmation if needed, and checks permissions,
7. runs the domain service (double-entry ledger, tasks, reports),
8. writes a localized reply and sends it back on WhatsApp,
9. logs everything.

Every external service has a mock, so `npm test` and the dev simulator work with no API keys at all.

Global conventions (mandatory):
- Node 24, ES modules (`"type": "module"`), Express 5, `node:sqlite` `DatabaseSync`, tests with `node:test` and `node:assert/strict`.
- Runtime dependencies: `express@5`, `dotenv`, `@anthropic-ai/sdk`. Nothing else, and no native modules. Use the global `fetch`, `FormData` and `Blob`.
- Money: **public JS APIs use rupees (Number, at most 2 decimals). The DB stores INTEGER paisa** (`*_paisa`). Convert only through `src/utils/money.js`.
- Phones: digits only in international form without `+`, e.g. `923001234567` (the same form Meta sends in `from`).
- Dates: `txn_date` and `due_date` are local `YYYY-MM-DD` strings in `config.timezone` (default `Asia/Karachi`). `created_at` columns are UTC ISO strings.
- Every DB query on business data MUST filter by `business_id` (data isolation).
- Every service is created through a factory function that takes `db` plus injected deps (`clock`, `timezone`). No module-level singletons except constants.
- `clock` = `{ now: () => Date }`. Tests inject a fixed clock.
- Identifiers in JS are camelCase. SQL columns are snake_case. Map between them in the repository code.

---

## 2. Architecture diagram

```
 WhatsApp user (voice/text)
        |
        v
 Meta Cloud API ──POST /webhook──> [routes/webhook.js]
                                     | verify X-Hub-Signature-256 (if META_APP_SECRET)
                                     | parseWebhookPayload() -> InboundMessage[]
                                     | respond 200 (immediately, or after processing if WEBHOOK_AWAIT)
 Dev: POST /dev/simulate ───────────>|  (dryRun: replies returned, not sent)
                                     v
                         [pipeline/orchestrator.handleIncoming]
  1 dedupe        messages.recordInbound(waMessageId)  --dup--> stop
  2 identify      businesses.findUserByPhone(from) --none--> registerOwner (AUTO_REGISTER) | not_registered
  3 media         whatsapp.downloadMedia(mediaId) | dev: audioPath/audioBase64
  4 STT           stt.transcribe(buffer) -> {text, language}
  5 lang detect   detectLanguage(text, {sttLanguage}) -> ur|roman-ur|pa|ps|sd|en
  6 NLP           nlp.parse(text, ctx) -> IntentResult   (quick-match -> LLM -> rules fallback)
  7 confirmation  pending? confirm->execute pending | cancel->clear | other->clear & continue
  8 validate      validateIntent -> missing_info
  9 permission    isAllowed(role, intent) -> permission_denied
 10 needs confirm amount>=threshold | low confidence | undo_last -> save pending, ask "haan/nahi"
 11 execute       handlers.execute -> ledger | tasks | reports | businesses  -> HandlerResult
 12 compose       composeReply(key, data, lang)  (+ notify staff/owner in their language)
 13 send          whatsapp.sendText(to, text)  (Graph /messages | mock outbox)
 14 log           messages.recordOutbound / updateInbound(status, transcript, intent)
                                     |
 Admin dashboard (/admin, Bearer ADMIN_TOKEN) <── read-only /api/admin/* ── SQLite (node:sqlite)
```

---

## 3. Folder and file tree

```
package.json                     deps, scripts (P1)
.env.example                     all env vars, documented (P1)
.gitignore                       node_modules, .env, data/ (P1)
README.md                        setup, run, demo, Meta setup steps (P5)
src/
  server.js                      entry: dotenv, loadConfig, createContainer, createApp, listen (P5)
  app.js                         createApp(container): express, json+rawBody, routers, static (P5)
  container.js                   createContainer(config, overrides): wires db, services, providers, pipeline (P5)
  config.js                      loadConfig(env) -> frozen Config (P1)
  db/
    schema.sql                   DDL (section 4) (P1)
    index.js                     openDatabase, withTransaction (P1)
  utils/
    money.js                     toPaisa, fromPaisa, formatRs (P1)
    phone.js                     normalizePhone, isValidPkMobile, extractPhone (P1)
    time.js                      todayLocal, addDays, periodRange, nowIso (P1)
    text.js                      normalizeText, toAsciiDigits, tokenize, isArabicScript, titleCase (P1)
    logger.js                    createLogger (P1)
  nlp/
    lexicon.js                   number words, multipliers, units, currency, particles, intent keywords (P2)
    numbers.js                   multilingual number parsing and amount/quantity extraction (P2)
    schema.js                    INTENTS, required entities, LLM JSON schema, normalize/validate (P2)
    rules.js                     deterministic rule-based parser (P2)
    llm.js                       Claude parser (P2)
    index.js                     createNlp: quick-match, provider select, fallback (P2)
  lang/
    detect.js                    detectLanguage, mapWhisperLanguage (P2)
  domain/
    errors.js                    DomainError (P3)
    businesses.js                businesses, owner/staff users (P3)
    contacts.js                  customers/suppliers (P3)
    ledger.js                    double-entry posting, balances, void (P3)
    tasks.js                     task assignment/completion (P3)
    reports.js                   period summaries (P3)
    messages.js                  message log + idempotency (P3)
    confirmations.js             pending confirmations (P3)
    index.js                     createServices(db, deps) (P3)
  stt/
    index.js                     createStt(config.stt) (P4)
    openai.js                    OpenAI transcription provider (P4)
    mock.js                      mock provider (P4)
  whatsapp/
    client.js                    createWhatsAppClient: meta + mock (P4)
    signature.js                 computeSignature, verifySignature (P4)
    parse.js                     parseWebhookPayload (P4)
  replies/
    index.js                     composeReply, REPLY_KEYS, fallbackChain (P4)
    format.js                    intentLabel, formatDate, balanceLine helpers (P4)
    templates/ur.js              Urdu script (full) (P4)
    templates/roman-ur.js        Roman Urdu (full) (P4)
    templates/en.js              English (full) (P4)
    templates/pa.js              Punjabi Shahmukhi (partial) (P4)
    templates/ps.js              Pashto (partial) (P4)
    templates/sd.js              Sindhi (partial) (P4)
  pipeline/
    handlers.js                  intent -> domain call -> HandlerResult; permissions; needsConfirmation (P5)
    orchestrator.js              createPipeline().handleIncoming (P5)
  routes/
    webhook.js                   GET verify, POST receive (P5)
    dev.js                       /dev/simulate, /dev/outbox (P5)
    admin.js                     /api/admin/* read-only (P5)
public/
  admin/index.html, admin/app.js, admin/style.css     dashboard (P4)
  dev/simulator.html, dev/simulator.js                chat simulator with mic recording (P4)
samples/.gitkeep                 DEV_AUDIO_DIR default (P5)
test/
  helpers/db.js                  createTestDb() (P1)
  helpers/clock.js               fixedClock(iso) (P1)
  helpers/app.js                 startTestServer(envOverrides) (P5)
  fixtures/audio/sale.ogg        fake bytes "OggS-fake-audio" (P5)
  fixtures/audio/sale.txt        "aaj 5000 ki sale hui" (P5)
  fixtures/webhook/text.json, audio.json, status.json   Meta payload samples (P4)
  unit/*.test.js, e2e/*.test.js  (see section 8)
```

---

## 4. Database schema (`src/db/schema.sql`)

`openDatabase(path)` runs `PRAGMA foreign_keys = ON;` and `PRAGMA journal_mode = WAL;` (WAL is skipped for `:memory:`), then runs this file with `db.exec`.

```sql
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
```

Default chart of accounts. Seed these when a business is created:

| code | name | type |
|---|---|---|
| CASH | Cash in hand (Galla) | asset |
| BANK | Bank / Mobile wallet | asset |
| AR | Receivables (Udhaar lena) | asset |
| AP | Payables (Udhaar dena) | liability |
| SALES | Sales | income |
| PURCHASES | Purchases | expense |
| EXPENSES | Expenses | expense |
| EQUITY | Owner equity | equity |

`txn_no` and `task_no` are assigned as `SELECT COALESCE(MAX(x_no),0)+1 ... WHERE business_id=?` inside `withTransaction`. This is safe because `DatabaseSync` is synchronous and there is one process.

---

## 5. Intent catalogue

### 5.1 Entities object (camelCase, every field always present, `null` if absent)

```js
{
  amount: number|null,          // rupees
  quantity: number|null,
  unit: string|null,            // bori, kg, maund, piece, litre, dozen, carton ...
  item: string|null,
  contactName: string|null,     // customer/supplier
  paymentMode: 'cash'|'credit'|'bank'|null,
  category: string|null,        // expense category: electricity|rent|salary|food|fuel|transport|general
  staffName: string|null,
  staffPhone: string|null,      // normalized 92XXXXXXXXXX
  taskDescription: string|null,
  dueDate: string|null,         // YYYY-MM-DD
  taskRef: number|null,         // task_no
  period: 'today'|'yesterday'|'week'|'month'|null,
  note: string|null
}
```

`IntentResult = { intent, entities, confidence (0..1), language (string|null), provider: 'llm'|'rules'|'quick', fallback?: boolean }`

### 5.2 Intents

| intent | required | optional | write? | staff allowed? |
|---|---|---|---|---|
| record_sale | amount (+contactName if paymentMode=credit) | contactName, paymentMode(default cash), item, quantity, unit, note | yes | yes |
| record_purchase | amount (+contactName if credit) | contactName, paymentMode, item, quantity, unit, note | yes | no |
| record_expense | amount | category(default general), paymentMode, note | yes | yes |
| payment_received | amount, contactName | paymentMode | yes | yes |
| payment_made | amount, contactName | paymentMode | yes | no |
| credit_given | amount, contactName | note | yes | no |
| credit_taken | amount, contactName | note | yes | no |
| add_staff | staffName, staffPhone | | yes | no |
| assign_task | staffName, taskDescription | dueDate | yes | no |
| complete_task | (taskRef required for owner) | taskRef | yes | yes |
| list_tasks | | staffName | no | yes (own only) |
| daily_summary | | period(default today) | no | no |
| balance_query | | | no | no |
| contact_balance | contactName | | no | no |
| undo_last | | | yes (always confirm) | no |
| help, confirm, cancel, unknown | | | no | yes |

`WRITE_INTENTS` = record_sale, record_purchase, record_expense, payment_received, payment_made, credit_given, credit_taken, add_staff, assign_task, complete_task, undo_last.

### 5.3 Example utterances (these double as test fixtures; the rules parser MUST pass the ones marked [R])

- **record_sale**: [R] `aaj 5000 ki sale hui` · [R] `20 bori cement 30 hazar ki bechi` (qty 20, unit bori, item cement, amount 30000) · [R] `Ahmed ko 8000 ka maal udhaar par becha` (credit, Ahmed) · [R] `آج پانچ ہزار کی سیل ہوئی` · Punjabi: `اج پنج ہزار دا مال ویچیا` / [R] `aj panj hazar da maal vechya` · Pashto: `نن مې پنځه زره روپۍ مال وپلوره` · Sindhi: `اڄ پنج هزار جو سامان وڪرو`
- **record_purchase**: [R] `Bilal se 1 lakh ka maal khareeda udhaar par` (credit, Bilal, 100000) · [R] `10 hazar ka cement khareeda` · `بلال سے ایک لاکھ کا مال خریدا` · Pashto `ما لس زره روپۍ سیمنټ واخیست` · Sindhi `ڏهه هزار جو سيمينٽ خريد ڪيو`
- **record_expense**: [R] `bijli ka bill 3500 diya` (electricity) · [R] `ڈھائی ہزار کا خرچہ ہوا` (2500) · [R] `dukaan ka kiraya 25 hazar diya` (rent) · Punjabi `بجلی دا بل ساڈھے تن ہزار دتا`
- **payment_received**: [R] `Ahmed ne 5000 wapas kiye` · [R] `احمد نے پانچ ہزار واپس کیے` · [R] `Ahmed se 2000 mil gaye` · Punjabi `Ahmad ne panj hazar wapis kitte` · Pashto `احمد پنځه زره روپۍ بیرته راکړې` · Sindhi `احمد پنج هزار واپس ڏنا`
- **payment_made**: [R] `Bilal ko 20 hazar ada kiye` · [R] `بلال کو بیس ہزار دے دیے`
- **credit_given**: [R] `Ahmed ko 2 hazar udhaar diya` · [R] `احمد کو دو ہزار ادھار دیا`
- **credit_taken**: [R] `Bilal se 50 hazar udhaar liya` · `بلال سے پچاس ہزار قرض لیا`
- **add_staff**: [R] `Kamran ko staff mein add karo 0300-1234567` · `کامران کو ملازم بنا دو 03001234567`
- **assign_task**: [R] `Ali ko kal tak 50 bori cement deliver karne ka kaam do` (staff Ali, due today+1) · `علی کو کل تک پچاس بوری سیمنٹ پہنچانے کا کام دو` · Punjabi `Ali nu kal tak 50 bori cement deliver karan da kam de do`
- **complete_task**: [R] `task 3 ho gaya` · [R] `kaam ho gaya` (staff: latest open own task) · `کام نمبر تین مکمل ہو گیا`
- **list_tasks**: [R] `kaam batao` · [R] `Ali ke kaam dikhao` · `کاموں کی فہرست دکھاؤ`
- **daily_summary**: [R] `aaj ki sale batao` · [R] `kal ka hisaab batao` (yesterday) · [R] `is mahine ka hisaab batao` (month) · `آج کا حساب بتاؤ` · Punjabi `aj di sale dasso` · Pashto `د نن ورځې حساب راته ووایه` · Sindhi `اڄ جو حساب ٻڌايو`
- **balance_query**: [R] `balance batao` · [R] `galle mein kitne paise hain` · `بیلنس بتاؤ`
- **contact_balance**: [R] `Ahmed ka hisaab batao` · [R] `احمد کا ادھار کتنا ہے` · `Ahmed ne kitne dene hain`
- **undo_last**: [R] `pichli entry galat hai cancel karo` · [R] `aakhri entry hatao` · `آخری اندراج غلط ہے`
- **help**: [R] `help` · [R] `madad` · `مدد`
- **confirm**: [R] `haan` `han` `ji` `jee` `ok` `theek hai` `yes` `ہاں` `جی` `ٹھیک ہے` `ho` `هو` `ها`
- **cancel**: [R] `nahi` `nahin` `na` `no` `cancel` `mat karo` `نہیں` `نہ` `نه` `منسوخ`
- **unknown**: [R] `mausam kaisa hai`

---

## 6. Module interface contracts

### 6.1 `src/config.js` (P1)
```js
export function loadConfig(env = process.env) /* -> Readonly<Config> (Object.freeze, deep) */
```
Config:
```js
{
  port: number, nodeEnv: string, dbPath: string, timezone: string, currency: 'PKR',
  autoRegister: boolean, devRoutes: boolean, devAudioDir: string /* absolute */, adminToken: string,
  webhookAwait: boolean, logLevel: 'debug'|'info'|'warn'|'error',
  whatsapp: { provider: 'meta'|'mock', verifyToken, appSecret, accessToken, phoneNumberId, graphVersion, graphBaseUrl },
  stt:  { provider: 'openai'|'mock', apiKey, model, language, baseUrl },
  nlp:  { provider: 'auto'|'llm'|'rules', apiKey, model, timeoutMs: number },
  confirm: { amountThreshold: number, minConfidence: number, ttlMinutes: number }
}
```
Rules:
- Booleans: `'true'|'1'|'yes'` count as true.
- `devRoutes` defaults to `nodeEnv !== 'production'`.
- `whatsapp.provider` defaults to `'meta'` when both accessToken and phoneNumberId are set, otherwise `'mock'`.
- `stt.provider` defaults to `'openai'` when `OPENAI_API_KEY` is set, otherwise `'mock'`.
- `nlp.provider` defaults to `'auto'`.
- Defaults for everything else are the values in `.env.example`.
- `loadConfig` does NOT import dotenv. `server.js` does (`import 'dotenv/config'`).

### 6.2 `src/db/index.js` (P1)
```js
export function openDatabase(path = ':memory:') /* -> DatabaseSync; mkdir parent dir if file path; apply pragmas + schema */
export function withTransaction(db, fn) /* BEGIN IMMEDIATE; r = fn(); COMMIT; return r. On throw: ROLLBACK, rethrow. Re-entrant: if already inside (track depth via WeakMap<db,number>), just call fn() */
```
`node:sqlite` notes:
- `import { DatabaseSync } from 'node:sqlite'`
- `stmt.run(...params)` returns `{changes, lastInsertRowid}`. Always wrap with `Number(...)`.
- `stmt.get()` and `stmt.all()` return plain objects.
- Use positional `?` params.

### 6.3 utils (P1)
```js
// money.js
export function toPaisa(rupees)            // Math.round(Number(rupees)*100); throws RangeError if not finite
export function fromPaisa(paisa)           // paisa/100
export function formatRs(rupees)           // 'Rs 1,50,000' (Intl 'en-IN' grouping, max 2 decimals, no '.00'); negatives -> 'Rs -500'
// phone.js
export function normalizePhone(input, countryCode = '92') // strip non-digits (after toAsciiDigits); '03..'(11 digits)->'92'+rest; '0092..'->'92..'; returns string|null if <10 digits
export function isValidPkMobile(p)         // /^923\d{9}$/
export function extractPhone(text)         // first match of /(\+?92|0)3\d{2}[\s-]?\d{7}/ on toAsciiDigits(text) -> normalized | null
// time.js
export function todayLocal(timezone, now = new Date())   // 'YYYY-MM-DD' via Intl.DateTimeFormat('en-CA',{timeZone})
export function addDays(dateStr, n)                       // pure UTC date arithmetic on YYYY-MM-DD
export function periodRange(period, timezone, now)        // today|yesterday|week (Mon..today)|month (1st..today) -> {from, to}
export function nowIso(now = new Date())                  // now.toISOString()
// text.js
export function toAsciiDigits(s)       // ۰-۹ (U+06F0..) and ٠-٩ (U+0660..) -> 0-9
export function normalizeText(s)       // see rules below
export function tokenize(s)            // normalizeText(s).split(' ').filter(Boolean)
export function isArabicScript(s)      // /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/
export function titleCase(s)           // Latin words capitalized; Arabic script unchanged
// logger.js
export function createLogger(level = 'info') // {debug,info,warn,error}(msg, obj?) -> console with ISO time + level; filtered by level
```
`normalizeText` steps, in order:
1. `toAsciiDigits`.
2. Lowercase.
3. Remove Arabic diacritics `[\u064B-\u065F\u0670]` and tatweel `\u0640`.
4. `ي`/`ى` → `ی`, `ك` → `ک`, `ة`/`ۃ` → `ہ`, `ه` → `ہ` (except when the text contains Pashto/Sindhi-specific letters; see 6.6).
5. Remove thousands commas: `/(\d),(?=\d{3})/g` → `$1`.
6. Split digit-letter joints: `/(\d)(?=[^\d\s.,k])/g` → `$1 `, plus the reverse `/([^\d\s.])(?=\d)/g` → `$1 `.
7. Replace `، ۔ ؟ ! ? , ; : " ' ( ) [ ] / - _` with spaces (keep `.` between digits).
8. Collapse whitespace and trim.

Simplification, chosen to keep things deterministic: ALWAYS map `ه` → `ہ` inside normalizeText. Lexicon keys are normalized with the same function at load time, so matching stays consistent.

### 6.4 `src/nlp/lexicon.js` (P2)
Exports raw arrays/objects. Every lookup Map is built by passing keys through `normalizeText`:
- `NUMBER_WORDS`: Roman Urdu 1-10 (`ek/aik 1, do 2, teen/tin 3, char/chaar 4, panch/paanch/panj 5, chhe/chay/che 6, saat/sat 7, aath/ath 8, nau/no? (only 'nau') 9, das 10`); 11-19 (`gyarah, barah, terah, chaudah, pandrah, solah, satrah, atharah, unees`); tens (`bees 20, pachees 25, tees 30, chalees 40, pachas/pachaas 50, saath 60, sattar 70, assi 80, nabbe 90`); Urdu script (`ایک دو تین چار پانچ چھ سات آٹھ نو دس گیارہ بارہ بیس پچیس تیس چالیس پچاس ساٹھ ستر اسی نوے`); Punjabi (`اک ikk 1, تن 3, پنج 5, ست 7, اٹھ 8`); Pashto (`یو 1, دوه 2, درې 3, څلور 4, پنځه 5, شپږ 6, اووه 7, اته 8, نهه 9, لس 10, شل 20`); Sindhi (`هڪ 1, ٻه 2, ٽي 3, پنج 5, ڇهه 6, ست 7, اٺ 8, ڏهه 10, ويهه 20`).
- `FRACTIONS`: `dedh/deedh/ڈیڑھ 1.5, dhai/dhaai/adhai/ڈھائی/اڑھائی 2.5, aadha/آدھا 0.5`
- `MODIFIERS`: `sarhe/saadhe/sade/ساڑھے/ساڈھے +0.5, sava/sawa/سوا +0.25, paune/پونے -0.25`
- `HUNDRED`: `sau/so? (only 'sau'), سو, سل (ps), سؤ (sd)` = 100
- `BIG`: `hazar/hazaar/hzar/hajar/ہزار/هزار/زر/زره 1000; lakh/lac/laakh/لاکھ/لکھ/لک 100000; crore/karor/karod/کروڑ 10000000`
- `CURRENCY_WORDS`: `rs, rupay, rupaye, rupee, rupees, rupye, pkr, روپے, روپیہ, روپئے, روپۍ, روپیو, رپیا`
- `UNIT_WORDS`: `bori/boriyan/بوری/بوریاں (bori), kilo/kg/کلو (kg), man/maund/من (maund), dabba/dabbe/ڈبہ (carton), carton, piece/pc/adad/عدد (piece), litre/liter/لیٹر (litre), darjan/dozen/درجن (dozen), bag/bags (bag), ton (ton), feet/fut (feet)`. Map each to a canonical unit.
- `PARTICLES`: `agent: ['ne','نے'], dative: ['ko','کو','nu','noon','نوں'], ablative: ['se','سے','ton','توں'], genitive: ['ka','ki','ke','کا','کی','کے','da','di','de','دا','دی','دے']`
- `STOPWORDS` (never a name): `aaj, aj, kal, parson, ne, ko, se, ka, ki, ke, ki, hai, hain, tha, mein, main, ne, sale, maal, rupay, rs, hazar, lakh, sau, aur, bhi, ye, wo, us, is, mera, meri, apna, total, entry, task, kaam, staff, آج, کل, میں, اور, نے, کو, سے, کا, کی, کے, ہے, ہیں, مال, سیل, کام` + all number/unit/currency words.
- `INTENT_KEYWORDS` (phrases are normalized token sequences):
  - `query`: `batao, bataen, bataiye, bataao, dikhao, kitna, kitni, kitne, kya hai, dasso, daso, بتاؤ, بتائیں, بتاو, دکھاؤ, کتنا, کتنی, کتنے, دسو, ووایه, ٻڌايو`
  - `sale`: `bechi, becha, bechay, beche, bech, bechain, sale hui, sale ki, farokht, vechya, vechi, بیچا, بیچی, بیچے, فروخت, سیل, ویچیا, وپلوره, وڪرو, وڪيو`
  - `purchase`: `khareeda, kharida, khareedi, kharidi, khareede, purchase, mangwaya, خریدا, خریدی, خریدے, منگوایا, واخیست, خريد`
  - `expense`: `kharcha, kharch, expense, bill, kiraya, kiraaya, tankhwah, salary, bijli, gas bill, petrol, diesel, chai, خرچہ, خرچ, بل, کرایہ, تنخواہ, بجلی`
  - `udhaar`: `udhaar, udhar, udhaar par, qarz, qarza, credit, ادھار, قرض, قرضہ`
  - `gave`: `diya, diye, di, de diye, de diya, dia, ada kiye, ada kiya, bheje, payment ki, dita, ditte, دیا, دیے, دئیے, دی, دے دیے, ادا کیے, ادا کیا, بھیجے, دتا, ورکړل`
  - `took`: `liya, liye, li, le liye, لیا, لیے, لی`
  - `returned/received`: `wapas, wapis, lautaye, wusool, wasool, mil gaye, mile, jama karaye, received, واپس, وصول, مل گئے, ملے, راکړې, ڏنا`
  - `task`: `kaam, kam, task, zimma, duty, کام, ذمہ`
  - `taskGive`: `kaam do, kaam de do, kam de do, kaam dena, task do, assign, کام دو, کام دے دو, ذمہ لگاؤ`
  - `taskDone`: `ho gaya, hogaya, ho gya, mukammal, done, khatam, kar diya, poora, ہو گیا, مکمل, ختم, کر دیا`
  - `staff`: `staff, mulazim, worker, karigar, naukar, banda rakho, ملازم, سٹاف, کاریگر`
  - `addVerb`: `add karo, add, shamil karo, rakh lo, bana do, شامل کرو, بنا دو, رکھ لو`
  - `balance`: `balance, cash, galla, galle, paise, paisay, بیلنس, کیش, گلہ, گلے, پیسے`
  - `ledgerWords`: `hisaab, hisab, khata, baqaya, udhaar, dene, lene, حساب, کھاتہ, بقایا, ادھار, دینے, لینے`
  - `summary`: `sale, hisaab, hisab, report, khulasa, summary, kharcha, سیل, حساب, رپورٹ, خلاصہ`
  - `undo`: `galat entry, ghalat, galat, undo, pichli entry, aakhri entry, last entry, hatao, mita do, غلط, آخری اندراج, پچھلی انٹری, مٹا دو`
  - `help`: `help, madad, kya kar sakte, مدد, ہیلپ`
  - `confirm`: `haan, han, haa, ha, ji, jee, ji haan, ok, okay, theek, theek hai, thik hai, yes, sahi, ho, ہاں, جی, ٹھیک, ٹھیک ہے, درست, هو, ها`
  - `cancel`: `nahi, nahin, nai, na, no, cancel, mat karo, radd, rehne do, نہیں, نہ, نئیں, منسوخ, نه`
- `DAY_WORDS`: `today: aaj, aj, آج, اج, نن, اڄ; nextOrPrev: kal, کل, سبا; plus2: parson, پرسوں; week: hafta, hafte, week, ہفتہ, ہفتے; month: mahina, mahine, month, مہینہ, مہینے`
- `EXPENSE_CATEGORIES`: `{ electricity: [bijli, بجلی, light bill], rent: [kiraya, کرایہ], salary: [tankhwah, salary, تنخواہ], food: [chai, khana, کھانا, چائے], fuel: [petrol, diesel, پٹرول], transport: [rickshaw, gaari, transport, bhara, بھاڑا] }`

### 6.5 `src/nlp/numbers.js` (P2)
```js
export function wordsToNumber(str)   // parse whole string as one number sequence -> number|null  ("do sau pachas" -> 250)
export function extractNumbers(textOrTokens) // -> Array<{ value, start, end, hasDigit, hasMultiplier, unitAfter: string|null, currencyAfter: boolean }>
export function extractAmount(text)  // -> number|null
export function extractQuantity(text) // -> { quantity, unit, item }|null
```
Sequence parser (applied at every token index, greedy):
```
total=0, current=0, pending=0, consumed=false, hasDigit=false, hasMult=false
for token t:
  if /^\d+(\.\d+)?$/            -> current += Number(t); consumed=hasDigit=true
  elif /^(\d+(\.\d+)?)k$/        -> current += n*1000; consumed=hasDigit=hasMult=true
  elif NUMBER_WORDS has t        -> current += v + pending; pending=0; consumed=true
  elif FRACTIONS has t           -> current += v; consumed=true
  elif MODIFIERS has t           -> pending = v; (does not set consumed by itself)
  elif HUNDRED has t             -> base = current || (1+pending); current = base*100; pending=0; consumed=hasMult=true
  elif BIG has t                 -> base = current || (1+pending); total += base*mult; current=0; pending=0; consumed=hasMult=true
  else break
value = round2(total + current)
```
Skip tokens that are 10+ digit numbers (phones). `extractAmount` removes `extractPhone` matches first.

Amount selection:
1. The first sequence with `currencyAfter` (the next token is a currency word, or `ka/ki/ke/کا/کی/کے/da/di/جو` followed by a non-unit token).
2. Otherwise, the largest sequence that is not followed by a unit word AND (hasDigit OR hasMultiplier).
3. Otherwise `null`.

A word-only sequence without a multiplier (e.g. `do` in `kaam do`) is NEVER an amount unless it is followed by a currency word.

Quantity: the first sequence followed by a unit word. `item` = the next non-stopword token after the unit, if any.

Required results:
- `5000`, `5,000`, `۵۰۰۰`, `5k`, `5 hazar`, `panch hazar`, `پانچ ہزار` → 5000
- `2.5 lakh` → 250000, `ڈیڑھ لاکھ` → 150000, `sarhe teen hazar` → 3500, `dhai hazaar` → 2500, `ek hazar paanch sau` → 1500, `do sau pachas` → 250, `sava sau` → 125, `paune do lakh` → 175000, `پنځه زره` → 5000, `ڏهه هزار` → 10000, `1250.50` → 1250.5.

### 6.6 `src/lang/detect.js` (P2)
```js
export function detectLanguage(text, { sttLanguage = null, fallback = 'roman-ur' } = {}) // -> 'ur'|'roman-ur'|'pa'|'ps'|'sd'|'en'
export function mapWhisperLanguage(name) // 'urdu'|'ur'->'ur', 'punjabi'|'pa'->'pa', 'pashto'|'ps'->'ps', 'sindhi'|'sd'->'sd', 'english'|'en'->'en', 'hindi'|'hi'->'ur', else null
```
Algorithm (works on the raw text, before normalization):
1. Empty → fallback.
2. Devanagari `[\u0900-\u097F]` present → `'ur'`.
3. Arabic script:
   - Any Sindhi letter `[ٻڀٽٿٺڄڃڇڊڌڍڏڦڪڳڱ]` → `sd`.
   - Else any Pashto letter `[ټډړږښځڅڼېۍګ]` → `ps`.
   - Else if `mapWhisperLanguage(sttLanguage)` is pa/ps/sd → that code.
   - Else Punjabi score: count of tokens in `{نوں, دا, دی, دے, اے, ویچیا, کیتا, کیتے, دسو, تسی, ساڈا, اج, نئیں, دتا}` minus count in `{کا, کی, کے, ہے, آج}`. ≥2 → `pa`.
   - Else `ur`.
4. Latin script: if ≥1 token in the Roman Urdu marker set (`hai, hain, ka, ki, ke, ko, ne, se, kal, aaj, aj, hazar, hazaar, lakh, rupay, batao, diye, diya, kiye, karo, wapas, udhaar, udhar, kharcha, becha, bechi, khareeda, kaam, haan, nahi, mein, sale hui, hisaab, nu, vechya, kitte, dasso`) → `roman-ur`.
   - Else if it has ≥2 alphabetic tokens and none are markers → `en`.
   - Else fallback.

### 6.7 `src/nlp/schema.js` (P2)
```js
export const INTENTS = ['record_sale','record_purchase','record_expense','payment_received','payment_made','credit_given','credit_taken','add_staff','assign_task','complete_task','list_tasks','daily_summary','balance_query','contact_balance','undo_last','help','confirm','cancel','unknown']
export const WRITE_INTENTS   // per 5.2
export const LANGUAGES = ['ur','roman-ur','pa','ps','sd','en']
export const ENTITY_FIELDS   // keys of 5.1 in order
export const INTENT_REQUIRED // { record_sale:['amount'], ..., contact_balance:['contactName'], assign_task:['staffName','taskDescription'], add_staff:['staffName','staffPhone'], ... }
export const LLM_OUTPUT_SCHEMA // section 6.9
export function emptyEntities()
export function normalizeIntentResult(raw, provider)
  // raw: {intent, language, confidence, entities?} or flat LLM object. Unknown intent -> 'unknown'.
  // Coerce numbers (Number(), drop NaN/<=0 for amount), trim strings ('' -> null),
  // staffPhone -> normalizePhone, dueDate must match /^\d{4}-\d{2}-\d{2}$/ else null,
  // paymentMode/period must be in enum else null, confidence clamped [0,1] default 0.5.
  // Returns IntentResult.
export function validateIntent(result) // -> { ok: boolean, missing: string[] }
  // INTENT_REQUIRED, plus: record_sale/record_purchase with paymentMode==='credit' requires contactName;
  // add_staff requires isValidPkMobile(staffPhone) -> else missing ['staffPhone'].
```

### 6.8 `src/nlp/rules.js` (P2)
```js
export function quickMatch(text) // -> IntentResult|null: only if tokenize(text).length <= 3 and the whole text matches confirm/cancel/help phrases (provider 'quick', confidence 0.95)
export function parseWithRules(text, ctx) // ctx: { today, knownContacts: string[], knownStaff: string[] } -> IntentResult (provider 'rules')
```
Decision order (the first match wins). `has(group)` = any phrase of that group appears in the normalized token sequence.
1. `quickMatch` result if any.
2. `undo` → undo_last.
3. `help` (whole message ≤ 4 tokens) → help.
4. `staff` and (`addVerb` or a phone is present) and a phone is present → add_staff.
5. `taskGive`, or (`task` and dative particle and not `query`) → assign_task.
6. `task` and `taskDone` → complete_task. Also `taskDone` alone when the message has ≤ 4 tokens.
7. `task` and `query` → list_tasks.
8. `query` (or a trailing `?`/`؟`):
   - name + (`ledgerWords` or genitive particle + `udhaar`) → contact_balance
   - `balance` → balance_query
   - otherwise → daily_summary (period from DAY_WORDS; `kal` here means **yesterday**; default today)
9. `udhaar` with `sale` → record_sale credit. `udhaar` with `purchase` → record_purchase credit. `udhaar` with `took` → credit_taken. `udhaar` with `gave` → credit_given.
10. `returned/received`, or (agent particle `ne` + `gave`) → payment_received.
11. `purchase` → record_purchase.
12. `sale` → record_sale. This includes bare "sale" with an amount (confidence 0.7).
13. `expense` → record_expense.
14. dative `ko` + `gave` + amount → payment_made.
15. Otherwise unknown (confidence 0.3).

Entity extraction:
- `amount` = extractAmount.
- `quantity/unit/item` = extractQuantity.
- `paymentMode`: `udhaar` → credit; `bank|online|easypaisa|jazzcash|cheque` → bank; otherwise cash for money intents, null for others.
- `contactName`:
  1. If any `knownContacts` entry (normalized, possibly multi-word) occurs in the text, use it (original casing from the list).
  2. Otherwise take the 1–2 tokens just before the intent's particle (`ne`/`se` for payment_received, `ko` for payment_made/credit_given/record_sale, `se` for record_purchase/credit_taken, genitive for contact_balance), skipping stopwords and numbers.
  3. Output `titleCase`.
- `staffName`: same approach, with knownStaff and dative particle (assign_task, add_staff) or genitive (list_tasks).
- `staffPhone` = extractPhone.
- `dueDate` (assign_task): `aaj` → today, `kal` → today+1, `parson` → today+2.
- `taskDescription`: take the original text, remove the staff name + particle, the day word + `tak`, and trailing trigger phrases (`ka kaam do`, `ka kaam de do`, `kaam do`, `کا کام دو`, `کام دو`, `da kam de do`), then trim. Example: `Ali ko kal tak 50 bori cement deliver karne ka kaam do` → `50 bori cement deliver karne`.
- `taskRef`: the number after `task|kaam|number|no|#|نمبر`; for complete_task, a lone number.
- `category`: from EXPENSE_CATEGORIES, else `general`.
- `period`: from DAY_WORDS.

Confidence:
- 0.9 when the intent keyword matched and validateIntent is ok,
- 0.7 for heuristic matches (12 bare sale, 14),
- 0.6 when required entities are missing,
- 0.3 for unknown.

`language` = detectLanguage(text).

### 6.9 `src/nlp/llm.js` (P2), Claude integration
```js
import Anthropic from '@anthropic-ai/sdk';
export const SYSTEM_PROMPT  // below, verbatim
export function buildUserMessage(text, ctx) // string, format below
export function createLlmParser({ apiKey, model = 'claude-haiku-5-5', timeoutMs = 15000, client = null }) // -> { name:'llm', parse(text, ctx): Promise<IntentResult> }
```
The call (do not add `temperature`, `thinking`, `tool_choice` or prefill):
```js
const anthropic = client ?? new Anthropic({ apiKey, maxRetries: 1 });
const res = await anthropic.messages.create({
  model,
  max_tokens: 1024,
  system: SYSTEM_PROMPT,
  output_config: { effort: 'low', format: { type: 'json_schema', schema: LLM_OUTPUT_SCHEMA } },
  messages: [{ role: 'user', content: buildUserMessage(text, ctx) }],
}, { timeout: timeoutMs });
if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') throw new Error(`LLM_${res.stop_reason}`);
const block = res.content.find(b => b.type === 'text');
if (!block) throw new Error('LLM_NO_TEXT');
return normalizeIntentResult(JSON.parse(block.text), 'llm');
```
`buildUserMessage`:
```
Today: {ctx.today} (Asia/Karachi)
Known contacts: {comma list or "none"}
Known staff: {comma list or "none"}
Message: """{text}"""
```
`LLM_OUTPUT_SCHEMA` (strict: all properties required, `additionalProperties:false`, nullable via type arrays):
```json
{
  "type": "object", "additionalProperties": false,
  "required": ["intent","language","confidence","amount","quantity","unit","item","contactName","paymentMode","category","staffName","staffPhone","taskDescription","dueDate","taskRef","period","note"],
  "properties": {
    "intent": {"type":"string","enum":["record_sale","record_purchase","record_expense","payment_received","payment_made","credit_given","credit_taken","add_staff","assign_task","complete_task","list_tasks","daily_summary","balance_query","contact_balance","undo_last","help","confirm","cancel","unknown"]},
    "language": {"type":"string","enum":["ur","roman-ur","pa","ps","sd","en"]},
    "confidence": {"type":"number"},
    "amount": {"type":["number","null"]},
    "quantity": {"type":["number","null"]},
    "unit": {"type":["string","null"]},
    "item": {"type":["string","null"]},
    "contactName": {"type":["string","null"]},
    "paymentMode": {"type":["string","null"],"enum":["cash","credit","bank",null]},
    "category": {"type":["string","null"]},
    "staffName": {"type":["string","null"]},
    "staffPhone": {"type":["string","null"]},
    "taskDescription": {"type":["string","null"]},
    "dueDate": {"type":["string","null"]},
    "taskRef": {"type":["integer","null"]},
    "period": {"type":["string","null"],"enum":["today","yesterday","week","month",null]},
    "note": {"type":["string","null"]}
  }
}
```
(If the API rejects `type` arrays, switch each nullable field to `{"anyOf":[{"type":"X"},{"type":"null"}]}` and keep the enums inside the non-null branch.) `normalizeIntentResult` must accept this flat shape.

`SYSTEM_PROMPT` (verbatim):
```
You extract structured bookkeeping commands from WhatsApp messages sent by small shopkeepers and traders in Pakistan. Messages are often speech-to-text transcripts and may be in Urdu script, Roman Urdu, Punjabi (Shahmukhi or Roman), Pashto, Sindhi, or English, with spelling mistakes and mixed languages. Return exactly one JSON object matching the schema.

Intents:
- record_sale: goods sold ("becha", "sale hui", "بیچا", "وپلوره", "وڪرو"). If sold on credit (udhaar), paymentMode="credit" and set contactName.
- record_purchase: goods bought ("khareeda", "خریدا", "واخیست"). On credit -> paymentMode="credit".
- record_expense: business expense (bills, rent/kiraya, salary/tankhwah, fuel, tea). Set category: electricity|rent|salary|food|fuel|transport|general.
- payment_received: a person paid money to the business or returned money ("Ahmed ne 5000 wapas kiye", "X se paise mil gaye").
- payment_made: the business paid a person/supplier ("Bilal ko 20 hazar ada kiye").
- credit_given: business lent money on udhaar ("Ahmed ko 2000 udhaar diya").
- credit_taken: business borrowed money ("Bilal se 50 hazar udhaar liya").
- add_staff: register an employee; needs staffName and staffPhone.
- assign_task: give work to a staff member ("Ali ko ... ka kaam do"); taskDescription is the work itself without the name, deadline or "kaam do".
- complete_task: report a task done ("task 3 ho gaya"); taskRef = task number if said.
- list_tasks: show tasks (optionally for one staffName).
- daily_summary: sales/expense report for a period ("aaj ki sale batao", "is mahine ka hisaab").
- balance_query: cash/galla/overall balance.
- contact_balance: how much a specific person owes or is owed ("Ahmed ka hisaab batao").
- undo_last: cancel/undo the last wrong entry.
- help, confirm (haan/ji/ok/ہاں/هو/ها), cancel (nahi/نہیں/نه), unknown (anything else; never guess a financial intent).

Rules:
- amount is in Pakistani rupees as a plain number. Convert number words: sau=100, hazar/hazaar/ہزار/زر/هزار=1000, lakh/لاکھ=100000, crore=10000000, dedh=1.5, dhai=2.5, sarhe X = X+0.5, sava X = X+0.25, paune X = X-0.25. "5k" = 5000. Urdu digits ۰-۹ are digits.
- A number followed by a unit (bori, kg, maund/man, piece, litre, dozen, carton, bag) is quantity, not amount.
- "X ne ... diye/wapas kiye" means X paid us (payment_received). "X ko ... diye" means we paid X (payment_made) unless it is udhaar (credit_given) or work (assign_task).
- For questions, "kal" means yesterday; for tasks, "kal" means tomorrow, "parson" = day after tomorrow, "aaj" = today. dueDate must be YYYY-MM-DD computed from Today.
- Prefer names from Known contacts / Known staff when they match (allow spelling and script variations; return the known spelling). Return names without particles (ne, ko, se, ka).
- staffPhone: digits only, Pakistani mobile like 923001234567 (convert 03xx to 923xx).
- language: the language/script of the message: ur (Urdu script), roman-ur (Urdu/Punjabi in Latin letters), pa (Punjabi Shahmukhi), ps (Pashto), sd (Sindhi), en (English).
- confidence: 0.9+ when clear, 0.5-0.8 when you had to guess, below 0.5 for unknown.
- Every field not mentioned in the message must be null. Never invent amounts or names.
```

### 6.10 `src/nlp/index.js` (P2)
```js
export function createNlp(nlpConfig, { client = null, logger } = {}) // -> { providerName: 'llm'|'rules', parse(text, ctx): Promise<IntentResult> }
```
Behavior:
- First `quickMatch(text)`. If it matches, return it.
- If the provider is `'rules'`, or `'auto'` without an apiKey, use `parseWithRules`.
- Otherwise try `llm.parse`. On any error, log a warning and return `{...parseWithRules(text, ctx), fallback: true}`.
- If the LLM returns `unknown` with confidence < 0.5 but the rules parser finds a non-unknown intent with confidence ≥ 0.9, return the rules result.

### 6.11 Domain (P3). All factories take `(db, deps)`. `deps = { clock, timezone }`.

`src/domain/errors.js`
```js
export class DomainError extends Error { constructor(code, message = code, details = {}) } // .code, .details
// codes: CONTACT_NOT_FOUND, STAFF_NOT_FOUND, TASK_NOT_FOUND, PHONE_TAKEN, INVALID_AMOUNT, FORBIDDEN, NOTHING_TO_UNDO, UNBALANCED_ENTRY
```
User object: `{ id, businessId, businessName, name, phone, role, language, active }`.

`src/domain/businesses.js`
```js
export function createBusinessService(db, { clock })
  findUserByPhone(phone) -> User|null             // active users only, joined with businesses.name
  registerOwner({ phone, name = null, businessName = null }) -> User
     // tx: insert business (name = businessName ?? `${name ?? 'Mera'} Karobar`), seed 8 accounts, insert owner user (name ?? 'Malik')
  addStaff(businessId, { name, phone }) -> { user, created }
     // phone owned by another business -> DomainError PHONE_TAKEN; same name exists -> update phone, created=false
  findStaffByName(businessId, name) -> User|null  // name_norm exact, then name_norm LIKE prefix%, then contains; any role
  listStaff(businessId) -> User[]                 // role='staff'
  getOwner(businessId) -> User
  getUserById(id) -> User|null
  setUserLanguage(userId, language)
  listBusinesses() -> [{ id, name, ownerPhone, createdAt, userCount }]
  getBusiness(id) -> { id, name, ownerPhone, currency, timezone, createdAt }|null
```
`src/domain/contacts.js`
```js
export function createContactService(db, { clock })
  findByName(businessId, name) -> Contact|null   // same matching as findStaffByName
  findOrCreate(businessId, name, typeHint)        // typeHint 'customer'|'supplier'|'other'; existing type differing from hint (and not other) -> update to 'both'
  list(businessId) -> Contact[]
  names(businessId) -> string[]
// Contact = { id, businessId, name, type, phone, createdAt }
```
`src/domain/ledger.js`
```js
export function createLedgerService(db, { clock, timezone, contacts })
  // ctx = { businessId, userId, sourceMessageId = null }
  recordSale(ctx, { amount, contactName = null, paymentMode = 'cash', item, quantity, unit, note })
  recordPurchase(ctx, { amount, contactName = null, paymentMode = 'cash', item, quantity, unit, note })
  recordExpense(ctx, { amount, category = 'general', paymentMode = 'cash', note })
  recordPaymentReceived(ctx, { amount, contactName, paymentMode = 'cash' })
  recordPaymentMade(ctx, { amount, contactName, paymentMode = 'cash' })
  recordCreditGiven(ctx, { amount, contactName, note })
  recordCreditTaken(ctx, { amount, contactName, note })
     // all -> TxnResult { txnId, txnNo, type, amount, paymentMode, contact: {id,name}|null, contactBalance: number|null, txnDate }
  voidLastTransaction(ctx) -> TxnResult   // latest non-voided txn created_by ctx.userId in the business within 24h; else DomainError NOTHING_TO_UNDO
  getContactBalance(businessId, contactId) -> number   // >0 contact owes us, <0 we owe contact
  getBalances(businessId) -> { cash, bank, receivables, payables }
  listTransactions(businessId, { limit = 50, from = null, to = null }) -> [{ txnNo, type, amount, paymentMode, contactName, item, quantity, unit, category, note, txnDate, voided, createdAt }]
  listContactBalances(businessId) -> [{ contactId, name, type, balance }]
  trialBalance(businessId) -> { accounts: [{ code, name, type, debit, credit, balance }], totalDebit, totalCredit }
```
Posting rules. `M` = CASH, or BANK when paymentMode = 'bank'. Every ledger line sets `business_id`. AR/AP lines set `contact_id`.

| method | type | Debit | Credit | contact required |
|---|---|---|---|---|
| recordSale cash/bank | sale | M | SALES | no (optional, typeHint customer, no AR line) |
| recordSale credit | sale | AR(contact) | SALES | yes |
| recordPurchase cash/bank | purchase | PURCHASES | M | no |
| recordPurchase credit | purchase | PURCHASES | AP(contact) | yes |
| recordExpense | expense | EXPENSES | M (credit mode not allowed → treat as cash) | no |
| recordPaymentReceived | payment_in | M | AR(contact) | yes (customer) |
| recordPaymentMade | payment_out | AP(contact) | M | yes (supplier) |
| recordCreditGiven | credit_given | AR(contact) | CASH | yes (customer) |
| recordCreditTaken | credit_taken | CASH | AP(contact) | yes (supplier) |

Implementation details:
- Private helper `post(ctx, header, lines)` runs inside `withTransaction`. It checks that amount > 0 (else INVALID_AMOUNT, also via `toPaisa`), that there are ≥2 lines, and that Σdebit = Σcredit (else UNBALANCED_ENTRY). It allocates `txn_no`, inserts the transaction and the entries, and sets `txn_date = todayLocal(timezone, clock.now())`.
- A missing contact when one is required throws CONTACT_NOT_FOUND. The handler validates first, so this is a defensive check.
- contactName is resolved with `contacts.findOrCreate`.
- Contact balance SQL:
  `SUM(CASE a.code WHEN 'AR' THEN le.debit_paisa - le.credit_paisa WHEN 'AP' THEN le.debit_paisa - le.credit_paisa ELSE 0 END)` over entries with that contact_id and `t.voided = 0`. AP debits reduce what we owe, so `debit - credit` on AP is negative when we owe. Return `fromPaisa`.
- Account balance: for asset/expense it is debit − credit; for liability/income/equity it is credit − debit. Non-voided only.
- `receivables` = AR balance, `payables` = AP balance (both positive numbers).
- Invariant tested: trialBalance totalDebit === totalCredit after any sequence of operations.

`src/domain/tasks.js`
```js
export function createTaskService(db, { clock })
  assign(ctx, { assigneeUserId, description, dueDate = null }) -> Task
  complete(ctx, { taskNo = null, byUser }) -> Task
     // byUser.role==='staff': taskNo null -> latest open task assigned to byUser; taskNo given must be assigned to byUser else FORBIDDEN
     // owner: taskNo required (TASK_NOT_FOUND if missing/unknown); already done -> return as-is
  list(businessId, { assigneeUserId = null, status = 'open' }) -> Task[]   // status 'all' = no filter; order task_no ASC
  getByNo(businessId, taskNo) -> Task|null
// Task = { id, taskNo, description, dueDate, status, assigneeUserId, assigneeName, assigneePhone, createdAt, completedAt }
```
`src/domain/reports.js`
```js
export function createReportService(db, { clock, timezone, ledger })
  summary(businessId, period = 'today') -> { period, from, to, sales, purchases, expenses, received, paid, creditGiven, creditTaken, net, txnCount, cashBalance }
  // sums amount_paisa by type over non-voided txns with txn_date BETWEEN from AND to; net = sales - purchases - expenses; cashBalance = ledger.getBalances().cash
```
`src/domain/messages.js`
```js
export function createMessageLog(db, { clock })
  recordInbound({ waMessageId, phone, msgType, body = null, mediaId = null, businessId = null }) -> { id, duplicate }
     // INSERT ... ON CONFLICT(wa_message_id) DO NOTHING; changes===0 -> { id: existingId, duplicate: true }
  updateInbound(id, { businessId, transcript, language, intent, intentJson, status, error }) // only provided keys
  recordOutbound({ phone, body, businessId = null, waMessageId = null, status, error = null, inReplyTo = null }) -> id
  list({ businessId = null, limit = 100 }) -> rows newest first (camelCase)
```
`src/domain/confirmations.js`
```js
export function createConfirmationService(db, { clock, ttlMinutes = 10 })
  create({ businessId, userId, sourceMessageId = null }, intentResult)  // upsert by user_id; expires_at = now + ttl
  getActive(userId) -> { id, intentResult, sourceMessageId, createdAt }|null  // expired -> delete, return null
  clear(userId)
```
`src/domain/index.js`
```js
export function createServices(db, { clock, timezone, confirmTtlMinutes })
  -> { businesses, contacts, ledger, tasks, reports, messages, confirmations }
```

### 6.12 STT (P4)
```js
// src/stt/index.js
export function createStt(sttConfig, { fetchImpl = fetch, logger } = {}) // -> provider
// provider: { name, transcribe({ buffer, mimeType, filename = 'audio.ogg', sourcePath = null, mockTranscript = null }) -> Promise<{ text, language: string|null, provider }> }
// src/stt/openai.js
export function createOpenAiStt({ apiKey, model = 'whisper-1', language = '', baseUrl = 'https://api.openai.com/v1', fetchImpl = fetch })
// src/stt/mock.js
export function createMockStt()
```
OpenAI provider:
- `POST ${baseUrl}/audio/transcriptions` with `Authorization: Bearer`.
- FormData: `file` = `new Blob([buffer], {type: mimeType})` with the filename, `model`, `response_format` = `verbose_json` when the model is `whisper-1` and `json` otherwise, `prompt` = `"حساب کتاب: ہزار، لاکھ، روپے، ادھار، بوری، سیمنٹ۔ hazar, lakh, udhaar, sale, kharcha"`, and `language` only if configured.
- Result: `{ text: json.text.trim(), language: mapWhisperLanguage(json.language) ?? null }`.
- If the text contains Devanagari and no language was configured, retry once with `language='ur'`.
- Non-2xx → throw `Error('STT_HTTP_<status>')`.
- Strip the `;codecs=...` suffix from mimeType when choosing the filename extension (`audio/ogg` → `.ogg`, `audio/webm` → `.webm`, `audio/mpeg` → `.mp3`, `audio/mp4` → `.m4a`).

Mock provider:
- Returns `mockTranscript` if given.
- Else, if `sourcePath` is set, reads the sidecar file with the extension replaced by `.txt` (UTF-8, trimmed).
- Else, if the buffer is valid UTF-8 starting with `TRANSCRIPT:`, returns the rest.
- Otherwise throws `Error('STT_NO_TRANSCRIPT')`.
- `language: null`, `provider: 'mock'`.

### 6.13 WhatsApp (P4)
```js
// src/whatsapp/client.js
export function createWhatsAppClient(waConfig, { fetchImpl = fetch, logger } = {}) // provider by waConfig.provider
// common: { name, sendText(to, body) -> Promise<{ ok, messageId: string|null, error?: string }>, downloadMedia(mediaId) -> Promise<{ buffer, mimeType, mockTranscript? }> }
// mock extras: outbox: Array<{to, body, at}>, registerMedia(mediaId, { buffer, mimeType, mockTranscript }), reset()
```
Meta:
- send: `POST ${graphBaseUrl}/${graphVersion}/${phoneNumberId}/messages`, JSON `{ messaging_product:'whatsapp', recipient_type:'individual', to, type:'text', text:{ preview_url:false, body } }`, bearer token → `messageId = json.messages?.[0]?.id`. Never throws: errors become `{ok:false, error}`.
- download: `GET ${base}/${ver}/${mediaId}` (bearer) → `{url, mime_type}`, then `GET url` (bearer) → `Buffer.from(await res.arrayBuffer())`.
- Bodies longer than 4000 chars are truncated to 3990 + '…'.

Mock: `sendText` pushes to the outbox, logs at debug, returns `{ok:true, messageId:'mock-'+n}`. `downloadMedia` returns the registered media or throws `MEDIA_NOT_FOUND`.

```js
// src/whatsapp/signature.js
export function computeSignature(rawBody, appSecret) // 'sha256=' + hmac-sha256 hex
export function verifySignature(rawBody, header, appSecret) // false if header missing/malformed; crypto.timingSafeEqual on equal-length buffers
// src/whatsapp/parse.js
export function parseWebhookPayload(body) // -> InboundMessage[]
```
`InboundMessage = { waMessageId, from, type: 'text'|'audio'|'other', text: string|null, mediaId: string|null, mimeType: string|null, profileName: string|null, timestamp: number|null, audioPath?: string, audioBuffer?: Buffer, mockTranscript?: string }`

Parse rules:
- Iterate `body.entry[].changes[]` where `field==='messages'`, then `value.messages[]`.
- `text.body` → text. `audio` (voice notes included) → mediaId/mimeType. `interactive.button_reply.title` → treated as text. Everything else → 'other'.
- profileName comes from the `value.contacts` entry whose `wa_id` matches `from`.
- Payloads that only contain `statuses` → `[]`. Malformed input → `[]`, never throw.

### 6.14 Replies (P4)
```js
// src/replies/index.js
export const REPLY_KEYS // array below
export function fallbackChain(lang) // pa|ps|sd -> [lang,'ur','roman-ur','en']; ur -> ['ur','roman-ur','en']; roman-ur -> ['roman-ur','en']; en -> ['en','roman-ur']; unknown -> ['roman-ur','en']
export function composeReply(key, data = {}, lang = 'roman-ur') // first template found along chain; unknown key -> templates.error
// templates/<lang>.js: export default { [key]: (data, h) => string }  where h = helpers from format.js
// src/replies/format.js
export function intentLabel(intent, lang)        // labels below; non-ur langs use roman-ur labels except ur
export function formatDate(dateStr, lang)        // 'YYYY-MM-DD' -> 'DD-MM-YYYY'
export function balanceLine(name, balance, lang) // owes/owed/settled sentence
export { formatRs } from '../utils/money.js'
```
Data shapes per key (handlers MUST produce these exactly):

| key | data |
|---|---|
| welcome | {name, businessName} |
| sale_recorded, purchase_recorded | {amount, contactName, paymentMode, item, quantity, unit, txnNo, contactBalance} |
| expense_recorded | {amount, category, txnNo} |
| payment_received_recorded, payment_made_recorded, credit_given_recorded, credit_taken_recorded | {amount, contactName, txnNo, contactBalance} |
| undo_done | {txnNo, type, amount} |
| staff_added | {staffName, staffPhone, created} |
| task_assigned | {taskNo, staffName, description, dueDate, staffNotified} |
| task_notification | {taskNo, businessName, description, dueDate} (to staff) |
| task_completed | {taskNo, description} |
| task_completed_owner_notice | {taskNo, description, staffName} |
| task_list | {tasks:[{taskNo, description, staffName, dueDate, status}], staffName} |
| daily_summary | report summary object (6.11) |
| balance | {cash, bank, receivables, payables} |
| contact_balance | {contactName, balance} |
| help | {} |
| confirm_request | {intent, amount, contactName, staffName, description} |
| cancelled, nothing_to_confirm, permission_denied, unknown, not_registered, error, transcription_failed, unsupported_message | {} |
| missing_info | {intent, missing:[field]} |
| not_found_contact | {name} |
| not_found_staff | {name} |
| not_found_task | {taskRef} |
| nothing_to_undo | {} |
| phone_taken | {phone} |

Intent labels (roman-ur / ur): record_sale `Sale`/`فروخت`, record_purchase `Khareedari`/`خریداری`, record_expense `Kharcha`/`خرچہ`, payment_received `Wusooli`/`وصولی`, payment_made `Adaigi`/`ادائیگی`, credit_given `Udhaar diya`/`ادھار دیا`, credit_taken `Udhaar liya`/`ادھار لیا`, add_staff `Naya mulazim`/`نیا ملازم`, assign_task `Kaam`/`کام`, complete_task `Kaam mukammal`/`کام مکمل`, undo_last `Aakhri entry cancel`/`آخری اندراج منسوخ`.

Missing field labels (roman-ur / ur): amount `raqam`/`رقم`, contactName `kis ka naam`/`نام`, staffName `mulazim ka naam`/`ملازم کا نام`, staffPhone `mobile number (03XX-XXXXXXX)`/`موبائل نمبر`, taskDescription `kaam ki tafseel`/`کام کی تفصیل`, taskRef `task number`/`کام کا نمبر`.

`balanceLine`:
- roman-ur: `>0` `"{name} ne aap ko {Rs} dene hain."`, `<0` `"Aap ne {name} ko {Rs} dene hain."` (abs), `0` `"{name} ka hisaab barabar hai."`
- ur: `"{name} کے ذمے {Rs} باقی ہیں۔"`, `"آپ نے {name} کو {Rs} دینے ہیں۔"`, `"{name} کا حساب برابر ہے۔"`
- en: `"{name} owes you {Rs}."` / `"You owe {name} {Rs}."` / `"{name}'s account is settled."`

Template texts. `{Rs}` = formatRs(amount); bracketed parts are included only when the field is non-null. Do not use emojis.

roman-ur:
- welcome: `Assalam o Alaikum {name}! Aap ka hisaab-kitaab ab isi WhatsApp number par hai. Voice note ya message bhejein, jaise "aaj 5000 ki sale hui". Madad ke liye "help" bhejein.`
- sale_recorded: `Sale darj ho gayi: {Rs}[ - {quantity} {unit} {item}][ - {contactName} (udhaar)]. Entry #{txnNo}.[ {balanceLine}]`. Use "(udhaar)" only when paymentMode==='credit'. Include balanceLine only when contactBalance is not null and a contact exists.
- purchase_recorded: `Khareedari darj: {Rs}[ - {quantity} {unit} {item}][ - {contactName}[ (udhaar)]]. Entry #{txnNo}.[ {balanceLine}]`
- expense_recorded: `Kharcha darj: {Rs} ({category}). Entry #{txnNo}.`
- payment_received_recorded: `{contactName} se {Rs} wusool darj. Entry #{txnNo}. {balanceLine}`
- payment_made_recorded: `{contactName} ko {Rs} adaigi darj. Entry #{txnNo}. {balanceLine}`
- credit_given_recorded: `{contactName} ko {Rs} udhaar diya darj. Entry #{txnNo}. {balanceLine}`
- credit_taken_recorded: `{contactName} se {Rs} udhaar liya darj. Entry #{txnNo}. {balanceLine}`
- undo_done: `Entry #{txnNo} ({intentLabel of type}) {Rs} cancel kar di gayi.` Map txn type to intent: sale→record_sale, purchase→record_purchase, expense→record_expense, payment_in→payment_received, payment_out→payment_made, credit_given, credit_taken.
- staff_added: `{staffName} ({staffPhone}) ko mulazim ke taur par shamil kar liya gaya.` When created=false: `{staffName} ka number update ho gaya: {staffPhone}.`
- task_assigned: `Kaam #{taskNo} {staffName} ko de diya gaya: {description}[ - aakhri tareekh {date}].` + (staffNotified ? ` {staffName} ko WhatsApp par bata diya gaya.` : ` {staffName} ka WhatsApp number darj nahi, unhein khud bata dein.`)
- task_notification: `{businessName} ki taraf se naya kaam #{taskNo}: {description}[ - {date} tak]. Kaam mukammal hone par "task {taskNo} ho gaya" bhejein.`
- task_completed: `Shukriya! Kaam #{taskNo} mukammal darj ho gaya: {description}.`
- task_completed_owner_notice: `{staffName} ne kaam #{taskNo} mukammal kar diya: {description}.`
- task_list: empty → `Koi baqi kaam nahi.`; else a header `Baqi kaam[ ({staffName})]:` followed by lines `#{taskNo} {description} - {staffName}[ ({date} tak)]`
- daily_summary: `{periodLabel} ka hisaab ({from}[ se {to}]):\nSale: {Rs sales}\nKhareedari: {Rs purchases}\nKharcha: {Rs expenses}\nWusooli: {Rs received}\nAdaigi: {Rs paid}\nMunafa (andaza): {Rs net}\nGalla (cash): {Rs cashBalance}\nKul entries: {txnCount}`. periodLabel: today `Aaj`, yesterday `Kal`, week `Is hafte`, month `Is mahine`.
- balance: `Galla (cash): {Rs cash}\nBank: {Rs bank}\nLogon ne dene hain: {Rs receivables}\nAap ne dene hain: {Rs payables}`
- contact_balance: `{balanceLine}`
- help: `Aap yeh bol ya likh sakte hain:\n- "aaj 5000 ki sale hui"\n- "Bilal se 10 hazar ka maal khareeda"\n- "bijli ka bill 3500 diya"\n- "Ahmed ne 5000 wapas kiye"\n- "Ahmed ko 2000 udhaar diya"\n- "Ali ko kal tak cement deliver karne ka kaam do"\n- "aaj ki sale batao" / "balance batao" / "Ahmed ka hisaab batao"\n- "pichli entry galat hai"`
- confirm_request: `Tasdeeq karein: {intentLabel}[ {Rs}][ - {contactName}][ - {staffName}][ - {description}]. Sahi hai to "haan" bhejein, warna "nahi".`
- cancelled: `Theek hai, cancel kar diya.`
- nothing_to_confirm: `Koi entry tasdeeq ke liye baqi nahi.`
- missing_info: `{intentLabel} ke liye yeh batayein: {missing labels joined ', '}. Dobara poora jumla bhejein.`
- not_found_contact: `"{name}" naam ka koi khata nahi mila.`
- not_found_staff: `"{name}" naam ka koi mulazim nahi mila. Pehle add karein: "{name} ko staff mein add karo 03XXXXXXXXX".`
- not_found_task: `Kaam #{taskRef} nahi mila.` (taskRef null → `Koi khula kaam nahi mila.`)
- nothing_to_undo: `Cancel karne ke liye koi haaliya entry nahi mili.`
- phone_taken: `Yeh number ({phone}) kisi aur karobar mein darj hai.`
- permission_denied: `Maazrat, yeh kaam sirf maalik kar sakta hai.`
- unknown: `Maazrat, samajh nahi aaya. Dobara bolein ya "help" bhejein.`
- not_registered: `Yeh number registered nahi hai. Apne maalik se rabta karein.`
- error: `Maazrat, koi masla aa gaya. Thori der baad dobara koshish karein.`
- transcription_failed: `Maazrat, awaaz samajh nahi aayi. Dobara saaf awaaz mein bolein ya likh kar bhejein.`
- unsupported_message: `Sirf voice note ya text message bhejein.`

ur: the same structure and meaning in Urdu script. Use these phrases: `فروخت درج ہو گئی`, `خریداری درج`, `خرچہ درج`, `سے {Rs} وصول درج`, `کو {Rs} ادائیگی درج`, `کو {Rs} ادھار دیا درج`, `سے {Rs} ادھار لیا درج`, `اندراج نمبر {txnNo}`, `کام نمبر {taskNo}`, `تصدیق کریں: ... درست ہے تو "ہاں" بھیجیں، ورنہ "نہیں"۔`, `معذرت، سمجھ نہیں آیا۔ دوبارہ بولیں یا "help" بھیجیں۔`, summary labels `سیل، خریداری، خرچہ، وصولی، ادائیگی، منافع (اندازاً)، گلہ (کیش)، کل اندراج`, period labels `آج، کل، اس ہفتے، اس مہینے`, and the help examples in Urdu script. Every REPLY_KEY must exist in `ur.js`, `roman-ur.js` and `en.js` (en is a plain English equivalent).

pa.js, ps.js, sd.js need at least `unknown`, `help`, `confirm_request` and `cancelled`; everything else falls back. Use:
- pa unknown `معاف کرنا، سمجھ نئیں آئی۔ دوبارہ بولو یا "help" لکھو۔`; confirm_request `پکا کرو: {label} {Rs}۔ ٹھیک اے تے "ہاں"، نئیں تے "نئیں"۔`
- ps unknown `بښنه غواړم، پوه نه شوم. بیا ووایاست یا "help" ولیکئ.`; confirm_request `تایید: {label} {Rs}. که سم وي "هو" ووایاست، که نه "نه".`
- sd unknown `معاف ڪجو، سمجهه ۾ نه آيو. ٻيهر چئو يا "help" لکو.`; confirm_request `تصديق: {label} {Rs}. صحيح هجي ته "ها" چئو، نه ته "نه".`

pa/ps/sd `help` and `cancelled` may reuse ur text. `{label}` = `intentLabel(intent, 'ur')`.

### 6.15 Pipeline (P5)
```js
// src/pipeline/handlers.js
export const STAFF_ALLOWED = new Set(['record_sale','record_expense','payment_received','complete_task','list_tasks','help','confirm','cancel','unknown'])
export function isAllowed(role, intent) // owner -> true
export function needsConfirmation(intentResult, confirmCfg)
  // only WRITE_INTENTS; true if intent==='undo_last' || (amount ?? 0) >= amountThreshold || confidence < minConfidence
export function createHandlers({ services, config })
  execute(intentResult, ctx) -> Promise<HandlerResult>
  // ctx = { user, sourceMessageId }
  // HandlerResult = { key, data, notify?: [{ userId, key, data }] }
```
Handler map (catch DomainError and map code → key: CONTACT_NOT_FOUND→not_found_contact{name}, STAFF_NOT_FOUND→not_found_staff{name}, TASK_NOT_FOUND→not_found_task{taskRef}, NOTHING_TO_UNDO→nothing_to_undo, PHONE_TAKEN→phone_taken{phone}, FORBIDDEN→permission_denied; anything else rethrows):
- record_sale → `ledger.recordSale` → `sale_recorded` with `{amount, contactName: r.contact?.name ?? null, paymentMode, item, quantity, unit, txnNo, contactBalance}`. The same pattern applies to purchase, expense, payment_received, payment_made, credit_given and credit_taken.
- add_staff → `businesses.addStaff` → staff_added.
- assign_task → `businesses.findStaffByName` (null → not_found_staff) → `tasks.assign` → task_assigned. `staffNotified = !!staff.phone && staff.id !== user.id`. If notified, set `notify=[{userId: staff.id, key:'task_notification', data}]`.
- complete_task → `tasks.complete({taskNo: entities.taskRef, byUser: user})` → task_completed. If the completer is staff, add a notify to the owner: task_completed_owner_notice.
- list_tasks → staff: own open tasks; owner: all open, or only that staff member's tasks if staffName resolves (unresolved → not_found_staff) → task_list.
- daily_summary → `reports.summary(period ?? 'today')`. balance_query → `ledger.getBalances`.
- contact_balance → `contacts.findByName` (null → not_found_contact) → `ledger.getContactBalance` → contact_balance.
- undo_last → `ledger.voidLastTransaction` → undo_done. help → help. unknown → unknown.

```js
// src/pipeline/orchestrator.js
export function createPipeline({ config, services, nlp, stt, whatsapp, logger, clock })
  handleIncoming(inbound, { dryRun = false } = {}) -> Promise<{ status: 'processed'|'duplicate'|'error'|'ignored', intent: string|null, transcript: string|null, language: string|null, replies: [{ to, text, key }] }>
```
handleIncoming algorithm (wrap steps 2–13 in try/catch → reply `error`, status 'error', updateInbound error message):
1. `const { id: msgId, duplicate } = messages.recordInbound({ waMessageId: inbound.waMessageId, phone: inbound.from, msgType: inbound.type, body: inbound.text, mediaId: inbound.mediaId })`. If duplicate → return `{status:'duplicate', replies:[]}`.
2. `user = businesses.findUserByPhone(from)`. If none: when `config.autoRegister`, `registerOwner({phone: from, name: inbound.profileName})` and set `isNew=true`; otherwise reply `not_registered` (lang roman-ur), status 'ignored', and return.
3. If type 'other' → reply unsupported_message and return.
4. Text: for 'text' it is `inbound.text`. For 'audio', the buffer comes from `inbound.audioBuffer`, else `inbound.audioPath` (read with fs), else `whatsapp.downloadMedia(mediaId)`, which may also supply mockTranscript. Then `stt.transcribe({buffer, mimeType, sourcePath: inbound.audioPath, mockTranscript})`. On throw → reply transcription_failed (user.language), status 'error', return.
5. `lang = detectLanguage(text, {sttLanguage})`; `businesses.setUserLanguage(user.id, lang)`.
6. If isNew: queue a `welcome` reply first, `{name: user.name, businessName: user.businessName}`. Then continue processing the message unless it is just a greeting (≤2 tokens and the intent is unknown/help).
7. `ctxNlp = { today: todayLocal(tz, clock.now()), knownContacts: contacts.names(bid), knownStaff: businesses.listStaff(bid).map(u=>u.name) }`; `result = await nlp.parse(text, ctxNlp)`. `updateInbound(msgId, {businessId, transcript: text, language: lang, intent: result.intent, intentJson: JSON.stringify(result)})`.
8. `pending = confirmations.getActive(user.id)`:
   - intent confirm + pending → `confirmations.clear`, then `result = pending.intentResult` and jump to step 11, skipping confirmation.
   - intent cancel + pending → clear, reply cancelled.
   - confirm/cancel without pending → reply nothing_to_confirm.
   - pending exists and the intent is something else → clear the pending and continue.
9. `validateIntent(result)`; if not ok → missing_info `{intent, missing}`.
10. `isAllowed(user.role, intent)`; if not → permission_denied. Then if `needsConfirmation(result, config.confirm)` → `confirmations.create(...)` and reply confirm_request `{intent, amount, contactName, staffName, description: taskDescription}`.
11. `hr = await handlers.execute(result, {user, sourceMessageId: msgId})`.
12. Compose the main reply in `lang`. For each notify, load the user with `getUserById` and compose in `u.language`; skip if the user has no phone.
13. Send each reply (`dryRun` → do not call whatsapp; outbound status 'simulated'; otherwise status 'sent'/'failed' from the result), then `recordOutbound({... inReplyTo: msgId})`. `updateInbound(msgId, {status:'processed'})`.
14. Return the result with all replies (to, text, key).

### 6.16 Routes and app (P5)
```js
// src/routes/webhook.js
export function createWebhookRouter({ config, pipeline, logger }) // express.Router
//  GET /webhook: hub.mode==='subscribe' && hub.verify_token===config.whatsapp.verifyToken (non-empty) -> 200 text hub.challenge; else 403
//  POST /webhook: if appSecret && !verifySignature(req.rawBody, req.get('x-hub-signature-256'), appSecret) -> 401
//                 msgs = parseWebhookPayload(req.body); work = Promise.all(msgs.map(m => pipeline.handleIncoming(m)))
//                 config.webhookAwait ? await work then 200 {ok:true, processed:n} : (work.catch(log); 200 {ok:true})
// src/routes/dev.js  (mounted only when config.devRoutes)
export function createDevRouter({ config, pipeline, whatsapp })
//  POST /dev/simulate body {from, text?, audioPath?, audioBase64?, mimeType?, transcript?, profileName?, messageId?}
//    from required -> normalizePhone; 400 if invalid or neither text nor audio.
//    audioPath: path.resolve(config.devAudioDir, audioPath) must start with devAudioDir + sep, else 400.
//    audioBase64 -> audioBuffer (max 5 MB). Builds InboundMessage (waMessageId = messageId ?? 'dev-'+randomUUID()).
//    -> 200 await pipeline.handleIncoming(inbound, { dryRun: true })
//  GET /dev/outbox -> whatsapp.outbox ?? []   ;  POST /dev/outbox/reset
// src/routes/admin.js
export function createAdminRouter({ services, config })
//  auth middleware: !config.adminToken -> 503; header 'Authorization: Bearer <token>' compared with timingSafeEqual -> else 401
//  GET /api/admin/businesses
//  GET /api/admin/businesses/:id/summary?period=today  -> { summary, balances }
//  GET /api/admin/businesses/:id/transactions?limit=100
//  GET /api/admin/businesses/:id/contacts               -> ledger.listContactBalances
//  GET /api/admin/businesses/:id/tasks?status=open|done|all
//  GET /api/admin/businesses/:id/staff
//  GET /api/admin/businesses/:id/trial-balance
//  GET /api/admin/messages?businessId=&limit=100
//  unknown business id -> 404
// src/app.js
export function createApp(container) // express(); app.use(express.json({ limit: '8mb', verify: (req,_res,buf)=>{ req.rawBody = buf; } }));
//  GET /health -> { ok:true, providers:{ whatsapp: whatsapp.name, stt: stt.name, nlp: nlp.providerName } }
//  webhook router, admin router, app.use('/admin', express.static('public/admin')), if devRoutes: dev router + app.use('/dev', express.static('public/dev'))
//  error middleware -> 500 { error: 'internal' } (log)
// src/container.js
export function createContainer(config, overrides = {}) // overrides: { clock, db, stt, nlp, whatsapp, logger, fetchImpl, llmClient }
//  -> { config, clock, logger, db, services, stt, nlp, whatsapp, pipeline }
// src/server.js
//  import 'dotenv/config'; const c = createContainer(loadConfig()); createApp(c).listen(c.config.port, () => log URLs: /webhook, /admin, /dev/simulator.html)
```

### 6.17 Static pages (P4)
- `public/admin/`: on load it asks for the admin token via an input field, stores it in `localStorage`, and sends it as a Bearer header. It has a business dropdown and tabs: Summary (period select), Transactions table, Contacts and balances, Tasks, Staff, Trial balance, Messages log. It uses vanilla `fetch`. All text is inserted with `textContent`, never `innerHTML`, so user data cannot inject markup.
- `public/dev/simulator.html` + `simulator.js`: a chat UI with a phone-number input (default `923001234567`), a text box with a Send button that POSTs `/dev/simulate {from, text}`, and a "Hold to record" button that uses `MediaRecorder` (audio/webm), base64-encodes the clip and POSTs `{from, audioBase64, mimeType}`. It renders the transcript, the intent and the reply bubbles from the response. Urdu text is shown with `dir="auto"`.

---

## 7. `.env.example`

```
# Server
PORT=3000
NODE_ENV=development
DB_PATH=./data/app.db
TIMEZONE=Asia/Karachi
AUTO_REGISTER=true            # unknown numbers become owners of a new business
DEV_ROUTES=true               # /dev/simulate and simulator page (default: on unless production)
DEV_AUDIO_DIR=./samples       # audioPath in /dev/simulate must be inside this dir
ADMIN_TOKEN=change-me         # empty disables /api/admin
WEBHOOK_AWAIT=false           # true = process before responding 200 (tests)
LOG_LEVEL=info

# WhatsApp (Meta Cloud API). Blank provider = meta if token+phone id set, else mock
WHATSAPP_PROVIDER=
META_VERIFY_TOKEN=my-verify-token
META_APP_SECRET=
META_ACCESS_TOKEN=
META_PHONE_NUMBER_ID=
META_GRAPH_VERSION=v21.0
META_GRAPH_BASE_URL=https://graph.facebook.com

# Speech-to-text. Blank provider = openai if key set, else mock
STT_PROVIDER=
OPENAI_API_KEY=
STT_MODEL=whisper-1           # or gpt-4o-transcribe
STT_LANGUAGE=                 # blank = auto-detect; e.g. ur
OPENAI_BASE_URL=https://api.openai.com/v1

# NLP: auto (LLM if key, else rules) | llm | rules
NLP_PROVIDER=auto
ANTHROPIC_API_KEY=
NLP_MODEL=claude-haiku-5-5
NLP_TIMEOUT_MS=15000

# Confirmation step
CONFIRM_AMOUNT_THRESHOLD=50000
CONFIRM_MIN_CONFIDENCE=0.6
CONFIRM_TTL_MINUTES=10
```

`package.json` scripts:
```json
"type": "module",
"engines": { "node": ">=22.13" },
"scripts": {
  "start": "node --disable-warning=ExperimentalWarning src/server.js",
  "dev": "node --disable-warning=ExperimentalWarning --watch src/server.js",
  "test": "node --disable-warning=ExperimentalWarning --test \"test/**/*.test.js\""
}
```
Install with `npm install express@5 dotenv @anthropic-ai/sdk` and let npm pin the versions.

---

## 8. Test plan

All tests use `node:test` + `node:assert/strict`, an in-memory DB, the fixed clock `2026-11-24T05:00:00Z` (10:00 PKT), and no network calls.

Helpers:
- `test/helpers/db.js` (`createTestDb()` → `openDatabase(':memory:')`)
- `test/helpers/clock.js` (`fixedClock(iso)` → `{ now: () => new Date(iso), set(iso) }`)
- `test/helpers/app.js` (`startTestServer(envOverrides)`: config from `{DB_PATH:':memory:', WHATSAPP_PROVIDER:'mock', STT_PROVIDER:'mock', NLP_PROVIDER:'rules', DEV_ROUTES:'true', ADMIN_TOKEN:'test-token', WEBHOOK_AWAIT:'true', DEV_AUDIO_DIR:'test/fixtures/audio', ...envOverrides}`, `createContainer(config, {clock})`, `app.listen(0)` → `{ baseUrl, container, close }`)

| file | pkg | key cases |
|---|---|---|
| unit/config.test.js | P1 | defaults; provider auto-selection (mock without keys, meta/openai with keys); booleans; frozen object |
| unit/db.test.js | P1 | schema creates all tables; withTransaction commits, rolls back on throw, re-entrant; ledger CHECK rejects a line with both debit and credit |
| unit/utils.test.js | P1 | toPaisa(1250.5)=125050; formatRs(150000)='Rs 1,50,000'; normalizePhone('0300-1234567')='923001234567', '+92 300 1234567', '00923001234567', '۰۳۰۰۱۲۳۴۵۶۷'; extractPhone; todayLocal at 20:00Z = next day in Karachi; periodRange week/month; normalizeText digits/commas/ي→ی; tokenize splits '5000روپے' |
| unit/numbers.test.js | P2 | every value listed in 6.5; `kaam do` → amount null; `20 bori cement 30 hazar` → quantity 20 bori, amount 30000; phone is not an amount |
| unit/detect.test.js | P2 | Urdu/Sindhi/Pashto/Punjabi Shahmukhi samples from 5.3; Roman Urdu vs English; Devanagari → ur; sttLanguage 'punjabi' with plain Urdu-script text → pa |
| unit/rules.test.js | P2 | every [R] utterance in 5.3 → expected intent and key entities (use today 2026-11-24, knownStaff ['Ali'], knownContacts ['Ahmed','Bilal']) |
| unit/schema.test.js | P2 | normalizeIntentResult coercions; validateIntent missing fields; credit sale without contact → missing contactName; invalid staff phone |
| unit/llm.test.js | P2 | fake client returning JSON text → normalized result; the request includes model, output_config.format.type 'json_schema', and no temperature; refusal stop_reason throws; createNlp falls back to rules when the client throws; quickMatch 'haan' never calls the client |
| unit/businesses.test.js | P3 | registerOwner seeds 8 accounts; addStaff create/update; PHONE_TAKEN across businesses; findStaffByName prefix match; isolation |
| unit/ledger.test.js | P3 | each of the 7 posting types produces the correct accounts (check trialBalance); total debit = credit after a mixed sequence; credit sale 8000 then payment_received 8000 → contact balance 0; credit_given +2000; credit_taken −50000; bank mode hits BANK; void excludes from balances and reports; NOTHING_TO_UNDO when none or older than 24h; per-business txn_no starts at 1; invalid amount throws; business A cannot see business B |
| unit/tasks.test.js | P3 | assign numbering; staff completes own latest; staff cannot complete another's task (FORBIDDEN); owner needs taskNo; list filters |
| unit/reports.test.js | P3 | today/yesterday/month sums using clock.set; net formula; voided excluded |
| unit/messages.test.js | P3 | duplicate waMessageId → duplicate:true; outbound logging |
| unit/confirmations.test.js | P3 | create replaces existing; expiry after ttl returns null |
| unit/signature.test.js | P4 | valid signature; tampered body; missing/malformed header; wrong length is not an exception |
| unit/parse.test.js | P4 | text/audio/status/interactive fixtures; malformed → [] |
| unit/stt.test.js | P4 | mock: mockTranscript, sidecar .txt, TRANSCRIPT: buffer, throws otherwise; openai: fake fetch checks URL/auth/form fields, maps 'urdu' → ur, Devanagari retry with language=ur, HTTP error throws |
| unit/whatsapp.test.js | P4 | meta sendText builds the correct URL/body with a fake fetch; download 2-step; failure → ok:false; mock outbox + registerMedia |
| unit/replies.test.js | P4 | every REPLY_KEY renders a non-empty string in ur, roman-ur, en with sample data; ps falls back to ur for sale_recorded; balanceLine 3 cases; amounts formatted |
| e2e/pipeline.test.js | P5 | (container with mocks) new number → welcome + registered owner; "aaj 5000 ki sale hui" → sale_recorded and cash 5000; Urdu-script message → Urdu reply; duplicate waMessageId processed once; audio via whatsapp mock registerMedia + mockTranscript; STT failure → transcription_failed; 60000 sale → confirm_request, "haan" → recorded, second "haan" → nothing_to_confirm; "nahi" cancels; pending discarded by a new command; missing amount → missing_info; add staff → staff assigns → staff message "kaam ho gaya" → owner notified; staff "balance batao" → permission_denied; undo flow (confirm then void); unknown text → unknown |
| e2e/webhook.test.js | P5 | GET verify ok/403; POST with META_APP_SECRET: valid signature → 200 + outbox has reply, invalid → 401; status-only payload → 200 with no processing; repeat delivery → one reply |
| e2e/dev.test.js | P5 | /dev/simulate text returns replies with dryRun (outbox empty); audioPath fixture sale.ogg → transcript from sale.txt; path traversal `../../package.json` → 400; disabled when DEV_ROUTES=false (404) |
| e2e/admin.test.js | P5 | 401 without token, 503 when ADMIN_TOKEN empty; summary/transactions/contacts/tasks/messages return data after simulated messages; 404 for an unknown business |

Done = `npm test` passes with no env keys and no network.

---

## 9. Work breakdown (dependency order)

The package order is P1 → (P2, P3, P4 in parallel) → P5. A package edits ONLY its own files. If a contract seems wrong, keep the contract and add a `// NOTE:`. Never edit another package's file.

### P1: Foundation (Haiku)
Files: `package.json`, `.env.example`, `.gitignore`, `src/config.js`, `src/db/schema.sql`, `src/db/index.js`, `src/utils/money.js`, `src/utils/phone.js`, `src/utils/time.js`, `src/utils/text.js`, `src/utils/logger.js`, `test/helpers/db.js`, `test/helpers/clock.js`, `test/unit/config.test.js`, `test/unit/db.test.js`, `test/unit/utils.test.js`.
Steps:
1. Create `package.json` with the scripts from section 7 and run `npm install express@5 dotenv @anthropic-ai/sdk`.
2. Write the DDL exactly as in section 4.
3. Write the utils exactly as in 6.3.

Done when: the P1 tests pass.

### P2: Language and NLP (Sonnet)
Files: `src/nlp/lexicon.js`, `src/nlp/numbers.js`, `src/nlp/schema.js`, `src/nlp/rules.js`, `src/nlp/llm.js`, `src/nlp/index.js`, `src/lang/detect.js`, `test/unit/numbers.test.js`, `test/unit/detect.test.js`, `test/unit/rules.test.js`, `test/unit/schema.test.js`, `test/unit/llm.test.js`.
Depends on: P1 utils (text, phone, time).
Notes:
- Build the lexicon Maps through `normalizeText`.
- The rules parser must pass every [R] example.
- Keep llm.js free of network calls in tests (inject `client`).

### P3: Domain and accounting (Sonnet)
Files: `src/domain/errors.js`, `businesses.js`, `contacts.js`, `ledger.js`, `tasks.js`, `reports.js`, `messages.js`, `confirmations.js`, `index.js`, `test/unit/businesses.test.js`, `ledger.test.js`, `tasks.test.js`, `reports.test.js`, `messages.test.js`, `confirmations.test.js`.
Depends on: P1 (db, money, time, text).
Notes:
- All posting goes through one balanced `post()` helper.
- Every SQL statement filters by business_id.
- Use prepared statements with `?` params. Never string-concatenate values into SQL.

### P4: Adapters, replies and static UI (Haiku)
Files: `src/stt/index.js`, `src/stt/openai.js`, `src/stt/mock.js`, `src/whatsapp/client.js`, `src/whatsapp/signature.js`, `src/whatsapp/parse.js`, `src/replies/index.js`, `src/replies/format.js`, `src/replies/templates/{ur,roman-ur,en,pa,ps,sd}.js`, `public/admin/index.html`, `public/admin/app.js`, `public/admin/style.css`, `public/dev/simulator.html`, `public/dev/simulator.js`, `test/fixtures/webhook/{text,audio,status}.json`, `test/unit/signature.test.js`, `parse.test.js`, `stt.test.js`, `whatsapp.test.js`, `replies.test.js`.
Depends on: P1 (money, logger). `src/stt/openai.js` imports `mapWhisperLanguage` from `src/lang/detect.js` (P2). If P2 is not done yet, write against the contract in 6.6; the test runs after P2 lands.
Notes:
- Templates follow 6.14 exactly.
- No `innerHTML` with data.
- All fetch calls are injectable.

### P5: Pipeline, routes, app and E2E (Sonnet)
Files: `src/pipeline/handlers.js`, `src/pipeline/orchestrator.js`, `src/routes/webhook.js`, `src/routes/dev.js`, `src/routes/admin.js`, `src/app.js`, `src/container.js`, `src/server.js`, `README.md`, `samples/.gitkeep`, `test/helpers/app.js`, `test/fixtures/audio/sale.ogg` (ASCII bytes `OggS-fake-audio`), `test/fixtures/audio/sale.txt` (`aaj 5000 ki sale hui`), `test/e2e/pipeline.test.js`, `webhook.test.js`, `dev.test.js`, `admin.test.js`.
Depends on: P1–P4.
Notes:
- Implement 6.15/6.16 literally.
- Background webhook processing must catch and log errors (no unhandled rejections).
- README covers: install, `.env` setup, `npm start`, the simulator at `http://localhost:3000/dev/simulator.html`, the dashboard at `/admin/`, Meta setup (app, WhatsApp product, test number, set the webhook URL `https://<public-host>/webhook` via a tunnel such as cloudflared/ngrok, the verify token, subscribing to the `messages` field, the permanent access token, the app secret), and the known limitations listed below.

Final acceptance (run by P5): `npm test` is green with an empty environment, and `npm start` with no keys lets the simulator record a sale, ask for confirmation of a large one, and show it in the dashboard.

Known limitations (document them in the README):
- No Twilio path.
- Contacts in Latin and Urdu script are separate (`Ahmed` and `احمد` are two contacts).
- The rules parser covers Urdu and Roman Urdu well; Pashto, Sindhi and Punjabi mainly rely on the LLM.
- Profit is a cash-basis estimate (sales − purchases − expenses), with no inventory costing.

---

### Critical Files for Implementation
- src/nlp/rules.js (with src/nlp/numbers.js and src/nlp/lexicon.js)
- src/domain/ledger.js
- src/pipeline/orchestrator.js (with src/pipeline/handlers.js)
- src/nlp/llm.js (with src/nlp/schema.js)
- src/replies/templates/roman-ur.js and src/replies/templates/ur.js

All paths are relative to D:\FA23-BCS-7A\Advance Web Technologies\Voice Driven Business Automation Web App, which is currently empty.