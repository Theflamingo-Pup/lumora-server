// ============================================================
// CDW-001 — pilgrim
// Master account record; one row per human user.
// ============================================================

const { Schema, model } = require('mongoose');

const PilgrimSchema = new Schema(
  {
    // Identity
    name:       { type: String, required: true, trim: true, maxlength: 80 },
    email:      { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    phone:      { type: String, trim: true, sparse: true, index: true },

    // Auth — Argon2id hash, NEVER stored plaintext
    passwordHash: { type: String, required: true, select: false },

    // Status
    status: {
      type: String,
      enum: ['pending_verification', 'active', 'suspended', 'banned', 'deleted'],
      default: 'pending_verification',
      index: true,
    },
    role: {
      type: String,
      enum: ['pilgrim', 'acolyte', 'steward', 'magister'],   // RBAC per OBS-028
      default: 'pilgrim',
      index: true,
    },

    // Profile basics
    city:       { type: String, trim: true, maxlength: 80 },
    country:    { type: String, trim: true, maxlength: 2 },     // ISO country code
    dateOfBirth: { type: Date, required: false },

    // Verification
    isHaloVerified:   { type: Boolean, default: false, index: true },  // VLR-030
    verifiedAt:       { type: Date },

    // Consent
    consent: {
      terms:        { type: Boolean, default: false },
      privacy:      { type: Boolean, default: false },
      marketing:    { type: Boolean, default: false },
      acceptedAt:   { type: Date },
    },

    // Subscription tier (Mooncalf / Gilt / Sovereign — VLR-046, 047, 052)
    tier: {
      type: String,
      enum: ['mooncalf', 'gilt', 'sovereign'],
      default: 'mooncalf',
      index: true,
    },

    // Bezoar tokens (in-app currency — VLR-048)
    bezoarBalance: { type: Number, default: 0, min: 0 },

    // Mirage fraud score (CDW-024)
    mirageScore: { type: Number, default: 0, min: 0, max: 100 },

    // Activity
    lastSeenAt:   { type: Date, default: Date.now },
    lastLoginAt:  { type: Date },
    loginCount:   { type: Number, default: 0 },

    // Privacy / deletion
    deletedAt: { type: Date },  // Pyre deletion timestamp (VLR-071)
    source:    { type: String, default: 'organic' }, // signup source: waitlist | organic | referral
  },
  {
    timestamps: true,
    collection: 'pilgrims',
  }
);

// Compound indexes for common queries
PilgrimSchema.index({ status: 1, lastSeenAt: -1 });
PilgrimSchema.index({ city: 1, status: 1 });

PilgrimSchema.virtual('age').get(function () {
  if (!this.dateOfBirth) return null;
  const diff = Date.now() - this.dateOfBirth.getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
});

PilgrimSchema.methods.toPublicJSON = function () {
  return {
    id:           this._id,
    name:         this.name,
    city:         this.city,
    tier:         this.tier,
    isHaloVerified: this.isHaloVerified,
    createdAt:    this.createdAt,
  };
};

module.exports = model('Pilgrim', PilgrimSchema);
