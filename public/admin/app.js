// Admin dashboard (6.17). Vanilla JS. Every value reaches the page through textContent, never innerHTML.

const TOKEN_KEY = 'awaazAdminToken';
const PERIODS = ['today', 'yesterday', 'week', 'month'];
const TASK_STATUSES = ['open', 'done', 'all'];

export const TABS = [
  { id: 'summary', label: 'Summary' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'contacts', label: 'Contacts and balances' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'staff', label: 'Staff' },
  { id: 'trial', label: 'Trial balance' },
  { id: 'messages', label: 'Messages log' },
];

// Rupee amount with Indian digit grouping, e.g. 150000 -> 'Rs 1,50,000'.
export function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const body = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Math.abs(n));
  return n < 0 ? `Rs -${body}` : `Rs ${body}`;
}

// Thin client for /api/admin/*. fetchImpl and getToken are injected so the client can be tested without a server.
export function createAdminApi({ baseUrl = '', fetchImpl = fetch, getToken = () => '' } = {}) {
  async function get(path, params = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
    }
    const query = search.toString() ? `?${search}` : '';
    const res = await fetchImpl(`${baseUrl}/api/admin${path}${query}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      const message =
        res.status === 401 ? 'The admin token was rejected.'
        : res.status === 404 ? 'Not found.'
        : res.status === 503 ? 'The admin API is disabled on the server (ADMIN_TOKEN is empty).'
        : `Request failed (HTTP ${res.status}).`;
      const error = new Error(message);
      error.status = res.status;
      throw error;
    }
    return res.json();
  }

  return {
    listBusinesses: () => get('/businesses'),
    summary: (id, period = 'today') => get(`/businesses/${id}/summary`, { period }),
    transactions: (id, limit = 100) => get(`/businesses/${id}/transactions`, { limit }),
    contacts: (id) => get(`/businesses/${id}/contacts`),
    tasks: (id, status = 'open') => get(`/businesses/${id}/tasks`, { status: TASK_STATUSES.includes(status) ? status : 'open' }),
    staff: (id) => get(`/businesses/${id}/staff`),
    trialBalance: (id) => get(`/businesses/${id}/trial-balance`),
    messages: (businessId, limit = 100) => get('/messages', { businessId, limit }),
  };
}

// Storage wrapper: private windows and blocked storage must not break the page.
export function readToken(storage) {
  try {
    return storage?.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function writeToken(storage, token) {
  try {
    if (token) storage?.setItem(TOKEN_KEY, token);
    else storage?.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable: the token lives only for this page load.
  }
}

// DOM helper: children may be nodes, strings (become text nodes) or arrays. Null/false are skipped.
export function el(tag, options = {}, ...children) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);
  for (const [name, value] of Object.entries(options.attrs ?? {})) node.setAttribute(name, String(value));
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

// columns: [{ key, label, format?, numeric? }]. Values are written with textContent only.
export function renderTable(columns, rows) {
  if (!rows || rows.length === 0) return el('p', { className: 'muted', text: 'No rows.' });
  const head = el('tr', {}, columns.map((c) => el('th', { text: c.label, className: c.numeric ? 'num' : '' })));
  const body = rows.map((row) =>
    el('tr', {}, columns.map((c) => {
      const raw = row[c.key];
      const shown = c.format ? c.format(raw, row) : raw;
      return el('td', { text: shown === null || shown === undefined ? '' : shown, className: c.numeric ? 'num' : '' });
    })),
  );
  return el('div', { className: 'table-wrap' }, el('table', {}, el('thead', {}, head), el('tbody', {}, body)));
}

function statGrid(items) {
  return el('div', { className: 'stats' }, items.map(([label, value]) =>
    el('div', { className: 'stat' },
      el('span', { className: 'stat-label', text: label }),
      el('strong', { className: 'stat-value', text: value }),
    ),
  ));
}

const yesNo = (v) => (v ? 'yes' : 'no');
const shortTime = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '');

// Each view takes (api, businessId, controls) and returns a DOM node. controls = { period, taskStatus }.
export const VIEWS = {
  async summary(api, id, controls) {
    const { summary, balances } = await api.summary(id, controls.period);
    return el('div', {},
      el('h3', { text: `Summary (${summary.from}${summary.to && summary.to !== summary.from ? ` to ${summary.to}` : ''})` }),
      statGrid([
        ['Sales', money(summary.sales)],
        ['Purchases', money(summary.purchases)],
        ['Expenses', money(summary.expenses)],
        ['Received', money(summary.received)],
        ['Paid', money(summary.paid)],
        ['Estimated profit', money(summary.net)],
        ['Cash', money(summary.cashBalance)],
        ['Entries', String(summary.txnCount)],
      ]),
      el('h3', { text: 'Balances' }),
      statGrid([
        ['Cash', money(balances.cash)],
        ['Bank', money(balances.bank)],
        ['Receivables', money(balances.receivables)],
        ['Payables', money(balances.payables)],
      ]),
    );
  },

  async transactions(api, id) {
    const rows = await api.transactions(id, 100);
    return renderTable([
      { key: 'txnNo', label: '#', numeric: true },
      { key: 'txnDate', label: 'Date' },
      { key: 'type', label: 'Type' },
      { key: 'amount', label: 'Amount', numeric: true, format: money },
      { key: 'paymentMode', label: 'Mode' },
      { key: 'contactName', label: 'Contact' },
      { key: 'item', label: 'Item' },
      { key: 'quantity', label: 'Qty', numeric: true },
      { key: 'unit', label: 'Unit' },
      { key: 'note', label: 'Note' },
      { key: 'voided', label: 'Voided', format: yesNo },
    ], rows);
  },

  async contacts(api, id) {
    const rows = await api.contacts(id);
    return renderTable([
      { key: 'name', label: 'Name' },
      { key: 'type', label: 'Type' },
      { key: 'balance', label: 'Balance (+ owes us, - we owe)', numeric: true, format: money },
    ], rows);
  },

  async tasks(api, id, controls) {
    const rows = await api.tasks(id, controls.taskStatus);
    return renderTable([
      { key: 'taskNo', label: '#', numeric: true },
      { key: 'description', label: 'Task' },
      { key: 'assigneeName', label: 'Assignee' },
      { key: 'dueDate', label: 'Due' },
      { key: 'status', label: 'Status' },
      { key: 'createdAt', label: 'Created', format: shortTime },
    ], rows);
  },

  async staff(api, id) {
    const rows = await api.staff(id);
    return renderTable([
      { key: 'name', label: 'Name' },
      { key: 'phone', label: 'Phone' },
      { key: 'role', label: 'Role' },
      { key: 'language', label: 'Language' },
      { key: 'active', label: 'Active', format: yesNo },
    ], rows);
  },

  async trial(api, id) {
    const tb = await api.trialBalance(id);
    return el('div', {},
      renderTable([
        { key: 'code', label: 'Code' },
        { key: 'name', label: 'Account' },
        { key: 'type', label: 'Type' },
        { key: 'debit', label: 'Debit', numeric: true, format: money },
        { key: 'credit', label: 'Credit', numeric: true, format: money },
        { key: 'balance', label: 'Balance', numeric: true, format: money },
      ], tb.accounts),
      el('p', { className: 'totals', text: `Total debit ${money(tb.totalDebit)} | Total credit ${money(tb.totalCredit)}` }),
    );
  },

  async messages(api, id) {
    const rows = await api.messages(id, 100);
    return renderTable([
      { key: 'createdAt', label: 'Time', format: shortTime },
      { key: 'direction', label: 'Dir' },
      { key: 'phone', label: 'Phone' },
      { key: 'msgType', label: 'Type' },
      { key: 'body', label: 'Body' },
      { key: 'transcript', label: 'Transcript' },
      { key: 'intent', label: 'Intent' },
      { key: 'status', label: 'Status' },
      { key: 'error', label: 'Error' },
    ], rows);
  },
};

// Browser wiring. Runs only on the admin page (it is a no-op when imported by tests).
export function init({ storage, fetchImpl, doc = globalThis.document } = {}) {
  const root = doc?.getElementById('admin-app');
  if (!root) return null;

  const $ = (id) => doc.getElementById(id);
  const state = { token: readToken(storage), tab: 'summary' };
  const api = createAdminApi({ fetchImpl, getToken: () => state.token });

  const tokenInput = $('token');
  const businessSelect = $('business');
  const periodSelect = $('period');
  const taskStatusSelect = $('task-status');
  const statusLine = $('status');
  const content = $('content');
  const tabList = $('tabs');

  tokenInput.value = state.token;

  function setStatus(text) {
    statusLine.textContent = text;
  }

  function syncControls() {
    periodSelect.hidden = state.tab !== 'summary';
    taskStatusSelect.hidden = state.tab !== 'tasks';
    for (const button of tabList.querySelectorAll('button')) {
      const active = button.dataset.tab === state.tab;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    }
  }

  async function loadTab() {
    if (!state.token) {
      content.replaceChildren();
      setStatus('Enter the admin token to load data.');
      return;
    }
    const businessId = businessSelect.value;
    if (!businessId && state.tab !== 'messages') {
      content.replaceChildren();
      setStatus('No business selected.');
      return;
    }
    setStatus('Loading...');
    try {
      const view = await VIEWS[state.tab](api, businessId, {
        period: periodSelect.value,
        taskStatus: taskStatusSelect.value,
      });
      content.replaceChildren(view);
      setStatus(`Updated ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      content.replaceChildren();
      setStatus(err.message);
    }
  }

  async function loadBusinesses() {
    if (!state.token) return loadTab();
    try {
      const list = await api.listBusinesses();
      businessSelect.replaceChildren(...list.map((b) => {
        const option = el('option', { text: `${b.name} (#${b.id})`, attrs: { value: b.id } });
        return option;
      }));
      if (list.length === 0) {
        content.replaceChildren();
        setStatus('No businesses yet. Send a message to the WhatsApp number or use the simulator.');
        return;
      }
      return loadTab();
    } catch (err) {
      setStatus(err.message);
    }
  }

  // Tabs
  for (const tab of TABS) {
    tabList.append(el('button', {
      text: tab.label,
      className: 'tab',
      attrs: { type: 'button', role: 'tab', 'data-tab': tab.id },
    }));
  }
  tabList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-tab]');
    if (!button) return;
    state.tab = button.dataset.tab;
    syncControls();
    loadTab();
  });
  tabList.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = TABS.findIndex((t) => t.id === state.tab);
    const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    state.tab = next.id;
    syncControls();
    tabList.querySelector(`button[data-tab="${next.id}"]`).focus();
    loadTab();
  });

  // Period and task status
  for (const period of PERIODS) periodSelect.append(el('option', { text: period, attrs: { value: period } }));
  for (const status of TASK_STATUSES) taskStatusSelect.append(el('option', { text: status, attrs: { value: status } }));
  periodSelect.addEventListener('change', loadTab);
  taskStatusSelect.addEventListener('change', loadTab);
  businessSelect.addEventListener('change', loadTab);
  $('refresh').addEventListener('click', loadTab);

  // Token form
  $('token-form').addEventListener('submit', (event) => {
    event.preventDefault();
    state.token = tokenInput.value.trim();
    writeToken(storage, state.token);
    loadBusinesses();
  });
  $('clear-token').addEventListener('click', () => {
    state.token = '';
    tokenInput.value = '';
    writeToken(storage, '');
    businessSelect.replaceChildren();
    content.replaceChildren();
    setStatus('Token cleared.');
  });

  syncControls();
  loadBusinesses();
  return { state, api };
}

if (typeof document !== 'undefined' && document.getElementById('admin-app')) {
  init({ storage: globalThis.localStorage, fetchImpl: (...args) => globalThis.fetch(...args) });
}
