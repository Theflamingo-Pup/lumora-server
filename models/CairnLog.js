// ============================================================
// CDW-022 — cairn_log
// Append-only audit log of every privileged operation.
// One row per "Cairn".
// ============================================================

const { Schema, model, Types } = require('mongoose');

const CairnLogSchema = new Schema(
  {
    // Who did it (admin or pilgrim)
    actorPilgrimId: { type: Types.ObjectId, ref: 'Pilgrim' },
    actorRole:      { type: String, enum: ['system', 'pilgrim', 'acolyte', 'steward', 'magister'], default: 'system' },
    actorIp:        { type: String, maxlength: 64 },

    // What was done
    action:    { type: String, required: true, index: true },  // e.g. 'auth.signup', 'pilgrim.suspend'
    category:  { type: String, enum: ['auth', 'pilgrim', 'moderation', 'billing', 'system', 'admin'], required: true, index: true },
    severity:  { type: String, enum: ['info', 'notice', 'warning', 'critical'], default: 'info', index: true },

    // What it was done to
    targetType: { type: String },    // 'pilgrim' | 'hearth' | 'tessera' | etc.
    targetId:   { type: Types.ObjectId },

    // Free-form details
    details:    { type: Schema.Types.Mixed },
    message:    { type: String, maxlength: 500 },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // append-only
    collection: 'cairn_log',
  }
);

CairnLogSchema.index({ createdAt: -1 });
CairnLogSchema.index({ category: 1, createdAt: -1 });
CairnLogSchema.index({ actorPilgrimId: 1, createdAt: -1 });
CairnLogSchema.index({ targetId: 1, createdAt: -1 });

// Convenience helper used across the codebase
CairnLogSchema.statics.write = function (cairn) {
  return this.create(cairn).catch((err) => {
    // Audit failures should never block business logic
    console.error('[Cairn] write failed:', err.message, cairn);
  });
};

module.exports = model('CairnLog', CairnLogSchema);
