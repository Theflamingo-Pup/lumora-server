// ============================================================
// CDW-002 — tessera
// Profile content; 1:1 with pilgrim. Bio, prompts, height, etc.
// ============================================================

const { Schema, model, Types } = require('mongoose');

const PromptAnswerSchema = new Schema(
  {
    promptId:  { type: Types.ObjectId, ref: 'PetrichorPrompt' },
    promptText: { type: String, required: true, maxlength: 140 },
    answer:    { type: String, required: true, maxlength: 280 },
  },
  { _id: false }
);

const TesseraSchema = new Schema(
  {
    pilgrimId: { type: Types.ObjectId, ref: 'Pilgrim', required: true, unique: true, index: true },

    // Cartouche bio (VLR-006 — 500 chars max, with emoji support)
    cartouche: { type: String, maxlength: 500, default: '' },

    // Physical / lifestyle
    height_cm:  { type: Number, min: 100, max: 250 },
    pronouns:   { type: String, maxlength: 40 },
    gender:     { type: String, enum: ['woman', 'man', 'nonbinary', 'other', 'prefer_not_to_say'] },
    seeking:    [{ type: String, enum: ['women', 'men', 'nonbinary', 'everyone'] }],

    // Petrichor prompts (VLR-008) — up to 3 selected answers
    prompts: { type: [PromptAnswerSchema], default: [], validate: (v) => v.length <= 3 },

    // Constellations of interests (VLR-009) — denormalized for fast read
    constellations: [{ type: String, lowercase: true, trim: true }],

    // Intent
    lookingFor: {
      type: String,
      enum: ['relationship', 'casual', 'friendship', 'figuring_out'],
      default: 'figuring_out',
    },

    // Halcyon voice intro (VLR-007) — reference to halcyon_clip
    halcyonClipId: { type: Types.ObjectId, ref: 'HalcyonClip' },

    // Discovery preferences (Tideline filters — VLR-024)
    discovery: {
      ageMin:    { type: Number, default: 18, min: 18 },
      ageMax:    { type: Number, default: 99, max: 99 },
      fathomKm:  { type: Number, default: 25, min: 1, max: 500 }, // Fathom = km
      showMe:    { type: String, enum: ['women', 'men', 'nonbinary', 'everyone'], default: 'everyone' },
    },

    // Visibility
    isHidden:    { type: Boolean, default: false }, // Incognito (Sovereign tier)
    pausedUntil: { type: Date },                    // pause discovery

    // Completion gating
    isComplete:  { type: Boolean, default: false, index: true }, // gating for discovery
    completedAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'tesseras',
  }
);

TesseraSchema.pre('save', function (next) {
  // Mark complete when bio + at least one prompt + at least one photo + age range set
  const hasBio = (this.cartouche || '').length >= 40;
  const hasPrompts = (this.prompts || []).length >= 1;
  const hasIntent = !!this.lookingFor;
  this.isComplete = hasBio && hasPrompts && hasIntent;
  if (this.isComplete && !this.completedAt) this.completedAt = new Date();
  next();
});

module.exports = model('Tessera', TesseraSchema);
