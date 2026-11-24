import { nowIso } from '../utils/time.js';

export function createConfirmationService(db, { clock, ttlMinutes = 10 }) {
  const q = {
    upsert: db.prepare(
      `INSERT INTO pending_confirmations (business_id, user_id, intent_json, source_message_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET business_id = excluded.business_id, intent_json = excluded.intent_json,
         source_message_id = excluded.source_message_id, created_at = excluded.created_at, expires_at = excluded.expires_at`,
    ),
    get: db.prepare(
      'SELECT id, business_id, intent_json, source_message_id, created_at, expires_at FROM pending_confirmations WHERE user_id = ?',
    ),
    del: db.prepare('DELETE FROM pending_confirmations WHERE user_id = ?'),
  };

  function create({ businessId, userId, sourceMessageId = null }, intentResult) {
    const now = clock.now();
    const expires = new Date(now.getTime() + ttlMinutes * 60 * 1000);
    q.upsert.run(businessId, userId, JSON.stringify(intentResult), sourceMessageId, nowIso(now), nowIso(expires));
  }

  // NOTE: keyed by userId only (user_id is UNIQUE and globally unique), per the contract.
  function getActive(userId) {
    const r = q.get.get(userId);
    if (!r) return null;
    if (r.expires_at <= nowIso(clock.now())) {
      q.del.run(userId);
      return null;
    }
    return {
      id: Number(r.id),
      intentResult: JSON.parse(r.intent_json),
      sourceMessageId: r.source_message_id === null ? null : Number(r.source_message_id),
      createdAt: r.created_at,
    };
  }

  function clear(userId) {
    q.del.run(userId);
  }

  return { create, getActive, clear };
}
