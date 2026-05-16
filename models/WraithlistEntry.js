// ============================================================
// CDW-013 — wraithlist_entry
// Block list. Once blocked, the target never appears in discovery,
// can't initiate Lanterns, and existing Hearth is closed.
// ============================================================

const { Schema, model, Types } = require('mongoose');

const WraithlistEntrySchema = new Schema(
  {
    pilgrimId:        { type: Types.ObjectId, ref: 'Pilgrim', required: true, index: true },
    blockedPilgrimId: { type: Types.ObjectId, ref: 'Pilgrim', required: true, index: true },

    reason: {
      type: String,
      enum: ['harassment', 'spam', 'fake_profile', 'inappropriate', 'safety', 'other'],
      default: 'other',
    },
    notes: { type: String, maxlength: 500 },
  },
  {
    timestamps: true,
    collection: 'wraithlist_entries',
  }
);

WraithlistEntrySchema.index({ pilgrimId: 1, blockedPilgrimId: 1 }, { unique: true });

module.exports = model('WraithlistEntry', WraithlistEntrySchema);
