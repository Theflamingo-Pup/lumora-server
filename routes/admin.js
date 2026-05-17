// ============================================================
// ROUTE — /api/admin (Obsidian Console — Rookery)
// v2: adds /stats/timeseries, /top-cities, /recent-activity
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
      waitlistTotal, waitlistDay, waitlistWeek,
      pilgrimsTotal, pilgrimsActive, pilgrimsSuspended, pilgrimsHaloVerified,
      pilgrimsDay,
      cairnDay,
    ] = await Promise.all([
      WaitlistEntry.estimatedDocumentCount(),
      WaitlistEntry.countDocuments({ createdAt: { $gte: dayAgo } }),
      WaitlistEntry.countDocuments({ createdAt: { $gte: weekAgo } }),
      Pilgrim.estimatedDocumentCount(),
      Pilgrim.countDocuments({ status: 'active' }),
      Pilgrim.countDocuments({ status: 'suspended' }),
      Pilgrim.countDocuments({ isHaloVerified: true }),
      Pilgrim.countDocuments({ createdAt: { $gte: dayAgo } }),
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
        total: pilgrimsTotal,
        active: pilgrimsActive,
        suspended: pilgrimsSuspended,
        haloVerified: pilgrimsHaloVerified,
        last24h: pilgrimsDay,
      },
      cairns: { last24h: cairnDay },
    });
  } catch (err) {
    console.error('[admin/stats]', err);
    res.status(500).json({ ok: false, code: 'STATS_ERROR', message: err.message });
  }
});

// ============================================================
// GET /api/admin/stats/timeseries — 7-day signup chart
// Returns { days: [{date, waitlist, pilgrims, cairns}, ...] }
// ============================================================
router.get('/stats/timeseries', async (req, res) => {
  try {
    const days = Math.min(30, Math.max(1, parseInt(req.query.days || '7', 10) || 7));
    const now = new Date();
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    start.setUTCHours(0, 0, 0, 0);

    const [waitlistBuckets, pilgrimBuckets, cairnBuckets] = await Promise.all([
      WaitlistEntry.aggregate([
        { $match: { createdAt: { $gte: start } } },
        { $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
            count: { $sum: 1 },
          } },
      ]),
      Pilgrim.aggregate([
        { $match: { createdAt: { $gte: start } } },
        { $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
            count: { $sum: 1 },
          } },
      ]),
      CairnLog.aggregate([
        { $match: { createdAt: { $gte: start } } },
        { $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
            count: { $sum: 1 },
          } },
      ]),
    ]);

    const wMap = Object.fromEntries(waitlistBuckets.map((b) => [b._id, b.count]));
    const pMap = Object.fromEntries(pilgrimBuckets.map((b) => [b._id, b.count]));
    const cMap = Object.fromEntries(cairnBuckets.map((b) => [b._id, b.count]));

    // Fill in zero days
    const series = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      series.push({
        date: key,
        waitlist: wMap[key] || 0,
        pilgrims: pMap[key] || 0,
        cairns:   cMap[key] || 0,
      });
    }

    res.json({ ok: true, days: series });
  } catch (err) {
    console.error('[admin/stats/timeseries]', err);
    res.status(500).json({ ok: false, code: 'TIMESERIES_ERROR', message: err.message });
  }
});

