// ============================================================
// MIDDLEWARE — Veilkey verification
// Reads Authorization: Bearer <jwt>, verifies signature + expiry,
// checks the session is still valid in veilkey_sessions, and attaches
// req.pilgrim and req.session for downstream handlers.
// ============================================================

const crypto = require('crypto');
const jwt    = require('jsonwebtoken');
const VeilkeySession = require('../models/VeilkeySession');
const Pilgrim        = require('../models/Pilgrim');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function requireVeilkey(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ ok: false, code: 'NO_VEILKEY', message: 'Sign in required.' });
    }
    const token = header.slice(7).trim();
    if (!token) {
      return res.status(401).json({ ok: false, code: 'NO_VEILKEY', message: 'Sign in required.' });
    }

    // Verify signature + expiry
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.VEILKEY_SECRET);
    } catch (err) {
      return res.status(401).json({ ok: false, code: 'BAD_VEILKEY', message: 'Session is invalid or expired.' });
    }

    // Verify the session is still active (not revoked, not deleted)
    const tokenHash = hashToken(token);
    const session = await VeilkeySession.findOne({
      tokenHash,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).lean();

    if (!session) {
      return res.status(401).json({ ok: false, code: 'REVOKED_VEILKEY', message: 'Session no longer valid.' });
    }

    // Load the pilgrim
    const pilgrim = await Pilgrim.findById(decoded.sub).lean();
    if (!pilgrim || pilgrim.status === 'banned' || pilgrim.status === 'deleted') {
      return res.status(403).json({ ok: false, code: 'ACCOUNT_UNAVAILABLE', message: 'Account is not available.' });
    }

    // Touch lastSeenAt (best-effort; don't block on it)
    VeilkeySession.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } }).catch(() => {});

    req.pilgrim = pilgrim;
    req.session = session;
    req.token = token;
    next();
  } catch (err) {
    console.error('[requireVeilkey] error:', err);
    res.status(500).json({ ok: false, code: 'AUTH_ERROR', message: 'Authentication error.' });
  }
}

function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.pilgrim) {
      return res.status(401).json({ ok: false, code: 'NO_VEILKEY', message: 'Sign in required.' });
    }
    if (!allowed.includes(req.pilgrim.role)) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', message: 'Insufficient permissions.' });
    }
    next();
  };
}

module.exports = { requireVeilkey, requireRole, hashToken };
