import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, startTestServer } from '../helpers/app.js';

const OWNER = '923001112222';
const auth = { Authorization: 'Bearer test-token' };

async function get(baseUrl, path, headers = auth) {
  const res = await fetch(`${baseUrl}/api/admin${path}`, { headers });
  return { status: res.status, body: await res.json() };
}

describe('admin API', () => {
  it('requires the bearer token (401) and is disabled without ADMIN_TOKEN (503)', async () => {
    const s = await startTestServer();
    const off = await startTestServer({ ADMIN_TOKEN: '' });
    try {
      assert.equal((await get(s.baseUrl, '/businesses', {})).status, 401);
      assert.equal((await get(s.baseUrl, '/businesses', { Authorization: 'Bearer wrong' })).status, 401);
      assert.equal((await get(s.baseUrl, '/businesses', { Authorization: 'test-token' })).status, 401);
      assert.equal((await get(off.baseUrl, '/businesses', auth)).status, 503);
    } finally {
      await s.close();
      await off.close();
    }
  });

  it('returns data produced by simulated messages', async () => {
    const s = await startTestServer();
    try {
      for (const text of [
        'aaj 5000 ki sale hui',
        'Ahmed ko 8000 ka maal udhaar par becha',
        'bijli ka bill 3500 diya',
      ]) await simulate(s.baseUrl, { from: OWNER, text });
      await simulate(s.baseUrl, { from: OWNER, text: 'Kamran ko staff mein add karo 0300-1234567' });
      await simulate(s.baseUrl, { from: OWNER, text: 'Kamran ko kal tak cement deliver karne ka kaam do' });

      const biz = await get(s.baseUrl, '/businesses');
      assert.equal(biz.body.length, 1);
      const id = biz.body[0].id;

      const summary = await get(s.baseUrl, `/businesses/${id}/summary?period=today`);
      assert.equal(summary.body.summary.sales, 13000);
      assert.equal(summary.body.summary.expenses, 3500);
      assert.equal(summary.body.balances.cash, 1500);

      const txns = await get(s.baseUrl, `/businesses/${id}/transactions?limit=10`);
      assert.equal(txns.body.length, 3);
      assert.ok(txns.body.some((t) => t.type === 'sale' && t.amount === 5000));

      const contacts = await get(s.baseUrl, `/businesses/${id}/contacts`);
      assert.equal(contacts.body.find((c) => c.name === 'Ahmed').balance, 8000);

      const tasks = await get(s.baseUrl, `/businesses/${id}/tasks?status=open`);
      assert.equal(tasks.body.length, 1);
      assert.equal(tasks.body[0].assigneeName, 'Kamran');

      const staff = await get(s.baseUrl, `/businesses/${id}/staff`);
      assert.equal(staff.body.length, 1);

      const tb = await get(s.baseUrl, `/businesses/${id}/trial-balance`);
      assert.equal(tb.body.totalDebit, tb.body.totalCredit);

      const msgs = await get(s.baseUrl, `/messages?businessId=${id}&limit=50`);
      assert.ok(msgs.body.length >= 5);
      assert.ok(msgs.body.some((m) => m.direction === 'out'));
      assert.equal((await get(s.baseUrl, '/messages')).status, 200);
    } finally {
      await s.close();
    }
  });

  it('answers 404 for an unknown business and 404 for a bad id', async () => {
    const s = await startTestServer();
    try {
      for (const p of ['/businesses/999/summary', '/businesses/999/transactions', '/businesses/abc/staff', '/messages?businessId=999']) {
        assert.equal((await get(s.baseUrl, p)).status, 404, p);
      }
    } finally {
      await s.close();
    }
  });

  it('serves the dashboard page', async () => {
    const s = await startTestServer();
    try {
      assert.equal((await fetch(`${s.baseUrl}/admin/`)).status, 200);
    } finally {
      await s.close();
    }
  });
});
