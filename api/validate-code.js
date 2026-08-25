// Veteran Career Path - server-side access-code validator.
// Route: /api/validate-code
// Required env vars: ACCESS_CODES, VCB_SESSION_SECRET

const { issueSession } = require('./_lib/session');

const rateLimit = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 10;
const CODE_REGEX = /^[A-Z0-9_-]{4,50}$/;

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

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ valid: false, reason: 'method_not_allowed' });
  }

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ valid: false, reason: 'rate_limited' });
  }

  const rawCode = req.body?.code;
  const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';

  if (!CODE_REGEX.test(code)) {
    return res.status(400).json({ valid: false, reason: 'invalid' });
  }

  const rawCodes = process.env.ACCESS_CODES;
  if (!rawCodes) {
    console.error('[validate-code] ACCESS_CODES is not configured');
    return res.status(500).json({ valid: false, reason: 'configuration_error' });
  }

  let codesMap;
  try {
    codesMap = JSON.parse(rawCodes);
  } catch (error) {
    console.error('[validate-code] ACCESS_CODES is invalid JSON:', error);
    return res.status(500).json({ valid: false, reason: 'configuration_error' });
  }

  if (!Object.prototype.hasOwnProperty.call(codesMap, code)) {
    return res.status(200).json({ valid: false, reason: 'invalid' });
  }

  const entitlementExpiry = Number(codesMap[code]) || 0;
  if (entitlementExpiry > 0 && Date.now() > entitlementExpiry) {
    return res.status(200).json({ valid: false, reason: 'expired' });
  }

  try {
    const session = issueSession({
      subject: `code:${code.slice(0, 8)}`,
      entitlement: 'access-code',
      entitlementExpiryMs: entitlementExpiry,
    });

    return res.status(200).json({
      valid: true,
      reason: entitlementExpiry === 0 ? 'permanent' : 'timed',
      expiry: entitlementExpiry,
      token: session.token,
      tokenExpiry: session.expiresAt,
    });
  } catch (error) {
    console.error('[validate-code] Could not issue session:', error);
    return res.status(500).json({ valid: false, reason: 'configuration_error' });
  }
};
