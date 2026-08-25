// Veteran Career Path - Stripe entitlement verifier.
// Route: /api/verify-subscription
// Required env vars: STRIPE_SECRET_KEY, VCB_SESSION_SECRET
// Optional env var: ONE_TIME_EXPIRY_DAYS (default 365)

const { issueSession } = require('./_lib/session');

const rateLimit = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 10;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STRIPE_ID_REGEX = /^(cs_(?:test_|live_)?|sub_|ch_)[A-Za-z0-9_]+$/;

function setCors(req, res) {
  const allowed = new Set([
    'https://veterancareerpath.com',
    'https://www.veterancareerpath.com',
  ]);
  const origin = req.headers.origin;
  if (allowed.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimit.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX_REQUESTS;
}

async function stripeGet(path, stripeKey, signal) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    headers: { Authorization: `Bearer ${stripeKey}` },
    signal,
  });
  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || `Stripe request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

function subscriptionExpiryMs(subscription) {
  return Number(subscription?.current_period_end || 0) * 1000;
}

function oneTimeExpiryMs(createdSeconds) {
  const expiryDays = Math.max(
    1,
    Number.parseInt(process.env.ONE_TIME_EXPIRY_DAYS || '365', 10) || 365
  );
  return Number(createdSeconds || 0) * 1000 + expiryDays * 24 * 60 * 60 * 1000;
}

function issueStripeSession({ subject, plan, expiry, source }) {
  const session = issueSession({
    subject,
    entitlement: `stripe:${plan}`,
    entitlementExpiryMs: expiry,
    metadata: { source },
  });
  return {
    active: true,
    sessionId: subject,
    plan,
    expiry,
    token: session.token,
    tokenExpiry: session.expiresAt,
  };
}

function issueSubscriptionEntitlement(subscription, source, subjectOverride) {
  const allowedStatus = new Set(['active', 'trialing']);
  if (!subscription || !allowedStatus.has(subscription.status)) return { active: false };

  const expiry = subscriptionExpiryMs(subscription);
  if (expiry <= Date.now()) return { active: false };

  return issueStripeSession({
    subject: subjectOverride || subscription.id,
    plan: subscription.items?.data?.[0]?.price?.recurring?.interval || 'monthly',
    expiry,
    source,
  });
}

function issueChargeEntitlement(charge, source) {
  if (!charge?.paid || charge.refunded || Number(charge.amount || 0) < 900) {
    return { active: false };
  }

  const expiry = oneTimeExpiryMs(charge.created);
  if (expiry <= Date.now()) return { active: false };

  return issueStripeSession({
    subject: charge.id,
    plan: 'one-time',
    expiry,
    source,
  });
}

async function verifyCheckoutSession(sessionId, stripeKey, signal) {
  const checkout = await stripeGet(
    `/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`,
    stripeKey,
    signal
  );

  if (checkout.status && checkout.status !== 'complete') {
    return { active: false };
  }

  const subscription = checkout.subscription;
  if (subscription && typeof subscription === 'object') {
    return issueSubscriptionEntitlement(
      subscription,
      'checkout-subscription',
      checkout.id
    );
  }

  if (checkout.payment_status === 'paid') {
    const expiry = oneTimeExpiryMs(checkout.created);
    if (expiry <= Date.now()) return { active: false };

    return issueStripeSession({
      subject: checkout.id,
      plan: 'one-time',
      expiry,
      source: 'checkout-payment',
    });
  }

  return { active: false };
}

async function verifySubscriptionId(subscriptionId, stripeKey, signal) {
  const subscription = await stripeGet(
    `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    stripeKey,
    signal
  );
  return issueSubscriptionEntitlement(subscription, 'stored-subscription');
}

async function verifyChargeId(chargeId, stripeKey, signal) {
  const charge = await stripeGet(
    `/v1/charges/${encodeURIComponent(chargeId)}`,
    stripeKey,
    signal
  );
  return issueChargeEntitlement(charge, 'stored-payment');
}

async function verifyStripeIdentifier(stripeId, stripeKey, signal) {
  if (stripeId.startsWith('cs_')) {
    return verifyCheckoutSession(stripeId, stripeKey, signal);
  }
  if (stripeId.startsWith('sub_')) {
    return verifySubscriptionId(stripeId, stripeKey, signal);
  }
  if (stripeId.startsWith('ch_')) {
    return verifyChargeId(stripeId, stripeKey, signal);
  }
  return { active: false };
}

async function verifyEmail(email, stripeKey, signal) {
  const normalizedEmail = email.trim().toLowerCase();
  const customers = await stripeGet(
    `/v1/customers?email=${encodeURIComponent(normalizedEmail)}&limit=10`,
    stripeKey,
    signal
  );

  if (!Array.isArray(customers.data) || customers.data.length === 0) {
    return { active: false };
  }

  for (const customer of customers.data) {
    const subscriptions = await stripeGet(
      `/v1/subscriptions?customer=${encodeURIComponent(customer.id)}&status=all&limit=10`,
      stripeKey,
      signal
    );

    const activeSub = subscriptions.data?.find(
      sub => (sub.status === 'active' || sub.status === 'trialing') &&
        subscriptionExpiryMs(sub) > Date.now()
    );

    if (activeSub) {
      return issueSubscriptionEntitlement(activeSub, 'email-subscription');
    }

    const charges = await stripeGet(
      `/v1/charges?customer=${encodeURIComponent(customer.id)}&limit=20`,
      stripeKey,
      signal
    );

    const paid = charges.data?.find(
      charge => charge.paid && !charge.refunded && Number(charge.amount || 0) >= 900
    );

    if (paid) {
      const result = issueChargeEntitlement(paid, 'email-payment');
      if (result.active) return result;
    }
  }

  return { active: false };
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ active: false, error: 'Method not allowed' });
  }

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ active: false, error: 'Too many requests' });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.error('[verify-subscription] STRIPE_SECRET_KEY is not configured');
    return res.status(500).json({ active: false, error: 'Server configuration error' });
  }

  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';

  if (!email && !sessionId) {
    return res.status(400).json({ active: false, error: 'Email or sessionId is required' });
  }
  if (email && !EMAIL_REGEX.test(email)) {
    return res.status(400).json({ active: false, error: 'Invalid email' });
  }
  if (sessionId && !STRIPE_ID_REGEX.test(sessionId)) {
    return res.status(400).json({ active: false, error: 'Invalid Stripe identifier' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    let result = { active: false };

    if (sessionId) {
      result = await verifyStripeIdentifier(sessionId, stripeKey, controller.signal);
    }

    // Preserve existing customers whose stored access record has an old Stripe id
    // by falling back to email when the identifier no longer resolves as active.
    if (!result.active && email) {
      result = await verifyEmail(email, stripeKey, controller.signal);
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('[verify-subscription] Stripe verification failed:', error);

    if (error.status === 404 && email) {
      try {
        const fallback = await verifyEmail(email, stripeKey, controller.signal);
        return res.status(200).json(fallback);
      } catch (fallbackError) {
        console.error('[verify-subscription] Email fallback failed:', fallbackError);
      }
    }

    return res.status(error.status === 404 ? 200 : 500).json({
      active: false,
      error: error.status === 404 ? undefined : 'Verification failed',
    });
  } finally {
    clearTimeout(timeout);
  }
};
