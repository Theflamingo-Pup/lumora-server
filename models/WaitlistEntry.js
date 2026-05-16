// ============================================================
// waitlist_entry — pre-launch signups from lumoradating.com
// Captures interest before the platform is publicly open.
// ============================================================

const { Schema, model } = require('mongoose');

const WaitlistEntrySchema = new Schema(
  {
    name:     { type: String, required: true, trim: true, maxlength: 80 },
    email:    { type: String, required: true, lowercase: true, trim: true, index: true, unique: true },
    city:     { type: String, trim: true, maxlength: 80 },
    ageRange: {
      type: String,
      enum: ['', '18-24', '25-34', '35-44', '45-54', '55+'],
      default: '',
    },
    platform: {
      type: String,
      enum: ['any', 'ios', 'android', 'web'],
      default: 'any',
    },
    consent:  { type: Boolean, required: true },

    // Tracking
    source:     { type: String, default: 'lumoradating.com' }, // landing-page form vs signup-page form
    ipAddress:  { type: String, maxlength: 64 },
    userAgent:  { type: String, maxlength: 400 },
    referer:    { type: String, maxlength: 400 },

    // Lifecycle
    inviteSentAt:  { type: Date },
    inviteCode:    { type: String, sparse: true, index: true },
    convertedToPilgrimAt: { type: Date },
    convertedPilgrimId:   { type: Schema.Types.ObjectId, ref: 'Pilgrim' },
  },
  {
    timestamps: true,
    collection: 'waitlist_entries',
  }
);

module.exports = model('WaitlistEntry', WaitlistEntrySchema);
