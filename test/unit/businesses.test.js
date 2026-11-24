import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/db.js';
import { fixedClock } from '../helpers/clock.js';
import { createServices } from '../../src/domain/index.js';

function setup() {
  const db = createTestDb();
  const svc = createServices(db, { clock: fixedClock(), timezone: 'Asia/Karachi' });
  return { db, ...svc };
}

test('registerOwner seeds 8 accounts and the owner user', () => {
  const { db, businesses } = setup();
  const u = businesses.registerOwner({ phone: '923001234567', name: 'Ahmed', businessName: 'Ahmed Store' });
  assert.equal(u.role, 'owner');
  assert.equal(u.businessName, 'Ahmed Store');
  assert.equal(u.name, 'Ahmed');
  assert.equal(u.active, true);
  const n = db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE business_id = ?').get(u.businessId).n;
  assert.equal(n, 8);
  assert.equal(businesses.findUserByPhone('923001234567').id, u.id);
  assert.equal(businesses.findUserByPhone('923009999999'), null);
});

test('registerOwner defaults and duplicate phone', () => {
  const { businesses } = setup();
  const u = businesses.registerOwner({ phone: '923001234567' });
  assert.equal(u.name, 'Malik');
  assert.equal(u.businessName, 'Mera Karobar');
  assert.throws(() => businesses.registerOwner({ phone: '923001234567' }), { code: 'PHONE_TAKEN' });
  assert.equal(businesses.listBusinesses().length, 1);
});

test('addStaff creates then updates by name', () => {
  const { businesses } = setup();
  const o = businesses.registerOwner({ phone: '923001234567' });
  const a = businesses.addStaff(o.businessId, { name: 'Ali', phone: '923111111111' });
  assert.equal(a.created, true);
  assert.equal(a.user.role, 'staff');
  const b = businesses.addStaff(o.businessId, { name: 'Ali', phone: '923222222222' });
  assert.equal(b.created, false);
  assert.equal(b.user.id, a.user.id);
  assert.equal(b.user.phone, '923222222222');
  assert.equal(businesses.listStaff(o.businessId).length, 1);
  assert.equal(businesses.findUserByPhone('923111111111'), null);
});

test('PHONE_TAKEN across businesses and for another user', () => {
  const { businesses } = setup();
  const o1 = businesses.registerOwner({ phone: '923001111111' });
  const o2 = businesses.registerOwner({ phone: '923002222222', name: 'Bilal' });
  assert.throws(() => businesses.addStaff(o1.businessId, { name: 'Ali', phone: '923002222222' }), { code: 'PHONE_TAKEN' });
  businesses.addStaff(o1.businessId, { name: 'Ali', phone: '923331111111' });
  assert.throws(() => businesses.addStaff(o2.businessId, { name: 'Ali', phone: '923331111111' }), { code: 'PHONE_TAKEN' });
  assert.throws(() => businesses.addStaff(o1.businessId, { name: 'Sara', phone: '923331111111' }), { code: 'PHONE_TAKEN' });
});

test('findStaffByName exact, prefix, contains', () => {
  const { businesses } = setup();
  const o = businesses.registerOwner({ phone: '923001234567' });
  businesses.addStaff(o.businessId, { name: 'Ali', phone: '923111111111' });
  businesses.addStaff(o.businessId, { name: 'Muhammad Usman', phone: '923222222222' });
  assert.equal(businesses.findStaffByName(o.businessId, 'ali').name, 'Ali');
  assert.equal(businesses.findStaffByName(o.businessId, 'Muham').name, 'Muhammad Usman');
  assert.equal(businesses.findStaffByName(o.businessId, 'usman').name, 'Muhammad Usman');
  assert.equal(businesses.findStaffByName(o.businessId, 'zzz'), null);
  assert.equal(businesses.findStaffByName(o.businessId, '%'), null);
});

test('contacts.findByName matches whole words only', () => {
  const { businesses, contacts } = setup();
  const o = businesses.registerOwner({ phone: '923001234567' });
  contacts.findOrCreate(o.businessId, 'Alina', 'customer');
  contacts.findOrCreate(o.businessId, 'Bilal Ahmed', 'supplier');
  assert.equal(contacts.findByName(o.businessId, 'Ali'), null);
  assert.equal(contacts.findByName(o.businessId, 'Ahmed').name, 'Bilal Ahmed');
  assert.equal(contacts.findByName(o.businessId, 'Bilal').name, 'Bilal Ahmed');
});

test('findStaffByName matches word starts only, not substrings inside a word', () => {
  const { businesses } = setup();
  const o = businesses.registerOwner({ phone: '923001234567' }); // default owner name "Malik"
  assert.equal(businesses.findStaffByName(o.businessId, 'ali'), null);
  assert.equal(businesses.findStaffByName(o.businessId, 'sma'), null);
  businesses.addStaff(o.businessId, { name: 'Muhammad Ali', phone: '923111111111' });
  assert.equal(businesses.findStaffByName(o.businessId, 'ali').name, 'Muhammad Ali');
});

test('isolation between businesses and misc getters', () => {
  const { businesses } = setup();
  const o1 = businesses.registerOwner({ phone: '923001111111' });
  const o2 = businesses.registerOwner({ phone: '923002222222' });
  businesses.addStaff(o1.businessId, { name: 'Ali', phone: '923331111111' });
  assert.equal(businesses.findStaffByName(o2.businessId, 'Zed'), null);
  assert.equal(businesses.listStaff(o2.businessId).length, 0);
  assert.equal(businesses.getOwner(o2.businessId).id, o2.id);
  businesses.setUserLanguage(o1.id, 'ur');
  assert.equal(businesses.getUserById(o1.id).language, 'ur');
  const list = businesses.listBusinesses();
  assert.equal(list[0].userCount, 2);
  assert.equal(list[1].userCount, 1);
  const b = businesses.getBusiness(o1.businessId);
  assert.equal(b.currency, 'PKR');
  assert.equal(b.timezone, 'Asia/Karachi');
  assert.equal(businesses.getBusiness(999), null);
});

test('contacts: findOrCreate type merging and isolation', () => {
  const { businesses, contacts } = setup();
  const o1 = businesses.registerOwner({ phone: '923001111111' });
  const o2 = businesses.registerOwner({ phone: '923002222222' });
  const c = contacts.findOrCreate(o1.businessId, 'Ahmed', 'customer');
  assert.equal(c.type, 'customer');
  assert.equal(contacts.findOrCreate(o1.businessId, 'ahmed', 'customer').id, c.id);
  assert.equal(contacts.findOrCreate(o1.businessId, 'Ahmed', 'supplier').type, 'both');
  assert.equal(contacts.findOrCreate(o1.businessId, 'Ahmed', 'other').type, 'both');
  assert.equal(contacts.findByName(o2.businessId, 'Ahmed'), null);
  assert.deepEqual(contacts.names(o1.businessId), ['Ahmed']);
  assert.equal(contacts.list(o2.businessId).length, 0);
});
