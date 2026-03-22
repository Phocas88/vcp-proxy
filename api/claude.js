// Veteran Career Path — Anthropic API Proxy
// Deploy to Vercel. Set ANTHROPIC_API_KEY in Vercel environment variables.

export default async function handler(req, res) {
  // ── CORS — allow your domain + localhost for testing ──
  const allowed = [
    'https://veterancareerpath.com',
    'https://www.veterancareerpath.com',
    'https://phocas88.github.io',
    'http://localhost',
    'http://localhost:3000',
    'http://127.0.0.1',
  ];

  const origin = req.headers.origin || '';
  const isAllowed = allowed.some(a => origin.startsWith(a)) || origin === '';

  // Always set CORS headers
  res.setHeader('Access-Control-Allow-Origin', isAllowed ? (origin || '*') : 'https://veterancareerpath.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured on server.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Proxy request failed: ' + err.message });
  }
}
