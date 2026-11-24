// Intent -> domain call -> HandlerResult. Also holds the permission and confirmation rules.
import { DomainError } from '../domain/errors.js';
import { WRITE_INTENTS } from '../nlp/schema.js';

export const STAFF_ALLOWED = new Set([
  'record_sale', 'record_expense', 'payment_received', 'complete_task', 'list_tasks', 'help', 'confirm', 'cancel', 'unknown',
]);

export function isAllowed(role, intent) {
  if (role === 'owner') return true;
  return STAFF_ALLOWED.has(intent);
}

// Only write intents are ever held back for confirmation.
export function needsConfirmation(intentResult, confirmCfg) {
  if (!WRITE_INTENTS.includes(intentResult.intent)) return false;
  if (intentResult.intent === 'undo_last') return true;
  return (intentResult.entities?.amount ?? 0) >= confirmCfg.amountThreshold || intentResult.confidence < confirmCfg.minConfidence;
}

export function createHandlers({ services }) {
  const { businesses, contacts, ledger, tasks, reports } = services;

  // Shared reply shape for the money-moving intents.
  function txnReply(key, r, e) {
    return {
      key,
      data: {
        amount: r.amount,
        contactName: r.contact?.name ?? null,
        paymentMode: r.paymentMode,
        item: e.item ?? null,
        quantity: e.quantity ?? null,
        unit: e.unit ?? null,
        txnNo: r.txnNo,
        contactBalance: r.contactBalance,
      },
    };
  }

  async function run(result, { user, sourceMessageId = null }) {
    const e = result.entities ?? {};
    const ctx = { businessId: user.businessId, userId: user.id, sourceMessageId };

    switch (result.intent) {
      case 'record_sale':
        return txnReply('sale_recorded', ledger.recordSale(ctx, {
          amount: e.amount, contactName: e.contactName, paymentMode: e.paymentMode ?? 'cash',
          item: e.item, quantity: e.quantity, unit: e.unit, note: e.note,
        }), e);
      case 'record_purchase':
        return txnReply('purchase_recorded', ledger.recordPurchase(ctx, {
          amount: e.amount, contactName: e.contactName, paymentMode: e.paymentMode ?? 'cash',
          item: e.item, quantity: e.quantity, unit: e.unit, note: e.note,
        }), e);
      case 'record_expense': {
        const category = e.category ?? 'general';
        const r = ledger.recordExpense(ctx, { amount: e.amount, category, paymentMode: e.paymentMode ?? 'cash', note: e.note });
        return { key: 'expense_recorded', data: { amount: r.amount, category, txnNo: r.txnNo } };
      }
      case 'payment_received':
        return txnReply('payment_received_recorded', ledger.recordPaymentReceived(ctx, {
          amount: e.amount, contactName: e.contactName, paymentMode: e.paymentMode ?? 'cash',
        }), e);
      case 'payment_made':
        return txnReply('payment_made_recorded', ledger.recordPaymentMade(ctx, {
          amount: e.amount, contactName: e.contactName, paymentMode: e.paymentMode ?? 'cash',
        }), e);
      case 'credit_given':
        return txnReply('credit_given_recorded', ledger.recordCreditGiven(ctx, {
          amount: e.amount, contactName: e.contactName, note: e.note,
        }), e);
      case 'credit_taken':
        return txnReply('credit_taken_recorded', ledger.recordCreditTaken(ctx, {
          amount: e.amount, contactName: e.contactName, note: e.note,
        }), e);

      case 'add_staff': {
        const { user: staff, created } = businesses.addStaff(user.businessId, { name: e.staffName, phone: e.staffPhone });
        return { key: 'staff_added', data: { staffName: staff.name, staffPhone: e.staffPhone, created } };
      }

      case 'assign_task': {
        const staff = businesses.findStaffByName(user.businessId, e.staffName);
        if (!staff) return { key: 'not_found_staff', data: { name: e.staffName } };
        const task = tasks.assign(ctx, { assigneeUserId: staff.id, description: e.taskDescription, dueDate: e.dueDate ?? null });
        const staffNotified = Boolean(staff.phone) && staff.id !== user.id;
        const out = {
          key: 'task_assigned',
          data: { taskNo: task.taskNo, staffName: staff.name, description: task.description, dueDate: task.dueDate, staffNotified },
        };
        if (staffNotified) {
          out.notify = [{
            userId: staff.id,
            key: 'task_notification',
            data: { taskNo: task.taskNo, businessName: user.businessName, description: task.description, dueDate: task.dueDate },
          }];
        }
        return out;
      }

      case 'complete_task': {
        const task = tasks.complete(ctx, { taskNo: e.taskRef ?? null, byUser: user });
        const out = { key: 'task_completed', data: { taskNo: task.taskNo, description: task.description } };
        if (user.role === 'staff') {
          const owner = businesses.getOwner(user.businessId);
          if (owner) {
            out.notify = [{
              userId: owner.id,
              key: 'task_completed_owner_notice',
              data: { taskNo: task.taskNo, description: task.description, staffName: user.name },
            }];
          }
        }
        return out;
      }

      case 'list_tasks': {
        let assigneeUserId = null;
        let staffName = null;
        if (user.role === 'staff') {
          assigneeUserId = user.id;
          staffName = user.name;
        } else if (e.staffName) {
          const staff = businesses.findStaffByName(user.businessId, e.staffName);
          if (!staff) return { key: 'not_found_staff', data: { name: e.staffName } };
          assigneeUserId = staff.id;
          staffName = staff.name;
        }
        const list = tasks.list(user.businessId, { assigneeUserId, status: 'open' });
        return {
          key: 'task_list',
          data: {
            staffName,
            tasks: list.map((t) => ({
              taskNo: t.taskNo, description: t.description, staffName: t.assigneeName, dueDate: t.dueDate, status: t.status,
            })),
          },
        };
      }

      case 'daily_summary':
        return { key: 'daily_summary', data: reports.summary(user.businessId, e.period ?? 'today') };
      case 'balance_query':
        return { key: 'balance', data: ledger.getBalances(user.businessId) };

      case 'contact_balance': {
        const contact = contacts.findByName(user.businessId, e.contactName);
        if (!contact) return { key: 'not_found_contact', data: { name: e.contactName } };
        return {
          key: 'contact_balance',
          data: { contactName: contact.name, balance: ledger.getContactBalance(user.businessId, contact.id) },
        };
      }

      case 'undo_last': {
        const r = ledger.voidLastTransaction(ctx);
        return { key: 'undo_done', data: { txnNo: r.txnNo, type: r.type, amount: r.amount } };
      }

      case 'help':
        return { key: 'help', data: {} };
      default:
        return { key: 'unknown', data: {} };
    }
  }

  async function execute(result, ctx) {
    try {
      return await run(result, ctx);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      const e = result.entities ?? {};
      switch (err.code) {
        case 'CONTACT_NOT_FOUND': return { key: 'not_found_contact', data: { name: e.contactName ?? err.details?.name ?? null } };
        case 'STAFF_NOT_FOUND': return { key: 'not_found_staff', data: { name: e.staffName ?? err.details?.name ?? null } };
        case 'TASK_NOT_FOUND': return { key: 'not_found_task', data: { taskRef: e.taskRef ?? null } };
        case 'NOTHING_TO_UNDO': return { key: 'nothing_to_undo', data: {} };
        case 'PHONE_TAKEN': return { key: 'phone_taken', data: { phone: e.staffPhone ?? err.details?.phone ?? null } };
        case 'FORBIDDEN': return { key: 'permission_denied', data: {} };
        default: throw err;
      }
    }
  }

  return { execute };
}
