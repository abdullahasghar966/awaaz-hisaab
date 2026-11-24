import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/db.js';
import { fixedClock } from '../helpers/clock.js';
import { createServices } from '../../src/domain/index.js';

function setup() {
  const db = createTestDb();
  const svc = createServices(db, { clock: fixedClock(), timezone: 'Asia/Karachi' });
  const owner = svc.businesses.registerOwner({ phone: '923001234567' });
  const ali = svc.businesses.addStaff(owner.businessId, { name: 'Ali', phone: '923111111111' }).user;
  const sara = svc.businesses.addStaff(owner.businessId, { name: 'Sara', phone: '923222222222' }).user;
  const ctx = { businessId: owner.businessId, userId: owner.id };
  return { db, owner, ali, sara, ctx, ...svc };
}

test('assign numbers tasks per business', () => {
  const { tasks, ali, ctx, businesses } = setup();
  const t1 = tasks.assign(ctx, { assigneeUserId: ali.id, description: 'dukaan saaf karo', dueDate: '2026-11-25' });
  const t2 = tasks.assign(ctx, { assigneeUserId: ali.id, description: 'maal lao' });
  assert.equal(t1.taskNo, 1);
  assert.equal(t2.taskNo, 2);
  assert.equal(t1.assigneeName, 'Ali');
  assert.equal(t1.assigneePhone, '923111111111');
  assert.equal(t1.dueDate, '2026-11-25');
  assert.equal(t1.status, 'open');
  assert.equal(t2.dueDate, null);
  const o2 = businesses.registerOwner({ phone: '923009999999' });
  const s2 = businesses.addStaff(o2.businessId, { name: 'Ali', phone: '923118888888' }).user;
  assert.equal(tasks.assign({ businessId: o2.businessId, userId: o2.id }, { assigneeUserId: s2.id, description: 'x' }).taskNo, 1);
});

test('assign to unknown or foreign user throws STAFF_NOT_FOUND', () => {
  const { tasks, ctx, businesses } = setup();
  const o2 = businesses.registerOwner({ phone: '923009999999' });
  const s2 = businesses.addStaff(o2.businessId, { name: 'Zed', phone: '923118888888' }).user;
  assert.throws(() => tasks.assign(ctx, { assigneeUserId: 9999, description: 'x' }), { code: 'STAFF_NOT_FOUND' });
  assert.throws(() => tasks.assign(ctx, { assigneeUserId: s2.id, description: 'x' }), { code: 'STAFF_NOT_FOUND' });
});

test('staff completes own latest open task', () => {
  const { tasks, ali, ctx } = setup();
  tasks.assign(ctx, { assigneeUserId: ali.id, description: 'a' });
  tasks.assign(ctx, { assigneeUserId: ali.id, description: 'b' });
  const done = tasks.complete(ctx, { byUser: ali });
  assert.equal(done.taskNo, 2);
  assert.equal(done.status, 'done');
  assert.ok(done.completedAt);
  assert.equal(tasks.complete(ctx, { byUser: ali }).taskNo, 1);
  assert.throws(() => tasks.complete(ctx, { byUser: ali }), { code: 'TASK_NOT_FOUND' });
});

test('staff cannot complete another staff task', () => {
  const { tasks, ali, sara, ctx } = setup();
  tasks.assign(ctx, { assigneeUserId: ali.id, description: 'a' });
  assert.throws(() => tasks.complete(ctx, { taskNo: 1, byUser: sara }), { code: 'FORBIDDEN' });
  assert.equal(tasks.getByNo(ctx.businessId, 1).status, 'open');
  assert.equal(tasks.complete(ctx, { taskNo: 1, byUser: ali }).status, 'done');
  assert.throws(() => tasks.complete(ctx, { taskNo: 77, byUser: ali }), { code: 'TASK_NOT_FOUND' });
});

test('owner needs taskNo; done task returned as-is', () => {
  const { tasks, owner, ali, ctx } = setup();
  tasks.assign(ctx, { assigneeUserId: ali.id, description: 'a' });
  assert.throws(() => tasks.complete(ctx, { byUser: owner }), { code: 'TASK_NOT_FOUND' });
  assert.throws(() => tasks.complete(ctx, { taskNo: 5, byUser: owner }), { code: 'TASK_NOT_FOUND' });
  const d1 = tasks.complete(ctx, { taskNo: 1, byUser: owner });
  assert.equal(d1.status, 'done');
  const d2 = tasks.complete(ctx, { taskNo: 1, byUser: owner });
  assert.equal(d2.completedAt, d1.completedAt);
});

test('list filters by assignee and status', () => {
  const { tasks, owner, ali, sara, ctx, businesses } = setup();
  tasks.assign(ctx, { assigneeUserId: ali.id, description: 'a' });
  tasks.assign(ctx, { assigneeUserId: sara.id, description: 'b' });
  tasks.assign(ctx, { assigneeUserId: ali.id, description: 'c' });
  tasks.complete(ctx, { taskNo: 3, byUser: owner });
  assert.deepEqual(tasks.list(ctx.businessId, {}).map((t) => t.taskNo), [1, 2]);
  assert.deepEqual(tasks.list(ctx.businessId, { assigneeUserId: ali.id }).map((t) => t.taskNo), [1]);
  assert.deepEqual(tasks.list(ctx.businessId, { status: 'done' }).map((t) => t.taskNo), [3]);
  assert.deepEqual(tasks.list(ctx.businessId, { status: 'all' }).map((t) => t.taskNo), [1, 2, 3]);
  assert.deepEqual(tasks.list(ctx.businessId, { assigneeUserId: ali.id, status: 'all' }).map((t) => t.taskNo), [1, 3]);
  const o2 = businesses.registerOwner({ phone: '923009999999' });
  assert.equal(tasks.list(o2.businessId, { status: 'all' }).length, 0);
  assert.equal(tasks.getByNo(o2.businessId, 1), null);
});
