// Client: create a Stripe-hosted Checkout Session for a Veteran Resume Review ($9.99).
// Route: /api/review-checkout   POST { jobId }
// SEPARATE from the $1 resume tool. Payment state is set only by review-webhook (server-side).
// Required env: STRIPE_SECRET_KEY, FIREBASE_SERVICE_ACCOUNT_JSON. Optional: REVIEW_PRICE_CENTS.
'use strict';
const { stripePost } = require('../stripe');
const { getDb } = require('../firebase-admin');
const { setCors, normStr, clientIp, rateLimiter } = require('../review-common');

const SITE = 'https://veterancareerpath.com';
const limited = rateLimiter({ windowMs: 60_000, max: 12 });

function priceCents() {
  const n = Number.parseInt(process.env.REVIEW_PRICE_CENTS || '999', 10);
  return Math.max(50, Math.min(Number.isFinite(n) ? n : 999, 100000));
}

module.exports = async function handler(req, res) {
  setCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (limited('chk:' + clientIp(req))) return res.status(429).json({ error: 'rate_limited' });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { console.error('[review-checkout] STRIPE_SECRET_KEY not configured'); return res.status(500).json({ error: 'configuration_error' }); }

  let db;
  try { db = getDb(); } catch (e) { console.error('[review-checkout] init:', e.code || e.message); return res.status(500).json({ error: 'configuration_error' }); }

  const jobId = normStr(req.body?.jobId, 64);
  if (!/^[a-f0-9]{16,32}$/i.test(jobId)) return res.status(400).json({ error: 'invalid_job' });

  try {
    const jobRef = db.collection('resumeReviewJobs').doc(jobId);
    const snap = await jobRef.get();
    if (!snap.exists) return res.status(404).json({ error: 'job_not_found' });
    const job = snap.data();
    if (job.payment?.status === 'paid' || job.status !== 'awaiting_payment') {
      return res.status(409).json({ error: 'not_payable' });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const session = await stripePost('/v1/checkout/sessions', {
        mode: 'payment',
        client_reference_id: jobId,
        customer_email: job.client?.email || undefined,
        metadata: { product: 'resume-review-service', jobId, inviteHash: job.inviteHash || '' },
        payment_intent_data: { metadata: { product: 'resume-review-service', jobId, inviteHash: job.inviteHash || '' } },
        line_items: [{
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: priceCents(),
            product_data: {
              name: 'Veteran Resume Review',
              description: 'Human resume review with AI-assisted tools. One reviewed resume with written feedback.',
            },
          },
        }],
        success_url: `${SITE}/resume-review.html?paid=1&job=${encodeURIComponent(jobId)}`,
        cancel_url: `${SITE}/resume-review.html?canceled=1`,
      }, key, controller.signal);
      return res.status(200).json({ id: session.id, url: session.url });
    } finally { clearTimeout(timer); }
  } catch (err) {
    console.error('[review-checkout] error:', err && err.message);
    return res.status(502).json({ error: 'checkout_failed' });
  }
};

// Exposed for unit tests.
module.exports.priceCents = priceCents;
module.exports.isValidJobId = (id) => /^[a-f0-9]{16,32}$/i.test(String(id || ''));
