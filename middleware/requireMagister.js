// ============================================================
// MIDDLEWARE — requireMagister
// Gates routes to pilgrims with the `magister` role only.
// Stacks on top of requireVeilkey: first verify the JWT, then
// check the loaded pilgrim has admin role.
// ============================================================

const { requireVeilkey } = require('./auth');
const CairnLog = require('../models/CairnLog');

const ADMIN_ROLES = ['magister', 'steward', 'acolyte'];

function requireMagister(req, res, next) {
  // Veilkey middleware must run first
  if (!req.pilgrim) {
    return res.status(401).json({
      ok: false,
      code: 'NO_VEILKEY',
      message: 'Sign in required.',
    });
  }

  const role = req.pilgrim.role || 'pilgrim';
  if (!ADMIN_ROLES.includes(role)) {
    // Audit the rejection — someone tried to access admin without rights
    CairnLog.write({
      category: 'admin',
      action: 'admin.access_denied',
      severity: 'warning',
      actorPilgrimId: req.pilgrim._id,
      actorRole: role,
      actorIp: req.ip,
      message: `Non-admin attempted admin access: ${req.method} ${req.path}`,
    });

    return res.status(403).json({
      ok: false,
      code: 'NOT_MAGISTER',
      message: 'Admin access required.',
    });
  }

  next();
}

// Convenience helper: chain Veilkey + Magister in one shot
const requireMagisterChain = [requireVeilkey, requireMagister];

module.exports = { requireMagister, requireMagisterChain, ADMIN_ROLES };
