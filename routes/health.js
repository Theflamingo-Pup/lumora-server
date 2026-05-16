// ============================================================
// ROUTE — GET /api/health
// Simple liveness + db ping for App Platform health checks.
// ============================================================

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

router.get('/', async (_req, res) => {
  const dbState = mongoose.connection.readyState; // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  const dbOk = dbState === 1;
  res.status(dbOk ? 200 : 503).json({
    ok: dbOk,
    service: 'lumora-server',
    version: process.env.npm_package_version || '1.0.0',
    env: process.env.NODE_ENV || 'development',
    uptime_s: Math.round(process.uptime()),
    db: {
      state: ['disconnected', 'connected', 'connecting', 'disconnecting'][dbState],
      name:  mongoose.connection.name,
    },
    now: new Date().toISOString(),
  });
});

module.exports = router;
