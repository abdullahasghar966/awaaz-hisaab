import { createHash, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';

const PERIODS = ['today', 'yesterday', 'week', 'month'];
const TASK_STATUSES = ['open', 'done', 'all'];

// Hashing first gives both sides the same length, so timingSafeEqual never throws on length.
function tokensEqual(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

function clampLimit(value, fallback = 100) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 500);
}

export function createAdminRouter({ services, config }) {
  const router = Router();
  const { businesses, ledger, reports, tasks, messages } = services;

  router.use('/api/admin', (req, res, next) => {
    if (!config.adminToken) return res.status(503).json({ error: 'admin_disabled' });
    const header = req.get('authorization') ?? '';
    const match = /^Bearer (.+)$/.exec(header);
    if (!match || !tokensEqual(match[1], config.adminToken)) return res.status(401).json({ error: 'unauthorized' });
    return next();
  });

  router.get('/api/admin/businesses', (_req, res) => res.json(businesses.listBusinesses()));

  // Resolves :id to a business, or answers 404 (and returns null).
  function loadBusiness(req, res) {
    const id = Number(req.params.id);
    const business = Number.isInteger(id) && id > 0 ? businesses.getBusiness(id) : null;
    if (!business) {
      res.status(404).json({ error: 'business_not_found' });
      return null;
    }
    return business;
  }

  router.get('/api/admin/businesses/:id/summary', (req, res) => {
    const b = loadBusiness(req, res);
    if (!b) return;
    const period = PERIODS.includes(req.query.period) ? req.query.period : 'today';
    res.json({ summary: reports.summary(b.id, period), balances: ledger.getBalances(b.id) });
  });

  router.get('/api/admin/businesses/:id/transactions', (req, res) => {
    const b = loadBusiness(req, res);
    if (!b) return;
    res.json(ledger.listTransactions(b.id, { limit: clampLimit(req.query.limit) }));
  });

  router.get('/api/admin/businesses/:id/contacts', (req, res) => {
    const b = loadBusiness(req, res);
    if (!b) return;
    res.json(ledger.listContactBalances(b.id));
  });

  router.get('/api/admin/businesses/:id/tasks', (req, res) => {
    const b = loadBusiness(req, res);
    if (!b) return;
    const status = TASK_STATUSES.includes(req.query.status) ? req.query.status : 'open';
    res.json(tasks.list(b.id, { status }));
  });

  router.get('/api/admin/businesses/:id/staff', (req, res) => {
    const b = loadBusiness(req, res);
    if (!b) return;
    res.json(businesses.listStaff(b.id));
  });

  router.get('/api/admin/businesses/:id/trial-balance', (req, res) => {
    const b = loadBusiness(req, res);
    if (!b) return;
    res.json(ledger.trialBalance(b.id));
  });

  router.get('/api/admin/messages', (req, res) => {
    let businessId = null;
    if (req.query.businessId !== undefined && req.query.businessId !== '') {
      businessId = Number(req.query.businessId);
      if (!Number.isInteger(businessId) || !businesses.getBusiness(businessId)) {
        return res.status(404).json({ error: 'business_not_found' });
      }
    }
    return res.json(messages.list({ businessId, limit: clampLimit(req.query.limit) }));
  });

  return router;
}
