// Veteran Career Path - Stripe webhook for the $1 résumé tool.
// Route: /api/resume-webhook   (Stripe -> server; POST, raw body)
// Verifies the Stripe signature and idempotently acknowledges paid checkout sessions for the
// resume-pro product. Access itself is granted by /api/resume-entitlement (which verifies the
// session with Stripe directly), so this endpoint is the signature-verified reliability path and
// must never grant on unverified input.
// Required env vars: STRIPE_WEBHOOK_SECRET_RESUME
// Configure in Stripe: endpoint https://vcp-proxy.vercel.app/api/resume-webhook, event checkout.session.completed
const { verifyStripeWebhook, readRawBody } = require('./_lib/stripe');

// Vercel: keep the body unparsed so we can verify the exact raw bytes Stripe signed.
module.exports.config = { api: { bodyParser: false } };

// Idempotency: remember recently-processed event ids so replays are no-ops (bounded LRU).
const processed = new Map();
const PROCESSED_TTL_MS = 60 * 60 * 1000;
const PROCESSED_MAX = 5000;
function alreadyProcessed(id) {
  const now = Date.now();
  if (processed.size > PROCESSED_MAX) { for (const [k, t] of processed) { if (now - t > PROCESSED_TTL_MS) processed.delete(k); } }
  if (processed.has(id) && now - processed.get(id) < PROCESSED_TTL_MS) return true;
  processed.set(id, now); return false;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const secret = process.env.STRIPE_WEBHOOK_SECRET_RESUME;
  if (!secret) { console.error('[resume-webhook] STRIPE_WEBHOOK_SECRET_RESUME not configured'); return res.status(500).json({ error: 'configuration_error' }); }

  const raw = await readRawBody(req);
  const sig = req.headers['stripe-signature'];
  if (!verifyStripeWebhook(raw, sig, secret)) {
    return res.status(400).json({ error: 'invalid_signature' });
  }

  let event;
  try { event = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)); }
  catch (_) { return res.status(400).json({ error: 'bad_json' }); }

  // Idempotent: a replayed event id is acknowledged without re-processing.
  if (event.id && alreadyProcessed(event.id)) {
    return res.status(200).json({ received: true, duplicate: true });
  }

  if (event.type === 'checkout.session.completed') {
    const s = event.data?.object || {};
    if (s.metadata?.product === 'resume-pro' && s.payment_status === 'paid') {
      // Payment confirmed. Access is minted on demand by /api/resume-entitlement (Stripe-verified),
      // so nothing to unlock here — we just record it for reliability/audit.
      console.log('[resume-webhook] paid resume-pro checkout', s.id, 'draft=', s.metadata?.draft);
    }
  }

  return res.status(200).json({ received: true });
};
