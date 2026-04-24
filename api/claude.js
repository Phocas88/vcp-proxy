// Veteran Career Path — Anthropic API Proxy
// Vercel Serverless Function — route: /api/claude
// Deploy: vercel --prod
// Required env var: ANTHROPIC_API_KEY (set in Vercel Dashboard > Settings > Environment Variables)

module.exports = async function handler(req, res) {
  // Set CORS headers on every response
  res.setHeader('Access-Control-Allow-Origin', 'https://veterancareerpath.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-vcb-session, x-vcb-email, x-vcb-code');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed — use POST' });
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

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

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
    return res.status(500).json({ error: 'Proxy error: ' + err.message });
  }
};
