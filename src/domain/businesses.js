import { withTransaction } from '../db/index.js';
import { normalizeText } from '../utils/text.js';
import { nowIso } from '../utils/time.js';
import { DomainError } from './errors.js';

const ACCOUNTS = [
  ['CASH', 'Cash in hand (Galla)', 'asset'],
  ['BANK', 'Bank / Mobile wallet', 'asset'],
  ['AR', 'Receivables (Udhaar lena)', 'asset'],
  ['AP', 'Payables (Udhaar dena)', 'liability'],
  ['SALES', 'Sales', 'income'],
  ['PURCHASES', 'Purchases', 'expense'],
  ['EXPENSES', 'Expenses', 'expense'],
  ['EQUITY', 'Owner equity', 'equity'],
];

const USER_SELECT = `SELECT u.id, u.business_id, b.name AS business_name, u.name, u.phone, u.role, u.language, u.active
  FROM users u JOIN businesses b ON b.id = u.business_id`;

function mapUser(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    businessId: Number(r.business_id),
    businessName: r.business_name,
    name: r.name,
    phone: r.phone,
    role: r.role,
    language: r.language,
    active: r.active === 1,
  };
}

export function escapeLike(s) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function createBusinessService(db, { clock }) {
  const q = {
    userByPhone: db.prepare(`${USER_SELECT} WHERE u.phone = ? AND u.active = 1`),
    userById: db.prepare(`${USER_SELECT} WHERE u.id = ?`),
    phoneOwner: db.prepare('SELECT id, business_id FROM users WHERE phone = ?'),
    insBusiness: db.prepare('INSERT INTO businesses (name, owner_phone, created_at) VALUES (?, ?, ?)'),
    insAccount: db.prepare('INSERT INTO accounts (business_id, code, name, type) VALUES (?, ?, ?, ?)'),
    insUser: db.prepare(
      'INSERT INTO users (business_id, phone, name, name_norm, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    staffByNorm: db.prepare('SELECT id, role FROM users WHERE business_id = ? AND name_norm = ?'),
    updPhone: db.prepare('UPDATE users SET phone = ?, active = 1 WHERE id = ? AND business_id = ?'),
    findExact: db.prepare(`${USER_SELECT} WHERE u.business_id = ? AND u.name_norm = ? ORDER BY u.id LIMIT 1`),
    findLike: db.prepare(
      `${USER_SELECT} WHERE u.business_id = ? AND u.name_norm LIKE ? ESCAPE '\\' ORDER BY u.id LIMIT 1`,
    ),
    listStaff: db.prepare(`${USER_SELECT} WHERE u.business_id = ? AND u.role = 'staff' ORDER BY u.id`),
    owner: db.prepare(`${USER_SELECT} WHERE u.business_id = ? AND u.role = 'owner' ORDER BY u.id LIMIT 1`),
    setLang: db.prepare('UPDATE users SET language = ? WHERE id = ?'),
    listBiz: db.prepare(
      `SELECT b.id, b.name, b.owner_phone, b.created_at,
              (SELECT COUNT(*) FROM users u WHERE u.business_id = b.id) AS user_count
       FROM businesses b ORDER BY b.id`,
    ),
    getBiz: db.prepare('SELECT id, name, owner_phone, currency, timezone, created_at FROM businesses WHERE id = ?'),
  };

  function findUserByPhone(phone) {
    return mapUser(q.userByPhone.get(String(phone)));
  }

  function registerOwner({ phone, name = null, businessName = null }) {
    return withTransaction(db, () => {
      if (q.phoneOwner.get(String(phone))) {
        throw new DomainError('PHONE_TAKEN', 'Phone already registered', { phone });
      }
      const now = nowIso(clock.now());
      const ownerName = name ?? 'Malik';
      const bizName = businessName ?? `${name ?? 'Mera'} Karobar`;
      const bizId = Number(q.insBusiness.run(bizName, String(phone), now).lastInsertRowid);
      for (const [code, accName, type] of ACCOUNTS) q.insAccount.run(bizId, code, accName, type);
      const userId = Number(
        q.insUser.run(bizId, String(phone), ownerName, normalizeText(ownerName), 'owner', now).lastInsertRowid,
      );
      return mapUser(q.userById.get(userId));
    });
  }

  function addStaff(businessId, { name, phone }) {
    return withTransaction(db, () => {
      const norm = normalizeText(name);
      const phoneRow = phone ? q.phoneOwner.get(String(phone)) : null;
      const existing = q.staffByNorm.get(businessId, norm);
      // NOTE: the owner shares the (business, name) uniqueness; never rewrite the owner's phone as if they were staff.
      if (existing && existing.role !== 'staff') {
        throw new DomainError('NAME_TAKEN', 'Name already used by the owner', { name });
      }
      if (phoneRow && !(existing && Number(phoneRow.id) === Number(existing.id))) {
        throw new DomainError('PHONE_TAKEN', 'Phone already in use', { phone });
      }
      if (existing) {
        q.updPhone.run(phone ? String(phone) : null, existing.id, businessId);
        return { user: mapUser(q.userById.get(existing.id)), created: false };
      }
      const id = Number(
        q.insUser.run(businessId, phone ? String(phone) : null, name, norm, 'staff', nowIso(clock.now()))
          .lastInsertRowid,
      );
      return { user: mapUser(q.userById.get(id)), created: true };
    });
  }

  // name_norm exact, then prefix, then contains; any role
  function findStaffByName(businessId, name) {
    const norm = normalizeText(name ?? '');
    if (!norm) return null;
    const esc = escapeLike(norm);
    return (
      mapUser(q.findExact.get(businessId, norm)) ??
      mapUser(q.findLike.get(businessId, `${esc}%`)) ??
      // NOTE: word-prefix match only ("Ali" finds "Muhammad Ali" but not "Malik").
      mapUser(q.findLike.get(businessId, `% ${esc}%`))
    );
  }

  return {
    findUserByPhone,
    registerOwner,
    addStaff,
    findStaffByName,
    listStaff: (businessId) => q.listStaff.all(businessId).map(mapUser),
    getOwner: (businessId) => mapUser(q.owner.get(businessId)),
    getUserById: (id) => mapUser(q.userById.get(id)),
    setUserLanguage: (userId, language) => {
      // NOTE: the contract takes no businessId here; users.id is a global primary key.
      q.setLang.run(language, userId);
    },
    listBusinesses: () =>
      q.listBiz.all().map((r) => ({
        id: Number(r.id),
        name: r.name,
        ownerPhone: r.owner_phone,
        createdAt: r.created_at,
        userCount: Number(r.user_count),
      })),
    getBusiness: (id) => {
      const r = q.getBiz.get(id);
      return r
        ? { id: Number(r.id), name: r.name, ownerPhone: r.owner_phone, currency: r.currency, timezone: r.timezone, createdAt: r.created_at }
        : null;
    },
  };
}
