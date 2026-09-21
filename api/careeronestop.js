// Veteran Career Path - server-side CareerOneStop (U.S. DOL) API proxy.
// Route: /api/careeronestop?resource=<name>&...   (public; DOL data is free to view)
// Keeps the API token server-side (CareerOneStop requires Authorization: Bearer <token>)
// and injects the User ID into the path, so the static site can call it from the browser.
//
// Required env vars:
//   CAREERONESTOP_USER_ID  - the User ID issued at registration (goes in the URL path)
//   CAREERONESTOP_TOKEN    - the API token (sent as Authorization: Bearer <token>)
//
// Supported resources (each maps to a documented CareerOneStop v1 endpoint):
//   occupation     ?onet=15-1212.00&location=US
//   certifications ?keyword=Information+Security+Analysts
//   license        ?keyword=Security+Guards&state=TX
//   training       ?keyword=Truck+Driving&location=78201&radius=50
// Attribution ("Powered by CareerOneStop") is rendered on the pages that display the data.

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
  // CareerOneStop data (certs, licenses, outlook) changes slowly — cache hard at the edge.
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
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

// ---- input sanitizers (defense against path injection into the upstream URL) ----
const clean = (v, max) => (typeof v === 'string' ? v : '').replace(/[^A-Za-z0-9 .,&'+/()-]/g, '').trim().slice(0, max || 80);
const onetOk = (v) => /^[0-9]{2}-[0-9]{4}(\.[0-9]{2})?$/.test(v || '');
const stateOk = (v) => /^[A-Za-z]{2}$/.test(v || '');
const locOk = (v) => /^[A-Za-z0-9 ,.-]{1,40}$/.test(v || '');
const enc = (v) => encodeURIComponent(v);

// Build the upstream path (after the base) for each supported resource.
function buildPath(resource, q, uid) {
  const kw = clean(q.keyword, 120);
  switch (resource) {
    case 'occupation': {
      // Occupation details: wages, projections/outlook, bright-outlook, tasks.
      const onet = onetOk(q.onet) ? q.onet : '';
      const loc = locOk(q.location) ? q.location : 'US';
      const key = onet || kw;
      if (!key) return null;
      return `/v1/occupation/${uid}/${enc(key)}/${enc(loc)}?enableMetaData=false&training=false`;
    }
    case 'certifications': {
      // Certification Finder by keyword (occupation title). Top 10, sorted by best match.
      if (!kw) return null;
      // path: /v1/certificationfinder/{userId}/{keyword}/{sort}/{dir}/{start}/{limit}/{filters...}
      return `/v1/certificationfinder/${uid}/${enc(kw)}/0/0/0/10/0/0/0/0`;
    }
    case 'license': {
      // License Finder by keyword (occupation title) + state.
      if (!kw || !stateOk(q.state)) return null;
      return `/v1/license/${uid}/${enc(kw)}/${enc(q.state.toUpperCase())}/0/0/0/20`;
    }
    case 'training': {
      // Training Finder by keyword + location (ZIP or city,ST) + radius (miles).
      const loc = locOk(q.location) ? q.location : '';
      const radius = /^[0-9]{1,3}$/.test(q.radius || '') ? q.radius : '25';
      if (!kw || !loc) return null;
      return `/v1/trainingfinder/${uid}/${enc(kw)}/${enc(loc)}/${radius}/0/0/0/10`;
    }
    default:
      return null;
  }
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(clientIp)) return res.status(429).json({ error: 'rate_limited' });

  const uid = process.env.CAREERONESTOP_USER_ID;
  const token = process.env.CAREERONESTOP_TOKEN;
  if (!uid || !token) {
    console.error('[careeronestop] CAREERONESTOP_USER_ID / CAREERONESTOP_TOKEN not configured');
    // Presence-only diagnostic (never leaks values) so we can tell a naming/scope issue
    // apart from a missing redeploy.
    return res.status(500).json({ error: 'configuration_error', have_user_id: !!uid, have_token: !!token });
  }

  const q = req.query || {};
  let path;
  if (q.raw) {
    // Iteration/testing passthrough: exact v1 path with a {uid} placeholder. Restricted to
    // CareerOneStop's finder resources; no traversal; limited charset.
    let p = String(q.raw);
    try { p = decodeURIComponent(p); } catch (e) {}
    const c1 = /^\/v1\/(occupation|certificationfinder|license|trainingfinder|comparesalaries)\//.test(p);
    const c2 = /\.\./.test(p);
    const c3 = /^[A-Za-z0-9 %._/,{}'&()+?=:-]+$/.test(p);
    if (!c1 || c2 || !c3) {
      return res.status(400).json({ error: 'bad_raw_path', got: p.slice(0, 160), starts_ok: c1, has_dotdot: c2, charset_ok: c3 });
    }
    path = p.replace(/\{uid\}/g, uid);
  } else {
    const resource = clean(q.resource, 20);
    path = buildPath(resource, q, uid);
  }
  if (!path) return res.status(400).json({ error: 'bad_request', hint: 'unknown resource or missing/invalid params' });

  const url = 'https://api.careeronestop.org' + path;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const upstream = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (upstream.status === 204) return res.status(200).json({ resource, data: null });
    if (!upstream.ok) {
      console.error('[careeronestop] upstream error', resource, upstream.status);
      return res.status(502).json({ error: 'upstream_error', status: upstream.status });
    }
    const data = await upstream.json();
    return res.status(200).json({ resource, data });
  } catch (err) {
    console.error('[careeronestop] fetch failed', err && err.message);
    return res.status(504).json({ error: 'fetch_failed' });
  }
};
