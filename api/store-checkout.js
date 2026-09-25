// Veteran Career Path store - create a one-time Stripe Checkout Session for a digital book.
// Route: /api/store-checkout   (public; POST { sku })
// Price + product name come from the SERVER catalog (store-catalog.js), never the client.
// On success Stripe redirects to /store-download.html?session_id=...&sku=..., which calls
// /api/store-download to verify payment and stream the PDF.
// Required env vars: STRIPE_SECRET_KEY
'use strict';
const { stripePost } = require('./_lib/stripe');
const { getProduct, SKU_REGEX } = require('./_lib/store-catalog');

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
  if (!key) {
    console.error('[store-checkout] STRIPE_SECRET_KEY not configured');
    return res.status(500).json({ error: 'configuration_error' });
  }

  const sku = String(req.body?.sku || '').trim().toLowerCase();
  if (!SKU_REGEX.test(sku)) return res.status(400).json({ error: 'invalid_sku' });
  const product = getProduct(sku);
  if (!product) return res.status(404).json({ error: 'unknown_product' });

  const origin = (req.headers.origin && /^https:\/\/(www\.)?veterancareerpath\.com$/.test(req.headers.origin))
    ? req.headers.origin : 'https://veterancareerpath.com';
  const successUrl = origin + '/store-download.html?session_id={CHECKOUT_SESSION_ID}&sku=' + encodeURIComponent(sku);
  const cancelUrl = origin + '/store.html?canceled=1';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const session = await stripePost('/v1/checkout/sessions', {
      mode: 'payment',
      client_reference_id: sku,
      allow_promotion_codes: true,
      metadata: { product: 'book', sku },
      payment_intent_data: { metadata: { product: 'book', sku } },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: product.priceCents,
          product_data: {
            name: product.name,
            description: 'Instant digital download (PDF) from Veteran Career Path.',
          },
        },
      }],
      success_url: successUrl,
      cancel_url: cancelUrl,
    }, key, controller.signal);
    return res.status(200).json({ id: session.id, url: session.url });
  } catch (err) {
    console.error('[store-checkout] Stripe error:', err && err.message);
    return res.status(502).json({ error: 'checkout_failed' });
  } finally { clearTimeout(timer); }
};
