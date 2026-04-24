// Veteran Career Path — Access Code Validator
// Vercel Serverless Function — route: /api/validate-code
// Required env var: ACCESS_CODES (JSON string)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://veterancareerpath.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code } = req.body || {};
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ valid: false, reason: 'invalid' });
  }

  const c = code.trim().toUpperCase();

  let codesMap = {};
  try {
    codesMap = JSON.parse(process.env.ACCESS_CODES || '{}');
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
