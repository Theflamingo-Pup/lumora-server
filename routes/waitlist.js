// ============================================================
// ROUTE — /api/waitlist
// Accepts pre-launch signups from the lumoradating.com waitlist form.
// ============================================================

const express = require('express');
const { z } = require('zod');
const WaitlistEntry = require('../models/WaitlistEntry');
const CairnLog      = require('../models/CairnLog');
const { waitlistLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const WaitlistSchema = z.object({
  name:     z.string().trim().min(1, 'Name is required.').max(80),
  email:    z.string().trim().toLowerCase().email('Please use a valid email.'),
  city:     z.string().trim().max(80).optional().default(''),
  ageRange: z.enum(['', '18-24', '25-34', '35-44', '45-54', '55+']).optional().default(''),
  platform: z.enum(['any', 'ios', 'android', 'web']).optional().default('any'),
  consent:  z.boolean().refine((v) => v === true, 'You must accept the privacy notice.'),
  source:   z.string().trim().max(120).optional().default('lumoradating.com'),
});

// POST /api/waitlist
router.post('/', waitlistLimiter, async (req, res) => {
  // Validate input
  const parsed = WaitlistSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues[0]?.message || 'Invalid input.',
    });
  }
  const data = parsed.data;

  try {
    // Upsert: returning visitors who re-submit don't get rejected, they get updated
    const entry = await WaitlistEntry.findOneAndUpdate(
      { email: data.email },
      {
        $set: {
          name:      data.name,
          city:      data.city,
          ageRange:  data.ageRange,
          platform:  data.platform,
          consent:   data.consent,
          source:    data.source,
          ipAddress: req.ip,
          userAgent: (req.headers['user-agent'] || '').slice(0, 400),
          referer:   (req.headers.referer    || '').slice(0, 400),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    CairnLog.write({
      category: 'pilgrim',
      action: 'waitlist.join',
      severity: 'info',
      actorRole: 'system',
      actorIp: req.ip,
      targetType: 'waitlist_entry',
      targetId: entry._id,
      message: `Waitlist signup: ${data.email}`,
      details: { city: data.city, source: data.source },
    });

    return res.status(201).json({
      ok: true,
      message: "You're on the list. Watch for your invite from hello@lumoradating.com.",
      entryId: entry._id,
    });
  } catch (err) {
    console.error('[waitlist] error:', err);
    return res.status(500).json({
      ok: false,
      code: 'WAITLIST_ERROR',
      message: 'Something went wrong. Please try again — or email us at hello@lumoradating.com.',
    });
  }
});

// GET /api/waitlist/count — public count for the landing page
router.get('/count', async (_req, res) => {
  try {
    const count = await WaitlistEntry.estimatedDocumentCount();
    res.json({ ok: true, count });
  } catch {
    res.json({ ok: true, count: 0 });
  }
});

module.exports = router;
