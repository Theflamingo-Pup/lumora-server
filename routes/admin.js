// ============================================================
// ROUTE — /api/admin (Obsidian Console — Rookery)
// All endpoints require Veilkey + magister role.
// Every privileged action emits a Cairn audit log entry.
// ============================================================

const express  = require('express');
const { z }    = require('zod');

const Pilgrim        = require('../models/Pilgrim');
const Tessera        = require('../models/Tessera');
const WaitlistEntry  = require('../models/WaitlistEntry');
const CairnLog       = require('../models/CairnLog');
const VeilkeySession = require('../models/VeilkeySession');
const { requireMagisterChain } = require('../middleware/requireMagister');

const router = express.Router();

// All routes require Veilkey + magister role
router.use(requireMagisterChain);

// ── Helpers ──────────────────────────────────────────────────
function parsePagination(req, { defaultLimit = 25, maxLimit = 200 } = {}) {
  const page  = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(req.query.limit || defaultLimit, 10) || defaultLimit));
  const skip  = (page - 1) * limit;
  return { page, limit, skip };
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ============================================================
// GET /api/admin/stats — Rookery Dashboard counters (OBS-019)
// ============================================================
router.get('/stats', async (req, res) => {
  try {
    const now = new Date();
    const dayAgo  = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() -  7 * 24 * 60 * 60 * 1000);

    const [
      waitlistTotal,
      waitlistDay,
      waitlistWeek,
      pilgrimsTotal,
      pilgrimsActive,
      pilgrimsSuspended,
      pilgrimsHaloVerified,
      cairnDay,
    ] = await Promise.all([
      WaitlistEntry.estimatedDocumentCount(),
      WaitlistEntry.countDocuments({ createdAt: { $gte: dayAgo } }),
      WaitlistEntry.countDocuments({ createdAt: { $gte: weekAgo } }),
      Pilgrim.estimatedDocumentCount(),
      Pilgrim.countDocuments({ status: 'active' }),
      Pilgrim.countDocuments({ status: 'suspended' }),
      Pilgrim.countDocuments({ isHaloVerified: true }),
      CairnLog.countDocuments({ createdAt: { $gte: dayAgo } }),
    ]);

    res.json({
      ok: true,
      now: now.toISOString(),
      waitlist: {
        total: waitlistTotal,
        last24h: waitlistDay,
        last7d:  waitlistWeek,
      },
      pilgrims: {
        total:        pilgrimsTotal,
        active:       pilgrimsActive,
        suspended:    pilgrimsSuspended,
        haloVerified: pilgrimsHaloVerified,
      },
      cairns: { last24h: cairnDay },
    });
  } catch (err) {
    console.error('[admin/stats]', err);
    res.status(500).json({ ok: false, code: 'STATS_ERROR', message: err.message });
  }
});

// ============================================================
// GET /api/admin/waitlist — paginated list with search
// ?page=1&limit=25&q=jordan&platform=ios
// ============================================================
router.get('/waitlist', async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const q = (req.query.q || '').toString().trim();
    const platform = (req.query.platform || '').toString().trim();

    const filter = {};
    if (q) {
      // case-insensitive search across name, email, city
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { city: rx }];
    }
    if (platform && ['ios', 'android', 'web', 'any'].includes(platform)) {
      filter.platform = platform;
    }

    const [items, total] = await Promise.all([
      WaitlistEntry.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      WaitlistEntry.countDocuments(filter),
    ]);

    res.json({
      ok: true,
      page, limit, total,
      pages: Math.ceil(total / limit),
      items,
    });
  } catch (err) {
    console.error('[admin/waitlist]', err);
    res.status(500).json({ ok: false, code: 'WAITLIST_LIST_ERROR', message: err.message });
  }
});

