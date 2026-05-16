// ============================================================
// LUMORA — Main Server
// DigitalOcean App Platform | Node.js 20 | Express + Mongoose
// ============================================================
//
// Frontend:  https://lumoradating.com (Cloudflare Pages)
// API:       https://api.lumoradating.com (this server)
// Database:  MongoDB Atlas Cluster0 → database `lumora`
//
// Pattern follows the Glide server: Procfile-driven, modular routes,
// boot-time secret guards, friendly CORS, no surprises.
// ============================================================

require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const helmet   = require('helmet');

const { connectCinderwell }     = require('./config/db');
const { assertSecretsConfigured } = require('./config/secrets');
const { apiLimiter }            = require('./middleware/rateLimit');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// ── Boot-time secret check ───────────────────────────────────
// In production this throws if VEILKEY_SECRET or MONGO_URI is unset,
// blocking the deploy rather than booting with auth broken.
assertSecretsConfigured({ log: true });

const app  = express();
const PORT = process.env.PORT || 8080;

// Trust the first proxy hop (App Platform terminates TLS)
app.set('trust proxy', 1);

// ── Security headers ─────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: false, // API only, no HTML rendering
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// ── CORS ─────────────────────────────────────────────────────
const ALLOWED = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const DEFAULT_ALLOWED = [
  'https://lumoradating.com',
  'https://www.lumoradating.com',
  'https://lumora-cwd.pages.dev',
  'http://localhost:3000',
  'http://localhost:8080',
];

const allowList = ALLOWED.length ? ALLOWED : DEFAULT_ALLOWED;

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);              // mobile apps, curl, server-to-server
      if (origin === 'null') return cb(null, true);    // file:// pages
      if (allowList.includes(origin)) return cb(null, true);
      if (origin.endsWith('.pages.dev')) return cb(null, true); // any CF Pages preview
      if (origin.startsWith('http://localhost')) return cb(null, true);
      if (origin.startsWith('capacitor://') || origin.startsWith('ionic://')) return cb(null, true);
      console.log(`[CORS] blocked origin: ${origin}`);
      cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

// ── Body parsing ─────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ── Request logging (compact) ────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (req.path !== '/api/health' || res.statusCode >= 400) {
      console.log(`${req.method} ${req.path} → ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

// ── Global API rate limit (per IP) ───────────────────────────
app.use('/api', apiLimiter);

// ── Routes ───────────────────────────────────────────────────
app.use('/api/health',   require('./routes/health'));
app.use('/api/waitlist', require('./routes/waitlist'));
app.use('/api/auth',     require('./routes/auth'));

// Root pings (handy for sanity checks in a browser)
app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'lumora-server',
    docs: 'https://lumoradating.com',
    health: '/api/health',
  });
});

// ── 404 + error handler ──────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Boot ─────────────────────────────────────────────────────
(async () => {
  try {
    await connectCinderwell();
    app.listen(PORT, () => {
      console.log(`[lumora] listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
      console.log(`[lumora] CORS allow-list: ${allowList.join(', ')}`);
    });
  } catch (err) {
    console.error('[lumora] failed to boot:', err);
    process.exit(1);
  }
})();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[lumora] SIGTERM received, shutting down...');
  process.exit(0);
});
process.on('unhandledRejection', (reason) => {
  console.error('[lumora] unhandled rejection:', reason);
});
