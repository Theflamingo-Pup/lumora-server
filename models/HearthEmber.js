// ============================================================
// CDW-010 — hearth   (chat thread between two pilgrims)
// CDW-011 — ember    (individual message inside a Hearth)
// ============================================================

const { Schema, model, Types } = require('mongoose');

const HearthSchema = new Schema(
  {
    resonancePairId: { type: Types.ObjectId, ref: 'ResonancePair', required: true, unique: true, index: true },
    participants:    [{ type: Types.ObjectId, ref: 'Pilgrim', required: true }],

    // Cached last-message preview for the Hearth inbox list
    lastEmberPreview: { type: String, maxlength: 100 },
    lastEmberAt:      { type: Date },

    // Read state per participant
    lastReadByA: { type: Date },
    lastReadByB: { type: Date },

    // Privacy modes (VLR-035 Whisperlock, VLR-044 Ashfall)
    whisperlock:        { type: Boolean, default: false },
    ashfallDays:        { type: Number },    // auto-delete after N inactive days
    sentinelSafeWords:  [{ type: String, lowercase: true }],  // VLR-040

    // Pinned message (Cairnmark — VLR-045)
    cairnmarkEmberId: { type: Types.ObjectId, ref: 'Ember' },

    // State
    isMuted:    { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false, index: true },
    closedAt:   { type: Date },
  },
  {
    timestamps: true,
    collection: 'hearths',
  }
);

HearthSchema.index({ participants: 1, lastEmberAt: -1 });
HearthSchema.index({ participants: 1, isArchived: 1, lastEmberAt: -1 });

const EmberSchema = new Schema(
  {
    hearthId:   { type: Types.ObjectId, ref: 'Hearth', required: true, index: true },
    senderId:   { type: Types.ObjectId, ref: 'Pilgrim', required: true, index: true },

    // The message itself. For E2E content this is an encrypted blob;
    // wrapped-key references live in a separate collection per CDW-072.
    body:        { type: String, maxlength: 4000 },
    encryptedBody: { type: String }, // base64 ciphertext if E2E

    // Attachments — Hollowgram media (VLR-034)
    hollowgramIds: [{ type: Types.ObjectId, ref: 'Hollowgram' }],

    // Reply quote (Vellum — VLR-038)
    replyToEmberId: { type: Types.ObjectId, ref: 'Ember' },

    // Reactions (Pinwheel — ARL-067)
    reactions: [
      {
        pilgrimId: { type: Types.ObjectId, ref: 'Pilgrim' },
        emoji:     { type: String, maxlength: 8 },
        at:        { type: Date, default: Date.now },
      },
    ],

    // Delivery / read receipts
    deliveredAt: { type: Date },
    readAt:      { type: Date },          // Cinder read receipt (VLR-036)

    // Moderation flag
    flaggedAt:   { type: Date },
    flagReason:  { type: String },
  },
  {
    timestamps: true,
    collection: 'embers',
  }
);

EmberSchema.index({ hearthId: 1, createdAt: -1 });
EmberSchema.index({ senderId: 1, createdAt: -1 });

module.exports = {
  Hearth: model('Hearth', HearthSchema),
  Ember:  model('Ember', EmberSchema),
};
