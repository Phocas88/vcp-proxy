// Veteran Career Path - $1 pay-per-use Checkout Session for the Military Resume & Career tool.
// Route: /api/resume-checkout   (public; creates a one-time $1 Stripe Checkout Session)
// The $1 price is created inline (price_data) so no dashboard Price/Product is required.
// Required env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET_RESUME
// Optional env vars: RESUME_PRICE_CENTS (default 100), RESUME_SUCCESS_URL, RESUME_CANCEL_URL
const { stripePost } = require('./_lib/stripe');

const rateLimit = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 12;

function setCors(req, res) {
  const allowed = new Set(['https://veterancareerpath.com', 'https://www.veterancareerpath.com']);
  const origin = req.headers.origin;
  if (allowed.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}
function isRateLimited(ip) {
  const now = Date.now(); const e = rateLimit.get(ip);
  if (!e || now - e.windowStart > RATE_WINDOW_MS) { rateLimit.set(ip, { windowStart: now, count: 1 }); return false; }
  e.count += 1; return e.count > RATE_MAX_REQUESTS;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'rate_limited' });

  const key = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET_RESUME;
  if (!key || !webhookSecret) {
    console.error('[resume-checkout] Stripe key or resume webhook secret not configured');
    return res.status(500).json({ error: 'configuration_error' });
  }

  // draft = a client-generated id that binds this payment to one specific report intake.
  const draft = String(req.body?.draft || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (!draft || draft.length < 8) return res.status(400).json({ error: 'invalid_draft' });

  const cents = Math.max(50, Math.min(Number.parseInt(process.env.RESUME_PRICE_CENTS || '100', 10) || 100, 2000));
  const origin = (req.headers.origin && /^https:\/\/(www\.)?veterancareerpath\.com$/.test(req.headers.origin))
    ? req.headers.origin : 'https://veterancareerpath.com';
  const successUrl = (process.env.RESUME_SUCCESS_URL || origin + '/resume-pro.html')
    + '?session_id={CHECKOUT_SESSION_ID}&draft=' + encodeURIComponent(draft) + '&paid=1';
  const cancelUrl = (process.env.RESUME_CANCEL_URL || origin + '/resume-pro.html') + '?canceled=1&draft=' + encodeURIComponent(draft);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const session = await stripePost('/v1/checkout/sessions', {
      mode: 'payment',
      client_reference_id: draft,
      'metadata': { draft, product: 'resume-pro' },
      'payment_intent_data': { metadata: { draft, product: 'resume-pro' } },
      'line_items': [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: cents,
          product_data: { name: 'Military → Civilian Résumé & Career Report', description: 'One AI-generated résumé + career report, with edits and regenerations of this report.' },
        },
      }],
      success_url: successUrl,
      cancel_url: cancelUrl,
    }, key, controller.signal);
    return res.status(200).json({ id: session.id, url: session.url });
  } catch (err) {
    console.error('[resume-checkout] Stripe error:', err && err.message);
    return res.status(502).json({ error: 'checkout_failed' });
  } finally { clearTimeout(timer); }
};
