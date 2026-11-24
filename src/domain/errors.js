// codes: CONTACT_NOT_FOUND, STAFF_NOT_FOUND, TASK_NOT_FOUND, PHONE_TAKEN, INVALID_AMOUNT, FORBIDDEN,
// NOTHING_TO_UNDO, UNBALANCED_ENTRY
export class DomainError extends Error {
  constructor(code, message = code, details = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}
