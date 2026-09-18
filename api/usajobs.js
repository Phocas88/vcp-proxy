// Veteran Career Path - server-side USAJobs search proxy.
// Route: /api/usajobs  (public; job listings are free to view)
// Server-side so the API key stays secret and CORS/forbidden-header limits
// that block a direct browser call to data.usajobs.gov don't apply.
// Required env vars: USAJOBS_API_KEY
// Optional env vars: USAJOBS_USER_AGENT (defaults to the registered contact email)

const rateLimit = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 30;

function setCors(req, res) {
  const allowed = new Set([
    'https://veterancareerpath.com',
    'https://www.veterancareerpath.com',
  ]);
  const origin = req.headers.origin;
  if (allowed.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Cache identical searches briefly at the edge to ease the USAJobs rate limit.
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
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

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: 'rate_limited' });
  }

  const apiKey = process.env.USAJOBS_API_KEY;
  if (!apiKey) {
    console.error('[usajobs] USAJOBS_API_KEY is not configured');
    return res.status(500).json({ error: 'configuration_error' });
  }
  const userAgent = process.env.USAJOBS_USER_AGENT || 'mendozaarmytransition@gmail.com';

  const q = req.query || {};
  const params = new URLSearchParams();
  params.set('Keyword', str(q.keyword, 200) || 'veteran');
  const location = str(q.location, 120);
  if (location) params.set('LocationName', location);
  const grade = str(q.grade, 4).replace(/[^0-9]/g, '');
  if (grade) { params.set('PayGradeLow', grade); params.set('PayGradeHigh', grade); }
  if (q.vetOnly === '1' || q.vetOnly === 'true') params.set('WhoMayApply', 'veterans');
  if (q.remote === '1' || q.remote === 'true') params.set('RemoteIndicator', 'True');
  params.set('ResultsPerPage', '10');

  const url = 'https://data.usajobs.gov/api/search?' + params.toString();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const upstream = await fetch(url, {
      headers: {
        'Host': 'data.usajobs.gov',
        'User-Agent': userAgent,
        'Authorization-Key': apiKey,
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      console.error('[usajobs] upstream error', upstream.status);
      return res.status(502).json({ error: 'upstream_error', status: upstream.status });
    }
    const data = await upstream.json();
    // Pass through the USAJobs SearchResult shape the client already parses.
    return res.status(200).json({ SearchResult: data.SearchResult || {} });
  } catch (err) {
    console.error('[usajobs] fetch failed', err && err.message);
    return res.status(504).json({ error: 'fetch_failed' });
  }
};
