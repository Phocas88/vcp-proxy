// Veteran Career Path — Stripe Subscription Verifier
// Vercel Serverless Function — route: /api/verify-subscription
// Required env vars: STRIPE_SECRET_KEY, PROXY_API_KEY
// Optional env var: ONE_TIME_EXPIRY_DAYS (default: 365)

// ── Simple in-memory rate limiter (per serverless instance) ──
const rateLimit = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 15;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimit.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count++;
  if (entry.count > RATE_MAX_REQUESTS) return true;
  return false;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://veterancareerpath.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-proxy-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Authenticate proxy request ──
  const proxyKey = process.env.PROXY_API_KEY;
  if (proxyKey) {
    const provided = req.headers['x-proxy-key'];
    if (!provided || provided !== proxyKey) {
      return res.status(401).json({ active: false, error: 'Unauthorized' });
    }
  }

  // ── Rate limiting ──
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ active: false, error: 'Too many requests' });
  }

  const { email } = req.body || {};
  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email)) {
    return res.status(400).json({ active: false, error: 'Invalid email' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.error('STRIPE_SECRET_KEY not configured');
    return res.status(500).json({ active: false, error: 'Server configuration error' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);

    // Search for customer by email
    const custResp = await fetch(
      `https://api.stripe.com/v1/customers?email=${encodeURIComponent(email.trim().toLowerCase())}&limit=1`,
      { headers: { 'Authorization': `Bearer ${stripeKey}` }, signal: controller.signal }
    );
    const custData = await custResp.json();

    if (!custData.data || custData.data.length === 0) {
      clearTimeout(timeout);
      return res.status(200).json({ active: false });
    }

    const customerId = custData.data[0].id;

    // Check active subscriptions
    const subResp = await fetch(
      `https://api.stripe.com/v1/subscriptions?customer=${customerId}&status=active&limit=1`,
      { headers: { 'Authorization': `Bearer ${stripeKey}` }, signal: controller.signal }
    );
    const subData = await subResp.json();

    if (subData.data && subData.data.length > 0) {
      clearTimeout(timeout);
      const sub = subData.data[0];
      return res.status(200).json({
        active: true,
        sessionId: sub.id,
        plan: sub.items.data[0]?.price?.recurring?.interval || 'monthly',
        expiry: sub.current_period_end * 1000,
      });
    }

    // Check successful one-time payments
    const chargeResp = await fetch(
      `https://api.stripe.com/v1/charges?customer=${customerId}&limit=5`,
      { headers: { 'Authorization': `Bearer ${stripeKey}` }, signal: controller.signal }
    );
    const chargeData = await chargeResp.json();

    clearTimeout(timeout);

    const paid = chargeData.data?.find(c => c.paid && !c.refunded && c.amount >= 900);
    if (paid) {
      const expiryDays = parseInt(process.env.ONE_TIME_EXPIRY_DAYS || '365', 10);
      // Calculate expiry from payment date, not from now
      const paymentDate = paid.created * 1000;
      return res.status(200).json({
        active: true,
        sessionId: paid.id,
        plan: 'one-time',
        expiry: paymentDate + expiryDays * 24 * 60 * 60 * 1000,
      });
    }

    return res.status(200).json({ active: false });
  } catch (e) {
    console.error('Stripe verification error:', e);
    return res.status(500).json({ active: false, error: 'Verification failed' });
  }
};
