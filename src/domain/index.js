import { createBusinessService } from './businesses.js';
import { createContactService } from './contacts.js';
import { createLedgerService } from './ledger.js';
import { createTaskService } from './tasks.js';
import { createReportService } from './reports.js';
import { createMessageLog } from './messages.js';
import { createConfirmationService } from './confirmations.js';

export { DomainError } from './errors.js';

export function createServices(db, { clock, timezone, confirmTtlMinutes = 10 }) {
  const businesses = createBusinessService(db, { clock });
  const contacts = createContactService(db, { clock });
  const ledger = createLedgerService(db, { clock, timezone, contacts });
  const tasks = createTaskService(db, { clock });
  const reports = createReportService(db, { clock, timezone, ledger });
  const messages = createMessageLog(db, { clock });
  const confirmations = createConfirmationService(db, { clock, ttlMinutes: confirmTtlMinutes });
  return { businesses, contacts, ledger, tasks, reports, messages, confirmations };
}
