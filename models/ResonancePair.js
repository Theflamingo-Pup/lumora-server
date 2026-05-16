// ============================================================
// CDW-009 — resonance_pair
// Materialized mutual matches. PK is the unordered pilgrim pair.
// Created when a Lantern is reciprocated; opens a Hearth.
// ============================================================

const { Schema, model, Types } = require('mongoose');

const ResonancePairSchema = new Schema(
  {
    // We always store the smaller _id first to enforce unordered uniqueness
    pilgrimA: { type: Types.ObjectId, ref: 'Pilgrim', required: true, index: true },
    pilgrimB: { type: Types.ObjectId, ref: 'Pilgrim', required: true, index: true },

    // Resonance score 0-100 at time of match (VLR-022)
    resonanceScore: { type: Number, min: 0, max: 100 },

    // Tracking which Lanterns triggered the pair
    lanternAId: { type: Types.ObjectId, ref: 'LanternEvent' },
    lanternBId: { type: Types.ObjectId, ref: 'LanternEvent' },

    // The pair was elevated by a Beacon (super-like)
    viaBeacon:  { type: Boolean, default: false },

    // Status — once unmatched/blocked, the pair record stays as a tombstone
    status: {
      type: String,
      enum: ['active', 'unmatched', 'blocked', 'expired'],
      default: 'active',
      index: true,
    },

    matchedAt: { type: Date, default: Date.now },
    closedAt:  { type: Date },
  },
  {
    timestamps: true,
    collection: 'resonance_pairs',
  }
);

ResonancePairSchema.index({ pilgrimA: 1, pilgrimB: 1 }, { unique: true });
ResonancePairSchema.index({ pilgrimA: 1, status: 1, matchedAt: -1 });
ResonancePairSchema.index({ pilgrimB: 1, status: 1, matchedAt: -1 });

// Helper to canonicalize the pair order before save
ResonancePairSchema.statics.canonicalize = function (a, b) {
  const aStr = a.toString();
  const bStr = b.toString();
  return aStr < bStr ? [a, b] : [b, a];
};

module.exports = model('ResonancePair', ResonancePairSchema);
