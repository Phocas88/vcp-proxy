// Veteran Career Path — public profile server-side renderer.
// Route: /veteran/:slug  (see vercel.json rewrite -> /api/veteran/:slug)
//
// Renders an opt-in public "digital CV" so a shared link shows a real social
// preview card (Open Graph). Reads the world-readable publicProfiles/{slug} doc via
// the Firestore REST API using the PUBLIC web API key (no service account, no secret).
// Only sanitized, owner-chosen fields exist in that collection. All user-controlled
// values are HTML-escaped.

const PROJECT = 'veteran-career-builder';
const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyDEh2Aivj4q8hVITI60fLZz8uCyP6UV7Os'; // public/embeddable
const SITE = 'https://veterancareerpath.com';
const DEFAULT_OG_IMAGE = SITE + '/img/optimized/logo-192.webp';

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
const attr = esc;

function ymRange(e) {
  const f = (d) => d ? esc(d) : '';
  const end = e.current ? 'Present' : f(e.endDate) || '';
  const start = f(e.startDate);
  return [start, end].filter(Boolean).join(' – ');
}
function bullets(arr) {
  if (!Array.isArray(arr) || !arr.length) return '';
  return '<ul>' + arr.map((b) => '<li>' + esc(String(b).replace(/^[•▪◦\-\*\s]+/, '')) + '</li>').join('') + '</ul>';
}
const EMBLEMS = { 'army': 'army', 'navy': 'navy', 'air force': 'airforce', 'marine corps': 'marines', 'marines': 'marines', 'coast guard': 'coastguard', 'space force': 'spaceforce' };
function emblemUrl(branch) {
  const f = EMBLEMS[String(branch || '').toLowerCase().trim()];
  return SITE + '/img/optimized/' + (f || 'logo-192') + '.webp';
}
function expBlock(title, org, dates, bl) {
  return '<div class="exp">' +
    '<div class="exp-head"><span class="exp-title">' + title + '</span>' +
    (dates ? '<span class="exp-dates">' + dates + '</span>' : '') + '</div>' +
    (org ? '<div class="exp-org">' + org + '</div>' : '') +
    bullets(bl) + '</div>';
}

function head(inner) {
  return '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">' +
    inner + styleTag();
}

