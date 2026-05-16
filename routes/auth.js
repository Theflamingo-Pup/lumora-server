// ============================================================
// ROUTE — /api/auth
// signup · login · me · logout · logout-all (Cresset)
// Argon2id passwords + Veilkey (JWT) sessions tracked in DB.
// ============================================================

const express  = require('express');
const argon2   = require('argon2');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { z }    = require('zod');

const Pilgrim        = require('../models/Pilgrim');
const Tessera        = require('../models/Tessera');
const VeilkeySession = require('../models/VeilkeySession');
const CairnLog       = require('../models/CairnLog');
const { signupLimiter, loginLimiter } = require('../middleware/rateLimit');
const { requireVeilkey, hashToken }   = require('../middleware/auth');

const router = express.Router();

// ── Argon2id config (OWASP recommendations, 2024) ───────────
const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19_456,    // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

// ── Helpers ──────────────────────────────────────────────────
function issueVeilkey(pilgrimId, scope = ['pilgrim']) {
  const ttl = process.env.VEILKEY_TTL || '7d';
  const token = jwt.sign(
    { sub: pilgrimId.toString(), scope },
    process.env.VEILKEY_SECRET,
    { expiresIn: ttl, issuer: 'lumora', audience: 'lumora-clients' }
  );
  const decoded = jwt.decode(token);
  const expiresAt = new Date(decoded.exp * 1000);
  return { token, expiresAt };
}

async function recordSession(token, pilgrimId, req, scope) {
  const tokenHash = hashToken(token);
  const decoded = jwt.decode(token);
  const session = await VeilkeySession.create({
    pilgrimId,
    tokenHash,
    deviceLabel: (req.headers['x-device-label'] || '').toString().slice(0, 120),
    userAgent:   (req.headers['user-agent']    || '').toString().slice(0, 400),
    ipAddress:   req.ip,
    scope,
    issuedAt:    new Date(decoded.iat * 1000),
    expiresAt:   new Date(decoded.exp * 1000),
  });
  return session;
}

// ── Schemas ──────────────────────────────────────────────────
const SignupSchema = z.object({
  name:     z.string().trim().min(1).max(80),
  email:    z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
  city:     z.string().trim().max(80).optional().default(''),
  consent:  z.boolean().refine((v) => v === true, 'You must accept the terms and privacy policy.'),
});