// ============================================================
// GET /api/admin/waitlist.csv — full CSV export
// ============================================================
router.get('/waitlist.csv', async (req, res) => {
  try {
    const cursor = WaitlistEntry.find().sort({ createdAt: -1 }).lean().cursor();

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="lumora-waitlist-${new Date().toISOString().slice(0, 10)}.csv"`);

    const headers = ['createdAt', 'name', 'email', 'city', 'ageRange', 'platform', 'consent', 'source', 'ipAddress', 'referer'];
    res.write(headers.join(',') + '\n');

    let count = 0;
    for await (const row of cursor) {
      const line = headers.map((h) => csvEscape(row[h])).join(',');
      res.write(line + '\n');
      count++;
    }

    CairnLog.write({
      category: 'admin',
      action: 'admin.waitlist_export',
      severity: 'notice',
      actorPilgrimId: req.pilgrim._id,
      actorRole: req.pilgrim.role,
      actorIp: req.ip,
      message: `Exported waitlist CSV (${count} rows)`,
    });

    res.end();
  } catch (err) {
    console.error('[admin/waitlist.csv]', err);
    res.status(500).end(`Error: ${err.message}`);
  }
});

// ============================================================
// GET /api/admin/pilgrims — paginated pilgrim list
// ?page=1&limit=25&q=...&status=active&role=pilgrim
// ============================================================
router.get('/pilgrims', async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const q = (req.query.q || '').toString().trim();
    const status = (req.query.status || '').toString().trim();
    const role = (req.query.role || '').toString().trim();

    const filter = {};
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { city: rx }];
    }
    if (status && ['pending_verification', 'active', 'suspended', 'banned', 'deleted'].includes(status)) {
      filter.status = status;
    }
    if (role && ['pilgrim', 'acolyte', 'steward', 'magister'].includes(role)) {
      filter.role = role;
    }

    const [items, total] = await Promise.all([
      Pilgrim.find(filter)
        .select('-passwordHash')   // never return hashes
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Pilgrim.countDocuments(filter),
    ]);

    res.json({
      ok: true,
      page, limit, total,
      pages: Math.ceil(total / limit),
      items,
    });
  } catch (err) {
    console.error('[admin/pilgrims]', err);
    res.status(500).json({ ok: false, code: 'PILGRIMS_LIST_ERROR', message: err.message });
  }
});

// ============================================================
// GET /api/admin/pilgrim/:id — single pilgrim full detail
// ============================================================
router.get('/pilgrim/:id', async (req, res) => {
  try {
    const pilgrim = await Pilgrim.findById(req.params.id).select('-passwordHash').lean();
    if (!pilgrim) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Pilgrim not found.' });
    }
    const tessera = await Tessera.findOne({ pilgrimId: pilgrim._id }).lean();
    const activeSessions = await VeilkeySession.countDocuments({
      pilgrimId: pilgrim._id, revokedAt: null, expiresAt: { $gt: new Date() },
    });
    res.json({ ok: true, pilgrim, tessera, activeSessions });
  } catch (err) {
    console.error('[admin/pilgrim/:id]', err);
    res.status(500).json({ ok: false, code: 'PILGRIM_DETAIL_ERROR', message: err.message });
  }
});

// ============================================================
// POST /api/admin/pilgrim/:id/suspend — Quill of Decree (OBS-021)
// Body: { reason: string, durationDays?: number }
// ============================================================
const SuspendSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  durationDays: z.number().int().min(1).max(3650).optional(),
});

router.post('/pilgrim/:id/suspend', async (req, res) => {
  const parsed = SuspendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false, code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input.',
    });
  }
  const { reason } = parsed.data;

  try {
    const pilgrim = await Pilgrim.findById(req.params.id);
    if (!pilgrim) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Pilgrim not found.' });
    }
    if (pilgrim.role === 'magister' && pilgrim._id.toString() !== req.pilgrim._id.toString()) {
      return res.status(403).json({
        ok: false, code: 'CANNOT_SUSPEND_PEER',
        message: 'A magister cannot suspend another magister.',
      });
    }

    pilgrim.status = 'suspended';
    await pilgrim.save();

    // Revoke all active sessions so they get logged out immediately
    await VeilkeySession.updateMany(
      { pilgrimId: pilgrim._id, revokedAt: null },
      { $set: { revokedAt: new Date(), revokeReason: 'suspended' } }
    );

    CairnLog.write({
      category: 'moderation',
      action: 'pilgrim.suspend',
      severity: 'warning',
      actorPilgrimId: req.pilgrim._id,
      actorRole: req.pilgrim.role,
      actorIp: req.ip,
      targetType: 'pilgrim',
      targetId: pilgrim._id,
      message: `Suspended: ${pilgrim.email}`,
      details: { reason },
    });

    res.json({ ok: true, pilgrim: pilgrim.toPublicJSON() });
  } catch (err) {
    console.error('[admin/suspend]', err);
    res.status(500).json({ ok: false, code: 'SUSPEND_ERROR', message: err.message });
  }
});

// ============================================================
// POST /api/admin/pilgrim/:id/restore — undo suspension
// ============================================================
router.post('/pilgrim/:id/restore', async (req, res) => {
  try {
    const pilgrim = await Pilgrim.findById(req.params.id);
    if (!pilgrim) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', message: 'Pilgrim not found.' });
    }
    pilgrim.status = 'active';
    await pilgrim.save();

    CairnLog.write({
      category: 'moderation',
      action: 'pilgrim.restore',
      severity: 'notice',
      actorPilgrimId: req.pilgrim._id,
      actorRole: req.pilgrim.role,
      actorIp: req.ip,
      targetType: 'pilgrim',
      targetId: pilgrim._id,
      message: `Restored: ${pilgrim.email}`,
    });

    res.json({ ok: true, pilgrim: pilgrim.toPublicJSON() });
  } catch (err) {
    console.error('[admin/restore]', err);
    res.status(500).json({ ok: false, code: 'RESTORE_ERROR', message: err.message });
  }
});

// ============================================================
// GET /api/admin/cairns — audit log viewer (CDW-022)
// ?page=1&limit=50&category=auth&severity=warning
// ============================================================
router.get('/cairns', async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req, { defaultLimit: 50, maxLimit: 500 });
    const category = (req.query.category || '').toString().trim();
    const severity = (req.query.severity || '').toString().trim();

    const filter = {};
    if (category && ['auth', 'pilgrim', 'moderation', 'billing', 'system', 'admin'].includes(category)) {
      filter.category = category;
    }
    if (severity && ['info', 'notice', 'warning', 'critical'].includes(severity)) {
      filter.severity = severity;
    }

    const [items, total] = await Promise.all([
      CairnLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CairnLog.countDocuments(filter),
    ]);

    res.json({
      ok: true,
      page, limit, total,
      pages: Math.ceil(total / limit),
      items,
    });
  } catch (err) {
    console.error('[admin/cairns]', err);
    res.status(500).json({ ok: false, code: 'CAIRNS_ERROR', message: err.message });
  }
});

module.exports = router;