function styleTag() {
  return '<style>' +
    '*{box-sizing:border-box}' +
    'body{margin:0;font-family:Inter,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1b2432;background:#eaeef4;line-height:1.6;-webkit-font-smoothing:antialiased}' +
    'a{color:#12305e}' +
    '.hero{position:relative;overflow:hidden;text-align:center;padding:3.2rem 1.2rem 3.4rem;color:#fff;' +
      'background:radial-gradient(1200px 400px at 50% -10%,#1c3f74,transparent),linear-gradient(135deg,#0a1628,#12294d)}' +
    '.hero:after{content:"";position:absolute;left:0;right:0;bottom:0;height:4px;background:linear-gradient(90deg,#f0c040,#e0a92e)}' +
    '.emblem{width:92px;height:92px;object-fit:contain;display:block;margin:0 auto .9rem;filter:drop-shadow(0 6px 16px rgba(0,0,0,.45))}' +
    '.hero h1{font-family:"Bebas Neue",sans-serif;font-size:2.7rem;line-height:1.05;letter-spacing:.03em;margin:0 0 .25rem}' +
    '.headline{color:#f4cf6a;font-weight:600;font-size:1.08rem}' +
    '.loc{color:#c2d2ec;font-size:.9rem;margin-top:.45rem}' +
    '.badge{display:inline-block;margin-top:1rem;background:rgba(240,192,64,.14);border:1px solid rgba(240,192,64,.45);' +
      'color:#f4d98a;padding:.32rem .9rem;border-radius:999px;font-size:.78rem;font-weight:600;letter-spacing:.05em;text-transform:uppercase}' +
    'main{max-width:740px;margin:-1.6rem auto 0;padding:0 1rem 1rem;position:relative}' +
    '.card{background:#fff;border:1px solid #e6ebf2;border-radius:16px;padding:1.4rem 1.5rem;margin-bottom:1.1rem;box-shadow:0 6px 22px rgba(12,26,48,.07)}' +
    '.card h2{font-family:"Bebas Neue",sans-serif;letter-spacing:.05em;font-size:1.35rem;color:#12294d;margin:0 0 1rem;' +
      'padding-left:.65rem;border-left:4px solid #e0a92e}' +
    '.summary{font-size:1.02rem;color:#33435a;margin:0}' +
    '.exp{position:relative;padding:0 0 1.1rem 1.1rem;border-left:2px solid #eef1f6;margin-left:.2rem}' +
    '.exp:last-child{padding-bottom:0}' +
    '.exp:before{content:"";position:absolute;left:-7px;top:.35rem;width:12px;height:12px;border-radius:50%;background:#e0a92e;border:2px solid #fff;box-shadow:0 0 0 1px #e6ebf2}' +
    '.exp-head{display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;align-items:baseline}' +
    '.exp-title{font-weight:700;color:#17222f;font-size:1.02rem}' +
    '.exp-dates{color:#8493a8;font-size:.82rem;white-space:nowrap;font-weight:500}' +
    '.exp-org{color:#5a6b82;font-size:.92rem;margin:.1rem 0 .4rem;font-weight:500}' +
    'ul{margin:.4rem 0 0;padding-left:1.15rem}li{margin:.28rem 0;color:#33435a}' +
    '.edu{margin-bottom:.7rem}.edu:last-child{margin-bottom:0}.edu b{color:#17222f}.edu span{color:#5a6b82;font-size:.9rem}' +
    '.chips{display:flex;flex-wrap:wrap;gap:.45rem}' +
    '.chip{background:#eef3fb;color:#22406e;border:1px solid #d9e5f6;padding:.34rem .72rem;border-radius:999px;font-size:.82rem;font-weight:500}' +
    '.skillgroup{margin-bottom:.9rem}.skillgroup:last-child{margin-bottom:0}.skillgroup .lbl{font-size:.74rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#8493a8;margin:0 0 .4rem}' +
    '.contact{display:flex;flex-wrap:wrap;gap:.55rem}' +
    '.contact a{background:#12294d;color:#fff;padding:.55rem 1.05rem;border-radius:9px;text-decoration:none;font-size:.88rem;font-weight:600}' +
    '.contact a:hover{background:#1c3f74}' +
    'footer{text-align:center;padding:1.5rem 1.2rem 2.6rem;color:#5a6b82;font-size:.85rem}' +
    'footer .cta{display:inline-block;margin-bottom:.9rem;background:linear-gradient(135deg,#f4cf6a,#e0a92e);color:#0a1628;font-weight:700;' +
      'padding:.75rem 1.5rem;border-radius:11px;text-decoration:none;box-shadow:0 6px 18px rgba(224,169,46,.35)}' +
    'footer .built a{color:#12305e;font-weight:600}' +
    '@media(max-width:600px){.hero{padding:2.6rem 1rem 3rem}.hero h1{font-size:2.2rem}main{padding:0 .7rem 1rem}.card{padding:1.15rem 1.15rem}.exp-dates{white-space:normal}}' +
    '</style>';
}

function footer() {
  return '<footer>' +
    '<a class="cta" href="' + SITE + '/app.html">Build your own veteran profile →</a>' +
    '<div class="built">Built on <a href="' + SITE + '">VeteranCareerPath.com</a> · free tools that translate military service into civilian careers.</div>' +
    '</footer>';
}

function notFound(res) {
  const h = head('<meta name="robots" content="noindex"><title>Profile not found | Veteran Career Path</title>');
  const body = '<div class="hero"><h1>Profile Not Found</h1><div class="headline">This profile may have been unpublished</div></div>' +
    '<main><div class="card summary" style="text-align:center">The link may be incorrect, or the veteran unpublished their profile.<br><br>' +
    '<a href="' + SITE + '">Go to Veteran Career Path →</a></div></main>' + footer();
  return res.status(404).send('<!DOCTYPE html><html lang="en"><head>' + h + '</head><body>' + body + '</body></html>');
}

