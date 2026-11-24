import { withTransaction } from '../db/index.js';
import { nowIso } from '../utils/time.js';
import { DomainError } from './errors.js';

const SEL = `SELECT t.id, t.task_no, t.description, t.due_date, t.status, t.assignee_user_id, t.created_at, t.completed_at,
    u.name AS assignee_name, u.phone AS assignee_phone
  FROM tasks t JOIN users u ON u.id = t.assignee_user_id AND u.business_id = t.business_id`;

function mapTask(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    taskNo: Number(r.task_no),
    description: r.description,
    dueDate: r.due_date,
    status: r.status,
    assigneeUserId: Number(r.assignee_user_id),
    assigneeName: r.assignee_name,
    assigneePhone: r.assignee_phone,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  };
}

export function createTaskService(db, { clock }) {
  const q = {
    assignee: db.prepare('SELECT id FROM users WHERE id = ? AND business_id = ? AND active = 1'),
    nextNo: db.prepare('SELECT COALESCE(MAX(task_no), 0) + 1 AS n FROM tasks WHERE business_id = ?'),
    ins: db.prepare(
      `INSERT INTO tasks (business_id, task_no, description, assignee_user_id, created_by, due_date, source_message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    byNo: db.prepare(`${SEL} WHERE t.business_id = ? AND t.task_no = ?`),
    latestOpen: db.prepare(
      `${SEL} WHERE t.business_id = ? AND t.assignee_user_id = ? AND t.status = 'open' ORDER BY t.task_no DESC LIMIT 1`,
    ),
    done: db.prepare("UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ? AND business_id = ?"),
    list: db.prepare(
      `${SEL} WHERE t.business_id = ? AND (? IS NULL OR t.assignee_user_id = ?) AND (? = 'all' OR t.status = ?)
       ORDER BY t.task_no ASC`,
    ),
  };

  const getByNo = (businessId, taskNo) => mapTask(q.byNo.get(businessId, taskNo));

  function assign(ctx, { assigneeUserId, description, dueDate = null }) {
    return withTransaction(db, () => {
      if (!q.assignee.get(assigneeUserId, ctx.businessId)) {
        throw new DomainError('STAFF_NOT_FOUND', 'Assignee not found', { assigneeUserId });
      }
      const taskNo = Number(q.nextNo.get(ctx.businessId).n);
      q.ins.run(
        ctx.businessId, taskNo, description, assigneeUserId, ctx.userId ?? null, dueDate,
        ctx.sourceMessageId ?? null, nowIso(clock.now()),
      );
      return getByNo(ctx.businessId, taskNo);
    });
  }

  function complete(ctx, { taskNo = null, byUser }) {
    return withTransaction(db, () => {
      const businessId = ctx.businessId;
      let task;
      if (byUser.role === 'staff') {
        if (taskNo === null || taskNo === undefined) {
          task = mapTask(q.latestOpen.get(businessId, byUser.id));
        } else {
          task = getByNo(businessId, taskNo);
          if (task && task.assigneeUserId !== byUser.id) {
            throw new DomainError('FORBIDDEN', 'Task is assigned to someone else', { taskNo });
          }
        }
      } else {
        if (taskNo === null || taskNo === undefined) throw new DomainError('TASK_NOT_FOUND', 'Task number required');
        task = getByNo(businessId, taskNo);
      }
      if (!task) throw new DomainError('TASK_NOT_FOUND', 'Task not found', { taskNo });
      // NOTE: only open tasks change state; done/cancelled tasks are returned as-is.
      if (task.status !== 'open') return task;
      q.done.run(nowIso(clock.now()), task.id, businessId);
      return getByNo(businessId, task.taskNo);
    });
  }

  function list(businessId, { assigneeUserId = null, status = 'open' } = {}) {
    return q.list.all(businessId, assigneeUserId, assigneeUserId, status, status).map(mapTask);
  }

  return { assign, complete, list, getByNo };
}
