// ============================================================
// CDW-006 — lantern_event   (right-swipe / like — VLR-017)
// CDW-007 — wisp_event      (left-swipe / pass — VLR-018)
// CDW-008 — beacon_event    (super-like — VLR-019)
// ============================================================

const { Schema, model, Types } = require('mongoose');

function makeSwipeSchema(extra = {}) {
  return new Schema(
    {
      senderId:   { type: Types.ObjectId, ref: 'Pilgrim', required: true, index: true },
      recipientId:{ type: Types.ObjectId, ref: 'Pilgrim', required: true, index: true },
      // Used for daily rate limiting (Mooncalf = 10 Lanterns/day — VLR-052)
      dayBucket:  { type: String, required: true, index: true }, // YYYY-MM-DD UTC
      ...extra,
    },
    { timestamps: true }
  );
}

const LanternEventSchema = makeSwipeSchema({
  // If they have Aurora boost active when they swipe, it counts as priority
  boosted: { type: Boolean, default: false },
});
LanternEventSchema.set('collection', 'lantern_events');
LanternEventSchema.index({ senderId: 1, recipientId: 1 }, { unique: true });
LanternEventSchema.index({ recipientId: 1, createdAt: -1 });

const WispEventSchema = makeSwipeSchema();
WispEventSchema.set('collection', 'wisp_events');
WispEventSchema.index({ senderId: 1, recipientId: 1 }, { unique: true });
// Wisps purged after 90 days (Wormwood retention — CDW-074)
WispEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

const BeaconEventSchema = makeSwipeSchema({
  // Premium spend reference — links to bezoar_ledger
  spendRef: { type: Types.ObjectId, ref: 'BezoarLedger' },
});
BeaconEventSchema.set('collection', 'beacon_events');
BeaconEventSchema.index({ senderId: 1, recipientId: 1 }, { unique: true });
BeaconEventSchema.index({ recipientId: 1, createdAt: -1 });

module.exports = {
  LanternEvent: model('LanternEvent', LanternEventSchema),
  WispEvent:    model('WispEvent', WispEventSchema),
  BeaconEvent:  model('BeaconEvent', BeaconEventSchema),
};
