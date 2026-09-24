// Veteran Career Path - grant access to a paid $1 résumé report AFTER server-side payment verification.
// Route: /api/resume-entitlement   (POST { session_id, draft })
// Retrieves the Checkout Session directly from Stripe (source of truth — NOT a client flag or the
// redirect alone), verifies it is paid, is the $1 resume-pro product, and its metadata.draft matches
// the requested draft, then mints a short-lived token scoped to that one report.
// Required env vars: STRIPE_SECRET_KEY, VCB_SESSION_SECRET
const { stripeGet } = require('./_lib/stripe');
const { issueSession } = require('./_lib/session');

const rateLimit = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 20;
const CS_REGEX = /^cs_(test_|live_)?[A-Za-z0-9_]+$/;
// A paid report stays regenerable for this long (the "reasonable edits & regenerations" window).
const REPORT_TTL_MS = 24 * 60 * 60 * 1000;

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

// Exported so tests and the webhook can share the exact grant logic.
function grantFromCheckout(checkout, draft) {
  if (!checkout) return { active: false, reason: 'not_found' };
  if (checkout.mode !== 'payment') return { active: false, reason: 'wrong_mode' };
  if (checkout.payment_status !== 'paid') return { active: false, reason: 'unpaid' };
  if (checkout.metadata?.product !== 'resume-pro') return { active: false, reason: 'wrong_product' };
  const boundDraft = String(checkout.metadata?.draft || '');
  if (!boundDraft) return { active: false, reason: 'missing_draft' };
  if (!draft || boundDraft !== draft) return { active: false, reason: 'draft_mismatch' };
  if (checkout.client_reference_id && checkout.client_reference_id !== boundDraft) return { active: false, reason: 'reference_mismatch' };
  const expiry = (Number(checkout.created || 0) * 1000) + REPORT_TTL_MS;
  if (expiry <= Date.now()) return { active: false, reason: 'expired' };
  const session = issueSession({
    subject: 'resume:' + checkout.id,
    entitlement: 'resume-oneshot',
    entitlementExpiryMs: expiry,
    metadata: { draft: boundDraft, sid: checkout.id },
  });
  return { active: true, token: session.token, tokenExpiry: session.expiresAt, draft: boundDraft };
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ active: false, error: 'method_not_allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ active: false, error: 'rate_limited' });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { console.error('[resume-entitlement] STRIPE_SECRET_KEY not configured'); return res.status(500).json({ active: false, error: 'configuration_error' }); }

  const sessionId = String(req.body?.session_id || '').trim();
  const draft = String(req.body?.draft || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (!CS_REGEX.test(sessionId)) return res.status(400).json({ active: false, error: 'invalid_session_id' });
  if (!draft || draft.length < 8) return res.status(400).json({ active: false, error: 'invalid_draft' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const checkout = await stripeGet('/v1/checkout/sessions/' + encodeURIComponent(sessionId), key, controller.signal);
    const result = grantFromCheckout(checkout, draft);
    return res.status(result.active ? 200 : 402).json(result);
  } catch (err) {
    console.error('[resume-entitlement] Stripe error:', err && err.message);
    return res.status(err.status === 404 ? 404 : 502).json({ active: false, error: 'verification_failed' });
  } finally { clearTimeout(timer); }
};

module.exports.grantFromCheckout = grantFromCheckout;
module.exports.REPORT_TTL_MS = REPORT_TTL_MS;
