import { nowIso } from '../utils/time.js';

const UPDATABLE = {
  businessId: 'business_id',
  transcript: 'transcript',
  language: 'language',
  intent: 'intent',
  intentJson: 'intent_json',
  status: 'status',
  error: 'error',
};

function mapRow(r) {
  return {
    id: Number(r.id),
    businessId: r.business_id === null ? null : Number(r.business_id),
    direction: r.direction,
    phone: r.phone,
    waMessageId: r.wa_message_id,
    msgType: r.msg_type,
    body: r.body,
    mediaId: r.media_id,
    transcript: r.transcript,
    language: r.language,
    intent: r.intent,
    intentJson: r.intent_json,
    status: r.status,
    error: r.error,
    inReplyTo: r.in_reply_to,
    createdAt: r.created_at,
  };
}

export function createMessageLog(db, { clock }) {
  const q = {
    insIn: db.prepare(
      `INSERT INTO messages (business_id, direction, phone, wa_message_id, msg_type, body, media_id, status, created_at)
       VALUES (?, 'in', ?, ?, ?, ?, ?, 'received', ?)
       ON CONFLICT(wa_message_id) DO NOTHING`,
    ),
    byWaId: db.prepare('SELECT id FROM messages WHERE wa_message_id = ?'),
    insOut: db.prepare(
      `INSERT INTO messages (business_id, direction, phone, wa_message_id, msg_type, body, status, error, in_reply_to, created_at)
       VALUES (?, 'out', ?, ?, 'text', ?, ?, ?, ?, ?)`,
    ),
    listAll: db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT ?'),
    listBiz: db.prepare('SELECT * FROM messages WHERE business_id = ? ORDER BY id DESC LIMIT ?'),
  };

  function recordInbound({ waMessageId = null, phone, msgType, body = null, mediaId = null, businessId = null }) {
    const res = q.insIn.run(businessId, phone, waMessageId, msgType, body, mediaId, nowIso(clock.now()));
    if (Number(res.changes) === 0) {
      // NOTE: wa_message_id is a global idempotency key (Meta ids are globally unique), so no business filter here.
      return { id: Number(q.byWaId.get(waMessageId).id), duplicate: true };
    }
    return { id: Number(res.lastInsertRowid), duplicate: false };
  }

  function updateInbound(id, fields) {
    const sets = [];
    const params = [];
    for (const [key, col] of Object.entries(UPDATABLE)) {
      if (!Object.hasOwn(fields, key) || fields[key] === undefined) continue;
      let v = fields[key];
      if (key === 'intentJson' && v !== null && typeof v !== 'string') v = JSON.stringify(v);
      sets.push(`${col} = ?`);
      params.push(v);
    }
    if (sets.length === 0) return;
    // NOTE: inbound rows may have business_id NULL until the sender is resolved, so the update is keyed by id only.
    db.prepare(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  }

  function recordOutbound({ phone, body, businessId = null, waMessageId = null, status, error = null, inReplyTo = null }) {
    return Number(
      q.insOut.run(businessId, phone, waMessageId, body, status ?? 'sent', error, inReplyTo, nowIso(clock.now()))
        .lastInsertRowid,
    );
  }

  function list({ businessId = null, limit = 100 } = {}) {
    // NOTE: businessId null lists every business (admin/ops view); otherwise the query is filtered.
    const rows = businessId === null ? q.listAll.all(limit) : q.listBiz.all(businessId, limit);
    return rows.map(mapRow);
  }

  return { recordInbound, updateInbound, recordOutbound, list };
}
