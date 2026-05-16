// ============================================================
// CDW-003 — sigil_image
// Verified portraits attached to a pilgrim.
// status enum: pending | halo | rejected
// ============================================================

const { Schema, model, Types } = require('mongoose');

const SigilImageSchema = new Schema(
  {
    pilgrimId:  { type: Types.ObjectId, ref: 'Pilgrim', required: true, index: true },

    // Storage (Coracle Media — OBS-011)
    storageUrl: { type: String, required: true },
    storageKey: { type: String, required: true },
    mimeType:   { type: String, required: true },
    sizeBytes:  { type: Number, required: true },
    width:      { type: Number },
    height:     { type: Number },

    // Ordering on the Tessera (0 is primary)
    position:   { type: Number, default: 0, min: 0, max: 8 },

    // Verification (VLR-004 — Sigil Verifier)
    status: {
      type: String,
      enum: ['pending', 'halo', 'rejected'],
      default: 'pending',
      index: true,
    },
    verifiedAt:        { type: Date },
    rejectionReason:   { type: String, maxlength: 200 },

    // Perceptual hash for Beadroll duplicate detection (OBS-042)
    pHash: { type: String, index: true },

    // Soft delete
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'sigil_images',
  }
);

SigilImageSchema.index({ pilgrimId: 1, position: 1 });
SigilImageSchema.index({ pilgrimId: 1, status: 1 });

module.exports = model('SigilImage', SigilImageSchema);