module.exports = async function handler(req, res) {
  const slug = String((req.query && req.query.slug) || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!slug) return notFound(res);

  let p;
  try {
    const url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT +
      '/databases/(default)/documents/publicProfiles/' + encodeURIComponent(slug) + '?key=' + API_KEY;
    const r = await fetch(url);
    if (r.status === 404) return notFound(res);
    if (!r.ok) throw new Error('firestore ' + r.status);
    const doc = await r.json();
    p = decodeFields(doc.fields || {});
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return notFound(res);
  }
  if (!p || p.published === false) return notFound(res);

  const name = p.name || 'Veteran';
  const headline = p.headline || 'U.S. Military Veteran';
  const summary = p.summary || '';
  const ogDesc = (summary || (headline + ' — veteran career profile')).slice(0, 200);
  const shareUrl = 'https://' + (req.headers.host || 'profiles.veterancareerpath.com') + '/veteran/' + esc(slug);
  const robots = p.noindex ? '<meta name="robots" content="noindex,nofollow">' : '<meta name="robots" content="index,follow">';

  const mil = Array.isArray(p.military) ? p.military : [];
  const civ = Array.isArray(p.civilian) ? p.civilian : [];
  const edu = Array.isArray(p.education) ? p.education : [];
  const sk = p.skills || {};
  const contact = p.contact || {};
  const branch = (mil[0] && mil[0].branch) || '';

  const metaHead =
    '<title>' + esc(name) + ' — ' + esc(headline) + '</title>' +
    '<meta name="description" content="' + attr(ogDesc) + '">' + robots +
    '<link rel="canonical" href="' + attr(shareUrl) + '">' +
    '<meta property="og:type" content="profile">' +
    '<meta property="og:title" content="' + attr(name + ' — ' + headline) + '">' +
    '<meta property="og:description" content="' + attr(ogDesc) + '">' +
    '<meta property="og:url" content="' + attr(shareUrl) + '">' +
    '<meta property="og:image" content="' + attr(p.photo || DEFAULT_OG_IMAGE) + '">' +
    '<meta property="og:site_name" content="Veteran Career Path">' +
    '<meta name="twitter:card" content="summary_large_image">' +
    '<meta name="twitter:title" content="' + attr(name + ' — ' + headline) + '">' +
    '<meta name="twitter:description" content="' + attr(ogDesc) + '">' +
    '<meta name="twitter:image" content="' + attr(p.photo || DEFAULT_OG_IMAGE) + '">';

  let body = '<div class="hero">' +
    '<img class="emblem" src="' + attr(emblemUrl(branch)) + '" alt="' + attr(branch || 'U.S. Military') + ' emblem" loading="eager">' +
    '<h1>' + esc(name) + '</h1>' +
    '<div class="headline">' + esc(headline) + '</div>' +
    (p.location ? '<div class="loc">📍 ' + esc(p.location) + '</div>' : '') +
    (branch ? '<div class="badge">🎖️ ' + esc(branch) + ' Veteran</div>' : '<div class="badge">🎖️ U.S. Military Veteran</div>') +
    '</div><main>';

  if (summary) body += '<section class="card"><h2>Summary</h2><p class="summary">' + esc(summary) + '</p></section>';

  if (mil.length) {
    body += '<section class="card"><h2>Military Service</h2>' + mil.map((e) => {
      const title = [esc(e.rank), esc(e.mosTitle)].filter(Boolean).join(' · ') || 'Military Service';
      const org = [esc(e.unit), [esc(e.branch), esc(e.serviceType)].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
      return expBlock(title, org, ymRange(e), e.bullets);
    }).join('') + '</section>';
  }

  if (civ.length) {
    body += '<section class="card"><h2>Civilian Experience</h2>' + civ.map((e) => {
      const org = [esc(e.employer), esc(e.location)].filter(Boolean).join(' · ');
      return expBlock(esc(e.title) || 'Role', org, ymRange(e), e.bullets);
    }).join('') + '</section>';
  }

  if (edu.length) {
    body += '<section class="card"><h2>Education</h2>' + edu.map((e) =>
      '<div class="edu"><b>' + esc(e.degree || '') + (e.field ? ', ' + esc(e.field) : '') + '</b><br>' +
      '<span>' + esc(e.institution || '') + (e.year ? ' · ' + esc(e.year) : '') + '</span></div>').join('') + '</section>';
  }

  const skillGroups = [['leadership', 'Leadership'], ['technical', 'Technical'], ['certs', 'Certifications'], ['languages', 'Languages']]
    .filter(([k]) => sk[k] && String(sk[k]).trim())
    .map(([k, label]) => '<div class="skillgroup"><div class="lbl">' + label + '</div><div class="chips">' +
      String(sk[k]).split(',').map((s) => s.trim()).filter(Boolean).map((s) => '<span class="chip">' + esc(s) + '</span>').join('') +
      '</div></div>');
  if (skillGroups.length) body += '<section class="card"><h2>Skills &amp; Certifications</h2>' + skillGroups.join('') + '</section>';

  const cLinks = [];
  if (contact.email) cLinks.push('<a href="mailto:' + attr(contact.email) + '">✉️ Email</a>');
  if (contact.phone) cLinks.push('<a href="tel:' + attr(contact.phone) + '">📞 ' + esc(contact.phone) + '</a>');
  if (contact.linkedin) cLinks.push('<a href="' + attr(contact.linkedin) + '" rel="nofollow noopener" target="_blank">🔗 LinkedIn</a>');
  if (cLinks.length) body += '<section class="card"><h2>Contact</h2><div class="contact">' + cLinks.join('') + '</div></section>';

  body += '</main>' + footer();

  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=30');
  return res.status(200).send('<!DOCTYPE html><html lang="en"><head>' + head(metaHead) + '</head><body>' + body + '</body></html>');
};