// ============================================================
// GET /api/admin/top-cities — pilgrim + waitlist counts by city
// Returns { cities: [{ city, waitlist, pilgrims, total }] }
// ============================================================
router.get('/top-cities', async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '10', 10) || 10));

    const [waitlistAgg, pilgrimAgg] = await Promise.all([
      WaitlistEntry.aggregate([
        { $match: { city: { $ne: '', $exists: true } } },
        { $group: { _id: { $toLower: '$city' }, original: { $first: '$city' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 50 },
      ]),
      Pilgrim.aggregate([
        { $match: { city: { $ne: '', $exists: true } } },
        { $group: { _id: { $toLower: '$city' }, original: { $first: '$city' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 50 },
      ]),
    ]);

    // Merge by lowercase key
    const cityMap = new Map();
    for (const w of waitlistAgg) {
      cityMap.set(w._id, { city: w.original, waitlist: w.count, pilgrims: 0 });
    }
    for (const p of pilgrimAgg) {
      if (cityMap.has(p._id)) {
        cityMap.get(p._id).pilgrims = p.count;
      } else {
        cityMap.set(p._id, { city: p.original, waitlist: 0, pilgrims: p.count });
      }
    }

    const cities = Array.from(cityMap.values())
      .map((c) => ({ ...c, total: c.waitlist + c.pilgrims }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);

    res.json({ ok: true, cities });
  } catch (err) {
    console.error('[admin/top-cities]', err);
    res.status(500).json({ ok: false, code: 'TOP_CITIES_ERROR', message: err.message });
  }
});

// ============================================================
// GET /api/admin/recent-activity — unified feed of recent events
// Merges waitlist signups + pilgrim signups + cairn events
// ============================================================
router.get('/recent-activity', async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '15', 10) || 15));

    const [recentCairns, recentWaitlist, recentPilgrims] = await Promise.all([
      CairnLog.find().sort({ createdAt: -1 }).limit(limit).lean(),
      WaitlistEntry.find().sort({ createdAt: -1 }).limit(limit).lean(),
      Pilgrim.find().select('-passwordHash').sort({ createdAt: -1 }).limit(limit).lean(),
    ]);

    const events = [];
    for (const c of recentCairns) {
      events.push({
        type: 'cairn',
        at: c.createdAt,
        category: c.category,
        severity: c.severity,
        action: c.action,
        message: c.message,
      });
    }
    for (const w of recentWaitlist) {
      events.push({
        type: 'waitlist_join',
        at: w.createdAt,
        name: w.name,
        email: w.email,
        city: w.city,
        platform: w.platform,
      });
    }
    for (const p of recentPilgrims) {
      events.push({
        type: 'pilgrim_join',
        at: p.createdAt,
        name: p.name,
        email: p.email,
        city: p.city,
        role: p.role,
        tier: p.tier,
      });
    }

    events.sort((a, b) => new Date(b.at) - new Date(a.at));
    res.json({ ok: true, events: events.slice(0, limit) });
  } catch (err) {
    console.error('[admin/recent-activity]', err);
    res.status(500).json({ ok: false, code: 'ACTIVITY_ERROR', message: err.message });
  }
});

// ============================================================
// GET /api/admin/waitlist — paginated list with search
// ============================================================
router.get('/waitlist', async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const q = (req.query.q || '').toString().trim();
    const platform = (req.query.platform || '').toString().trim();

    const filter = {};
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { city: rx }];
    }
    if (platform && ['ios', 'android', 'web', 'any'].includes(platform)) {
      filter.platform = platform;
    }

    const [items, total] = await Promise.all([
      WaitlistEntry.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      WaitlistEntry.countDocuments(filter),
    ]);

    res.json({
      ok: true, page, limit, total,
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
      res.write(headers.map((h) => csvEscape(row[h])).join(',') + '\n');
      count++;
    }
    CairnLog.write({
      category: 'admin', action: 'admin.waitlist_export', severity: 'notice',
      actorPilgrimId: req.pilgrim._id, actorRole: req.pilgrim.role, actorIp: req.ip,
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
      Pilgrim.find(filter).select('-passwordHash').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Pilgrim.countDocuments(filter),
    ]);

    res.json({
      ok: true, page, limit, total,
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
// POST /api/admin/pilgrim/:id/suspend — Quill of Decree
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

    await VeilkeySession.updateMany(
      { pilgrimId: pilgrim._id, revokedAt: null },
      { $set: { revokedAt: new Date(), revokeReason: 'suspended' } }
    );

    CairnLog.write({
      category: 'moderation', action: 'pilgrim.suspend', severity: 'warning',
      actorPilgrimId: req.pilgrim._id, actorRole: req.pilgrim.role, actorIp: req.ip,
      targetType: 'pilgrim', targetId: pilgrim._id,
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
      category: 'moderation', action: 'pilgrim.restore', severity: 'notice',
      actorPilgrimId: req.pilgrim._id, actorRole: req.pilgrim.role, actorIp: req.ip,
      targetType: 'pilgrim', targetId: pilgrim._id,
      message: `Restored: ${pilgrim.email}`,
    });

    res.json({ ok: true, pilgrim: pilgrim.toPublicJSON() });
  } catch (err) {
    console.error('[admin/restore]', err);
    res.status(500).json({ ok: false, code: 'RESTORE_ERROR', message: err.message });
  }
});

// ============================================================
// GET /api/admin/cairns — audit log viewer
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
      CairnLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      CairnLog.countDocuments(filter),
    ]);

    res.json({
      ok: true, page, limit, total,
      pages: Math.ceil(total / limit),
      items,
    });
  } catch (err) {
    console.error('[admin/cairns]', err);
    res.status(500).json({ ok: false, code: 'CAIRNS_ERROR', message: err.message });
  }
});

module.exports = router;
