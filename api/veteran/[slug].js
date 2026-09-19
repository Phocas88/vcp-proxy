// Veteran Career Path — public profile server-side renderer.
// Route: /veteran/:slug  (see vercel.json rewrite -> /api/veteran/:slug)
//
// Renders an opt-in public "digital CV" so a shared link shows a real social
// preview card (Open Graph) with the veteran's name/headline. Reads the
// world-readable publicProfiles/{slug} doc via the Firestore REST API using the
// PUBLIC web API key — no service account, no secret. The Firestore rule
// (publicProfiles read: if true) is what authorizes the read; only sanitized,
// owner-chosen fields ever exist in that collection.

const PROJECT = 'veteran-career-builder';
const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyDEh2Aivj4q8hVITI60fLZz8uCyP6UV7Os'; // public/embeddable
const SITE = 'https://veterancareerpath.com';
const DEFAULT_OG_IMAGE = SITE + '/img/optimized/logo.webp';

// ── Firestore REST value decoding ──
function decode(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
function decodeFields(fields) {
  const out = {};
  for (const k in fields) out[k] = decode(fields[k]);
  return out;
}

// ── HTML escaping (profile data is user-controlled) ──
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function attr(s) { return esc(s); }

function ymRange(e) {
  const f = (d) => d ? esc(d) : '';
  const end = e.current ? 'Present' : f(e.endDate) || '';
  return [f(e.startDate), end].filter(Boolean).join(' – ');
}

function bullets(arr) {
  if (!Array.isArray(arr) || !arr.length) return '';
  return '<ul>' + arr.map((b) => '<li>' + esc(b) + '</li>').join('') + '</ul>';
}

function renderExp(e, org) {
  return (
    '<div class="exp">' +
    '<div class="exp-h"><span class="exp-title">' + esc(e.title || e.mosTitle || '') + '</span>' +
    '<span class="exp-dates">' + ymRange(e) + '</span></div>' +
    '<div class="exp-org">' + esc(e[org] || '') + (e.location ? ' · ' + esc(e.location) : '') + '</div>' +
    bullets(e.bullets) +
    '</div>'
  );
}

function page(status, head, body) {
  return { status, html: '<!DOCTYPE html><html lang="en"><head>' + head + '</head><body>' + body + '</body></html>' };
}

function notFound() {
  const head =
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex"><title>Profile not found | Veteran Career Path</title>' +
    baseStyle();
  const body =
    '<main class="card" style="text-align:center"><h1>Profile not found</h1>' +
    '<p>This profile may have been unpublished or the link is incorrect.</p>' +
    '<p><a href="' + SITE + '">Go to Veteran Career Path →</a></p></main>' + footer();
  return page(404, head, body);
}

function baseStyle() {
  return '<style>' +
    ':root{--navy:#0a1628;--gold:#f0c040;--ink:#1a2a3a;--dim:#55637a}' +
    '*{box-sizing:border-box}body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;color:var(--ink);background:#eef2f7;line-height:1.55}' +
    '.hero{background:linear-gradient(135deg,#0a1628,#1a3a6b);color:#fff;padding:2.4rem 1.2rem;text-align:center}' +
    '.hero h1{margin:0 0 .3rem;font-size:1.9rem}.hero .headline{color:var(--gold);font-weight:600}' +
    '.hero .loc{color:#b0cce8;font-size:.9rem;margin-top:.3rem}' +
    'main{max-width:760px;margin:0 auto;padding:1.2rem}' +
    '.card{background:#fff;border-radius:12px;padding:1.4rem 1.5rem;margin:1rem 0;box-shadow:0 2px 14px rgba(10,22,40,.07)}' +
    'h2{color:#1a3a6b;font-size:1.15rem;border-bottom:2px solid #eef2f7;padding-bottom:.4rem;margin:0 0 .8rem}' +
    '.exp{margin:0 0 1.1rem}.exp-h{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}' +
    '.exp-title{font-weight:700}.exp-dates{color:var(--dim);font-size:.85rem;white-space:nowrap}' +
    '.exp-org{color:var(--dim);font-size:.9rem;margin-bottom:.3rem}ul{margin:.4rem 0;padding-left:1.1rem}li{margin:.2rem 0}' +
    '.skills p{margin:.3rem 0}.contact a{color:#1a3a6b;font-weight:600;margin-right:1rem}' +
    'footer{text-align:center;padding:1.6rem 1rem;color:var(--dim);font-size:.85rem}' +
    'footer a{color:#1a3a6b;font-weight:600}a{color:#1a3a6b}' +
    '</style>';
}

function footer() {
  return '<footer>Built on <a href="' + SITE + '">VeteranCareerPath.com</a> — free tools to translate military service into civilian careers.</footer>';
}

module.exports = async function handler(req, res) {
  const slug = String((req.query && req.query.slug) || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!slug) {
    const nf = notFound();
    return res.status(nf.status).send(nf.html);
  }

  let p;
  try {
    const url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT +
      '/databases/(default)/documents/publicProfiles/' + encodeURIComponent(slug) + '?key=' + API_KEY;
    const r = await fetch(url);
    if (r.status === 404) { const nf = notFound(); return res.status(404).send(nf.html); }
    if (!r.ok) throw new Error('firestore ' + r.status);
    const doc = await r.json();
    p = decodeFields(doc.fields || {});
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    const nf = notFound();
    return res.status(502).send(nf.html);
  }

  if (!p || p.published === false) { const nf = notFound(); return res.status(404).send(nf.html); }

  const name = p.name || 'Veteran';
  const headline = p.headline || 'U.S. Military Veteran';
  const summary = p.summary || '';
  const ogDesc = (summary || (headline + ' — veteran career profile')).slice(0, 200);
  const canonical = SITE.replace('https://', 'https://') + '/veteran/' + esc(slug); // display canonical
  const shareUrl = 'https://' + (req.headers.host || 'vcp-proxy.vercel.app') + '/veteran/' + esc(slug);

  const robots = p.noindex ? '<meta name="robots" content="noindex,nofollow">' : '<meta name="robots" content="index,follow">';

  const head =
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(name) + ' — ' + esc(headline) + '</title>' +
    '<meta name="description" content="' + attr(ogDesc) + '">' +
    robots +
    '<link rel="canonical" href="' + attr(shareUrl) + '">' +
    // Open Graph — the social preview card
    '<meta property="og:type" content="profile">' +
    '<meta property="og:title" content="' + attr(name + ' — ' + headline) + '">' +
    '<meta property="og:description" content="' + attr(ogDesc) + '">' +
    '<meta property="og:url" content="' + attr(shareUrl) + '">' +
    '<meta property="og:image" content="' + attr(p.photo || DEFAULT_OG_IMAGE) + '">' +
    '<meta property="og:site_name" content="Veteran Career Path">' +
    '<meta name="twitter:card" content="summary_large_image">' +
    '<meta name="twitter:title" content="' + attr(name + ' — ' + headline) + '">' +
    '<meta name="twitter:description" content="' + attr(ogDesc) + '">' +
    '<meta name="twitter:image" content="' + attr(p.photo || DEFAULT_OG_IMAGE) + '">' +
    baseStyle();

  const mil = Array.isArray(p.military) ? p.military : [];
  const civ = Array.isArray(p.civilian) ? p.civilian : [];
  const edu = Array.isArray(p.education) ? p.education : [];
  const sk = p.skills || {};
  const contact = p.contact || {};

  let body = '<div class="hero"><h1>' + esc(name) + '</h1>' +
    '<div class="headline">' + esc(headline) + '</div>' +
    (p.location ? '<div class="loc">' + esc(p.location) + '</div>' : '') + '</div><main>';

  if (summary) body += '<section class="card"><h2>Summary</h2><p>' + esc(summary) + '</p></section>';

  if (mil.length) body += '<section class="card"><h2>Military Service</h2>' +
    mil.map((e) => renderExp(e, 'unit')).join('') + '</section>';

  if (civ.length) body += '<section class="card"><h2>Civilian Experience</h2>' +
    civ.map((e) => renderExp(e, 'employer')).join('') + '</section>';

  if (edu.length) body += '<section class="card"><h2>Education</h2>' +
    edu.map((e) => '<div class="exp"><div class="exp-title">' + esc(e.degree || '') +
      (e.field ? ', ' + esc(e.field) : '') + '</div><div class="exp-org">' + esc(e.institution || '') +
      (e.year ? ' · ' + esc(e.year) : '') + '</div></div>').join('') + '</section>';

  const skillLines = ['leadership', 'technical', 'languages', 'certs']
    .filter((k) => sk[k]).map((k) => '<p><strong>' + k.charAt(0).toUpperCase() + k.slice(1) + ':</strong> ' + esc(sk[k]) + '</p>');
  if (skillLines.length) body += '<section class="card skills"><h2>Skills &amp; Certifications</h2>' + skillLines.join('') + '</section>';

  const cLinks = [];
  if (contact.email) cLinks.push('<a href="mailto:' + attr(contact.email) + '">Email</a>');
  if (contact.phone) cLinks.push('<a href="tel:' + attr(contact.phone) + '">' + esc(contact.phone) + '</a>');
  if (contact.linkedin) cLinks.push('<a href="' + attr(contact.linkedin) + '" rel="nofollow noopener" target="_blank">LinkedIn</a>');
  if (cLinks.length) body += '<section class="card contact"><h2>Contact</h2><p>' + cLinks.join('') + '</p></section>';

  body += '<section class="card" style="text-align:center"><a href="' + SITE + '/app.html" style="font-weight:700">Build your own veteran profile →</a></section>';
  body += '</main>' + footer();

  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
  const out = page(200, head, body);
  return res.status(200).send(out.html);
};
