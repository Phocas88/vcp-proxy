// Veteran Career Path — Anthropic API Proxy
// Vercel Serverless Function — route: /api/claude
// Deploy: vercel --prod
// Required env vars: ANTHROPIC_API_KEY, PROXY_API_KEY (set in Vercel Dashboard > Settings > Environment Variables)

// ── Simple in-memory rate limiter (per serverless instance) ──
const rateLimit = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 30;

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
  // Set CORS headers on every response
  res.setHeader('Access-Control-Allow-Origin', 'https://veterancareerpath.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-vcb-session, x-vcb-email, x-vcb-code, x-proxy-key');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed — use POST' });
  }

  // ── Authenticate proxy request ──
  const proxyKey = process.env.PROXY_API_KEY;
  if (proxyKey) {
    const provided = req.headers['x-proxy-key'];
    if (!provided || provided !== proxyKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // ── Rate limiting ──
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  // Check API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY not configured. Add it in Vercel Dashboard → Settings → Environment Variables, then redeploy.'
    });
  }

  try {
    const body = req.body || {};

    // Default model if not provided
    if (!body.model) body.model = 'claude-haiku-4-5-20251001';
    if (!body.max_tokens) body.max_tokens = 1500;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || 'Anthropic API error',
        type: data?.error?.type,
        status: response.status,
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('[claude] Proxy error:', err);
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }
};
