import { normalizeText } from '../utils/text.js';
import { nowIso } from '../utils/time.js';
import { escapeLike } from './businesses.js';

const SEL = 'SELECT id, business_id, name, type, phone, created_at FROM contacts';

function mapContact(r) {
  if (!r) return null;
  return { id: Number(r.id), businessId: Number(r.business_id), name: r.name, type: r.type, phone: r.phone, createdAt: r.created_at };
}

export function createContactService(db, { clock }) {
  const q = {
    exact: db.prepare(`${SEL} WHERE business_id = ? AND name_norm = ? LIMIT 1`),
    like: db.prepare(`${SEL} WHERE business_id = ? AND name_norm LIKE ? ESCAPE '\\' ORDER BY id LIMIT 1`),
    ins: db.prepare('INSERT INTO contacts (business_id, name, name_norm, type, created_at) VALUES (?, ?, ?, ?, ?)'),
    setType: db.prepare('UPDATE contacts SET type = ? WHERE id = ? AND business_id = ?'),
    byId: db.prepare(`${SEL} WHERE business_id = ? AND id = ?`),
    list: db.prepare(`${SEL} WHERE business_id = ? ORDER BY name_norm`),
  };

  function findByName(businessId, name) {
    const norm = normalizeText(name ?? '');
    if (!norm) return null;
    const esc = escapeLike(norm);
    return (
      mapContact(q.exact.get(businessId, norm)) ??
      // NOTE: whole-word match only, so money is never posted to a different person:
      // "Ahmed" finds "Ahmed Khan" and "Bilal Ahmed", but "Ali" never finds "Alina" or "Malik".
      mapContact(q.like.get(businessId, `${esc} %`)) ??
      mapContact(q.like.get(businessId, `% ${esc}`)) ??
      mapContact(q.like.get(businessId, `% ${esc} %`))
    );
  }

  function findOrCreate(businessId, name, typeHint = 'other') {
    const existing = findByName(businessId, name);
    if (existing) {
      let next = existing.type;
      if (typeHint !== 'other' && existing.type !== typeHint) {
        // NOTE: an existing 'other' contact simply takes the hint; a customer/supplier clash becomes 'both'.
        next = existing.type === 'other' ? typeHint : 'both';
      }
      if (next !== existing.type) {
        q.setType.run(next, existing.id, businessId);
        return mapContact(q.byId.get(businessId, existing.id));
      }
      return existing;
    }
    const id = Number(
      q.ins.run(businessId, String(name).trim(), normalizeText(name), typeHint, nowIso(clock.now())).lastInsertRowid,
    );
    return mapContact(q.byId.get(businessId, id));
  }

  return {
    findByName,
    findOrCreate,
    list: (businessId) => q.list.all(businessId).map(mapContact),
    names: (businessId) => q.list.all(businessId).map((r) => r.name),
  };
}
