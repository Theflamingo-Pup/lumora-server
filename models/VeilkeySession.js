// ============================================================
// CDW-014 — veilkey_session
// Active JWT sessions. We store a hash of the token (not the token
// itself) so we can revoke individual sessions (Cresset Logout-All).
// ============================================================

const { Schema, model, Types } = require('mongoose');

const VeilkeySessionSchema = new Schema(
  {
    pilgrimId:   { type: Types.ObjectId, ref: 'Pilgrim', required: true, index: true },

    // SHA-256 hash of the signed JWT — the JWT itself is never persisted
    tokenHash:   { type: String, required: true, unique: true, index: true },

    // Device / client fingerprint
    deviceLabel: { type: String, maxlength: 120 },  // "iPhone 15, Safari" etc.
    userAgent:   { type: String, maxlength: 400 },
    ipAddress:   { type: String, maxlength: 64 },

    // Scope / capabilities
    scope: {
      type: [String],
      default: ['pilgrim'],   // 'pilgrim' | 'acolyte' | 'steward' | 'magister'
    },

    // Lifecycle
    issuedAt:    { type: Date, default: Date.now },
    lastSeenAt:  { type: Date, default: Date.now },
    expiresAt:   { type: Date, required: true },
    revokedAt:   { type: Date, default: null },
    revokeReason: { type: String },
  },
  {
    timestamps: true,
    collection: 'veilkey_sessions',
  }
);

// TTL index — Mongo will auto-delete expired sessions
VeilkeySessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
VeilkeySessionSchema.index({ pilgrimId: 1, revokedAt: 1, expiresAt: 1 });

module.exports = model('VeilkeySession', VeilkeySessionSchema);
