// ============================================================
// MIDDLEWARE — Hailstone rate limiting (per CDW-025)
// Different limits per route family. In-memory by default; for
// multi-instance deploys, swap the store to Redis (out of scope here).
// ============================================================

const rateLimit = require('express-rate-limit');

const makeLimiter = (opts) =>
  rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        ok: false,
        code: 'HAILSTONE_LIMIT',
        message: 'Too many requests. Please slow down and try again shortly.',
      });
    },
    ...opts,
  });

// Aggressive on auth — 5 signups per IP per hour, 10 logins per 15min
const signupLimiter = makeLimiter({ windowMs: 60 * 60 * 1000, max: 5 });
const loginLimiter  = makeLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

// Waitlist — slightly looser since people fat-finger emails
const waitlistLimiter = makeLimiter({ windowMs: 60 * 60 * 1000, max: 10 });

// General API limiter — 600 requests per 15 min per IP (~40/min)
const apiLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, max: 600 });

// Swipes — Mooncalf tier rate-limited at the model level too,
// this is the IP-level safety net against scripted swiping
const swipeLimiter = makeLimiter({ windowMs: 60 * 1000, max: 30 });

module.exports = {
  signupLimiter,
  loginLimiter,
  waitlistLimiter,
  apiLimiter,
  swipeLimiter,
};
