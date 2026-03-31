// Veteran Career Path — Anthropic API Proxy
// Deploy to Vercel. Set ANTHROPIC_API_KEY in Vercel environment variables.
// Route: POST /api/claude

export default async function handler(req, res) {
  // CORS
  const allowed = [
    'https://veterancareerpath.com',
    'https://www.veterancareerpath.com',
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1',
  ];
  const origin = req.headers.origin || '';
  const corsOrigin = allowed.find(a => origin.startsWith(a));
  if (corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  } else {
    // Allow all origins in development — tighten for production if needed
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY environment variable is not set on the server. Go to Vercel Dashboard → Your Project → Settings → Environment Variables and add it.'
    });
  }

  try {
    const body = req.body || {};

    // Ensure a valid model — default to haiku if not specified
    if (!body.model) {
      body.model = 'claude-haiku-4-5-20251001';
    }

    // Ensure max_tokens is set
    if (!body.max_tokens) {
      body.max_tokens = 1024;
    }

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
      console.error('Anthropic API error:', response.status, JSON.stringify(data));
      // Pass through Anthropic's error with the status code
      return res.status(response.status).json({
        error: data?.error?.message || 'Anthropic API error',
        type: data?.error?.type || 'api_error',
        status: response.status,
        model: body.model,
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('Proxy error:', err.message);
    return res.status(500).json({
      error: 'Proxy request failed: ' + err.message
    });
  }
}
