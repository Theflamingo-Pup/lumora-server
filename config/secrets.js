// ============================================================
// LUMORA — Auth Secrets (Veilkey + Obsidian PIN)
// Single source of truth for secret reads.
// Glide-pattern: fail the deploy if production starts without
// required secrets, rather than booting with auth silently disabled.
// ============================================================

function assertSecretsConfigured({ log = false } = {}) {
  const required = ['VEILKEY_SECRET', 'MONGO_URI'];
  const missing = required.filter((k) => !process.env[k] || process.env[k].trim() === '');

  const isProd = process.env.NODE_ENV === 'production';

  if (missing.length > 0) {
    const msg = `[secrets] missing required env vars: ${missing.join(', ')}`;
    if (isProd) {
      console.error(msg);
      throw new Error(msg + ' — refusing to boot in production.');
    } else if (log) {
      console.warn(msg + ' — continuing in development mode.');
    }
  } else if (log) {
    console.log('[secrets] all required secrets configured');
  }

  // Veilkey secret strength check
  const veilkey = process.env.VEILKEY_SECRET || '';
  if (isProd && veilkey.length < 32) {
    throw new Error('[secrets] VEILKEY_SECRET must be at least 32 chars in production');
  }
}

function verifyObsidianPin(submittedPin) {
  const expected = process.env.OBSIDIAN_ADMIN_PIN;
  if (!expected) return false; // no PIN set → no admin access
  if (!submittedPin || typeof submittedPin !== 'string') return false;
  // Constant-time comparison
  if (submittedPin.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ submittedPin.charCodeAt(i);
  }
  return mismatch === 0;
}

module.exports = { assertSecretsConfigured, verifyObsidianPin };