const LoginSchema = z.object({
  email:    z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

// ── POST /api/auth/signup ────────────────────────────────────
router.post('/signup', signupLimiter, async (req, res) => {
  const parsed = SignupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false, code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input.',
    });
  }
  const { name, email, password, city, consent } = parsed.data;

  try {
    // Conflict check
    const existing = await Pilgrim.findOne({ email }).lean();
    if (existing) {
      return res.status(409).json({
        ok: false, code: 'EMAIL_TAKEN',
        message: 'An account already exists with that email. Try signing in instead.',
      });
    }

    // Hash password (Cipherveil: salt-and-pepper hashes — ARL-054)
    const passwordHash = await argon2.hash(password, ARGON2_OPTS);

    const pilgrim = await Pilgrim.create({
      name, email, passwordHash, city,
      consent: { terms: consent, privacy: consent, acceptedAt: new Date() },
      status: 'pending_verification',
      source: 'signup-page',
    });

    // Create an empty Tessera in the same flow
    await Tessera.create({ pilgrimId: pilgrim._id });

    // Issue Veilkey
    const { token, expiresAt } = issueVeilkey(pilgrim._id);
    await recordSession(token, pilgrim._id, req, ['pilgrim']);

    pilgrim.lastLoginAt = new Date();
    pilgrim.loginCount = 1;
    await pilgrim.save();

    CairnLog.write({
      category: 'auth',
      action: 'auth.signup',
      severity: 'info',
      actorPilgrimId: pilgrim._id,
      actorIp: req.ip,
      targetType: 'pilgrim',
      targetId: pilgrim._id,
      message: `Signup: ${email}`,
    });

    return res.status(201).json({
      ok: true,
      message: 'Welcome, pilgrim. Your Tessera is ready to build.',
      veilkey: token,
      expiresAt,
      pilgrim: pilgrim.toPublicJSON(),
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ ok: false, code: 'EMAIL_TAKEN', message: 'Email already registered.' });
    }
    console.error('[auth/signup] error:', err);
    return res.status(500).json({ ok: false, code: 'SIGNUP_ERROR', message: 'Could not create account. Please try again.' });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false, code: 'VALIDATION_ERROR',
      message: 'Please enter a valid email and password.',
    });
  }
  const { email, password } = parsed.data;

  try {
    // Need passwordHash, which is select:false by default
    const pilgrim = await Pilgrim.findOne({ email }).select('+passwordHash');
    if (!pilgrim) {
      // Same generic message regardless of which side failed — anti-enumeration
      return res.status(401).json({ ok: false, code: 'BAD_CREDENTIALS', message: 'Email or password is incorrect.' });
    }
    if (pilgrim.status === 'banned' || pilgrim.status === 'deleted') {
      return res.status(403).json({ ok: false, code: 'ACCOUNT_UNAVAILABLE', message: 'This account is not available.' });
    }

    const valid = await argon2.verify(pilgrim.passwordHash, password);
    if (!valid) {
      return res.status(401).json({ ok: false, code: 'BAD_CREDENTIALS', message: 'Email or password is incorrect.' });
    }

    const { token, expiresAt } = issueVeilkey(pilgrim._id, [pilgrim.role || 'pilgrim']);
    await recordSession(token, pilgrim._id, req, [pilgrim.role || 'pilgrim']);

    pilgrim.lastLoginAt = new Date();
    pilgrim.loginCount = (pilgrim.loginCount || 0) + 1;
    pilgrim.lastSeenAt = new Date();
    await pilgrim.save();

    CairnLog.write({
      category: 'auth',
      action: 'auth.login',
      severity: 'info',
      actorPilgrimId: pilgrim._id,
      actorIp: req.ip,
      message: `Login: ${email}`,
    });

    return res.json({
      ok: true,
      veilkey: token,
      expiresAt,
      pilgrim: pilgrim.toPublicJSON(),
    });
  } catch (err) {
    console.error('[auth/login] error:', err);
    return res.status(500).json({ ok: false, code: 'LOGIN_ERROR', message: 'Could not sign in. Please try again.' });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────
router.get('/me', requireVeilkey, async (req, res) => {
  return res.json({
    ok: true,
    pilgrim: {
      id:             req.pilgrim._id,
      name:           req.pilgrim.name,
      email:          req.pilgrim.email,
      city:           req.pilgrim.city,
      tier:           req.pilgrim.tier,
      role:           req.pilgrim.role,
      isHaloVerified: req.pilgrim.isHaloVerified,
      status:         req.pilgrim.status,
      bezoarBalance:  req.pilgrim.bezoarBalance,
      createdAt:      req.pilgrim.createdAt,
    },
    session: {
      issuedAt:   req.session.issuedAt,
      expiresAt:  req.session.expiresAt,
      deviceLabel: req.session.deviceLabel,
    },
  });
});

// ── POST /api/auth/logout ────────────────────────────────────
router.post('/logout', requireVeilkey, async (req, res) => {
  await VeilkeySession.updateOne(
    { _id: req.session._id },
    { $set: { revokedAt: new Date(), revokeReason: 'user_logout' } }
  );

  CairnLog.write({
    category: 'auth',
    action: 'auth.logout',
    actorPilgrimId: req.pilgrim._id,
    actorIp: req.ip,
    message: 'Logout',
  });

  res.json({ ok: true, message: 'Signed out.' });
});

// ── POST /api/auth/logout-all (Cresset — ARL-025) ────────────
router.post('/logout-all', requireVeilkey, async (req, res) => {
  const result = await VeilkeySession.updateMany(
    { pilgrimId: req.pilgrim._id, revokedAt: null },
    { $set: { revokedAt: new Date(), revokeReason: 'cresset_logout_all' } }
  );

  CairnLog.write({
    category: 'auth',
    action: 'auth.cresset_logout_all',
    severity: 'notice',
    actorPilgrimId: req.pilgrim._id,
    actorIp: req.ip,
    message: `Revoked ${result.modifiedCount} session(s)`,
  });

  res.json({ ok: true, revoked: result.modifiedCount });
});

module.exports = router;
