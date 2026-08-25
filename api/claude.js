// Veteran Career Path - authenticated Anthropic API proxy.
// Route: /api/claude
// Required env vars: ANTHROPIC_API_KEY, VCB_SESSION_SECRET
// Optional env var: ANTHROPIC_ALLOWED_MODELS (comma-separated)

const { bearerToken, verifySession } = require('./_lib/session');

const rateLimit = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 20;
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS_LIMIT = 3000;
const MAX_BODY_BYTES = 80 * 1024;

function setCors(req, res) {
  const allowed = new Set([
    'https://veterancareerpath.com',
    'https://www.veterancareerpath.com',
  ]);
  const origin = req.headers.origin;
  if (allowed.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-vcb-session');
  res.setHeader('Cache-Control', 'no-store');
}

function isRateLimited(key) {
  const now = Date.now();
  const entry = rateLimit.get(key);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateLimit.set(key, { windowStart: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX_REQUESTS;
}

function allowedModels() {
  const configured = (process.env.ANTHROPIC_ALLOWED_MODELS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return new Set(configured.length ? configured : [DEFAULT_MODEL]);
}

function validateBody(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Invalid request body' };
  }

  const bodySize = Buffer.byteLength(JSON.stringify(input), 'utf8');
  if (bodySize > MAX_BODY_BYTES) {
    return { error: 'Request is too large' };
  }

  const model = input.model || DEFAULT_MODEL;
  if (!allowedModels().has(model)) {
    return { error: 'Requested model is not allowed' };
  }

  if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > 30) {
    return { error: 'messages must contain between 1 and 30 entries' };
  }

  const maxTokens = Math.min(
    Math.max(Number.parseInt(input.max_tokens || '1500', 10) || 1500, 1),
    MAX_TOKENS_LIMIT
  );

  return {
    body: {
      ...input,
      model,
      max_tokens: maxTokens,
    },
  };
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sessionCheck = verifySession(bearerToken(req));
  if (!sessionCheck.valid) {
    return res.status(401).json({ error: 'Valid Veteran Career Path session required' });
  }

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const rateKey = `${sessionCheck.payload.sub}:${clientIp}`;
  if (isRateLimited(rateKey)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('[claude] ANTHROPIC_API_KEY is not configured');
    return res.status(500).json({ error: 'AI service is not configured' });
  }

  const validated = validateBody(req.body || {});
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(validated.body),
      signal: controller.signal,
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[claude] Anthropic error:', response.status, data?.error?.type);
      return res.status(response.status).json({
        error: data?.error?.message || 'AI service request failed',
        type: data?.error?.type,
        status: response.status,
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('[claude] Proxy error:', error);
    if (error?.name === 'AbortError') {
      return res.status(504).json({ error: 'AI service timed out' });
    }
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  } finally {
    clearTimeout(timeout);
  }
};
