// ============================================================
// MIDDLEWARE — Centralized error handler
// Express picks this up because it has the (err, req, res, next) shape.
// ============================================================

function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const code = err.code || (status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR');

  // Log on the server, hide internals from the client in production
  if (status >= 500) {
    console.error('[error]', req.method, req.path, '-', err.message);
    if (process.env.NODE_ENV !== 'production') console.error(err.stack);
  } else if (process.env.NODE_ENV !== 'production') {
    console.warn('[error]', req.method, req.path, '-', err.message);
  }

  res.status(status).json({
    ok: false,
    code,
    message: status >= 500 && process.env.NODE_ENV === 'production'
      ? 'Something went wrong on our end. Please try again.'
      : err.message,
  });
}

function notFound(req, res) {
  res.status(404).json({
    ok: false,
    code: 'NOT_FOUND',
    message: `Route ${req.method} ${req.path} not found.`,
  });
}

module.exports = { errorHandler, notFound };
