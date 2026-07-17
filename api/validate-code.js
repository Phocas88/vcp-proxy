// Veteran Career Path — Access Code Validator
// Vercel Serverless Function — route: /api/validate-code
// Required env vars: ACCESS_CODES (JSON string), PROXY_API_KEY

// ── Simple in-memory rate limiter (per serverless instance) ──
const rateLimit = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 20;

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
      return res.status(401).json({ valid: false, reason: 'unauthorized' });
    }
  }

  // ── Rate limiting ──
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ valid: false, reason: 'rate_limited' });
  }

  const { code } = req.body || {};
  if (!code || typeof code !== 'string' || code.length > 50) {
    return res.status(400).json({ valid: false, reason: 'invalid' });
  }

  const c = code.trim().toUpperCase();

  if (!process.env.ACCESS_CODES) {
    console.error('ACCESS_CODES env var not configured');
    return res.status(500).json({ valid: false, reason: 'error' });
  }

  let codesMap = {};
  try {
    codesMap = JSON.parse(process.env.ACCESS_CODES);
  } catch (e) {
    console.error('Failed to parse ACCESS_CODES:', e);
    return res.status(500).json({ valid: false, reason: 'error' });
  }

  if (!(c in codesMap)) {
    return res.status(200).json({ valid: false, reason: 'invalid' });
  }

  const expiry = codesMap[c];
  if (expiry === 0) {
    return res.status(200).json({ valid: true, reason: 'permanent' });
  }
  if (Date.now() > expiry) {
    return res.status(200).json({ valid: false, reason: 'expired' });
  }
  return res.status(200).json({ valid: true, reason: 'timed', expiry });
};
