// Veteran Career Path store - verify a Stripe payment, then deliver the paid PDF.
// Route: /api/store-download   (GET ?session_id=cs_...&sku=...[&check=1])
//
// The Checkout Session is retrieved directly from Stripe (source of truth - NOT the
// redirect or any client flag), and must be paid, be product 'book', match the requested
// sku, and be within the download window. Only then do we fetch the Blob object server-side
// and stream its bytes to the buyer. The Blob URL (which carries an unguessable random
// suffix) is NEVER sent to the client, so there is no shareable link surfaced anywhere and
// nothing is downloadable without a verified payment.
//
//   ?check=1  -> returns JSON { ok:true, name } so the success page can confirm before
//                showing the download button (CORS-enabled for the site origin).
//   (no check) -> streams the PDF as an attachment download.
//
// Required env vars: STRIPE_SECRET_KEY
'use strict';
const { stripeGet } = require('./_lib/stripe');
const { getProduct, SKU_REGEX } = require('./_lib/store-catalog');

const CS_REGEX = /^cs_(test_|live_)?[A-Za-z0-9_]+$/;
// How long after purchase a buyer can re-download (generous - covers lost tabs, new device).
const DOWNLOAD_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

const rateLimit = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 30;
function isRateLimited(ip) {
  const now = Date.now(); const e = rateLimit.get(ip);
  if (!e || now - e.windowStart > RATE_WINDOW_MS) { rateLimit.set(ip, { windowStart: now, count: 1 }); return false; }
  e.count += 1; return e.count > RATE_MAX_REQUESTS;
}

function setCors(req, res) {
  const allowed = new Set(['https://veterancareerpath.com', 'https://www.veterancareerpath.com']);
  const origin = req.headers.origin;
  if (allowed.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

// Per-sku Blob URL map (sku -> download URL). The URLs are kept server-side ONLY.
// In production the map comes from the STORE_BLOBS env var (a JSON string) so the URLs
// never land in the public repo. Locally it falls back to data/store-blobs.json (gitignored),
// which scripts/upload-book.mjs writes.
function loadBlobMap() {
  if (process.env.STORE_BLOBS) {
    try { return JSON.parse(process.env.STORE_BLOBS); }
    catch (_) { console.error('[store-download] STORE_BLOBS is not valid JSON'); }
  }
  try { return require('../data/store-blobs.json'); }
  catch (_) { return {}; }
}

// Verify the Stripe Checkout Session grants this sku. Returns { ok, reason }.
function verifyPurchase(checkout, sku) {
  if (!checkout) return { ok: false, reason: 'not_found' };
  if (checkout.mode !== 'payment') return { ok: false, reason: 'wrong_mode' };
  if (checkout.payment_status !== 'paid') return { ok: false, reason: 'unpaid' };
  if (checkout.metadata?.product !== 'book') return { ok: false, reason: 'wrong_product' };
  if (String(checkout.metadata?.sku || '') !== sku) return { ok: false, reason: 'sku_mismatch' };
  const expiry = (Number(checkout.created || 0) * 1000) + DOWNLOAD_TTL_MS;
  if (expiry <= Date.now()) return { ok: false, reason: 'expired' };
  return { ok: true };
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ ok: false, error: 'rate_limited' });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { console.error('[store-download] STRIPE_SECRET_KEY not configured'); return res.status(500).json({ ok: false, error: 'configuration_error' }); }

  const q = req.query || {};
  const sessionId = String(q.session_id || '').trim();
  const sku = String(q.sku || '').trim().toLowerCase();
  const checkOnly = String(q.check || '') === '1';

  if (!CS_REGEX.test(sessionId)) return res.status(400).json({ ok: false, error: 'invalid_session_id' });
  if (!SKU_REGEX.test(sku)) return res.status(400).json({ ok: false, error: 'invalid_sku' });
  const product = getProduct(sku);
  if (!product) return res.status(404).json({ ok: false, error: 'unknown_product' });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const checkout = await stripeGet('/v1/checkout/sessions/' + encodeURIComponent(sessionId), key, controller.signal);
    const verdict = verifyPurchase(checkout, sku);
    if (!verdict.ok) return res.status(402).json({ ok: false, error: 'payment_required', reason: verdict.reason });

    if (checkOnly) return res.status(200).json({ ok: true, name: product.name, fileName: product.fileName });

    // Deliver the file: fetch the Blob object server-side and pipe the bytes. The blobUrl
    // (with its unguessable suffix) stays server-side; the buyer only ever sees this route.
    const blobUrl = loadBlobMap()[sku];
    if (!blobUrl) { console.error('[store-download] no blob mapped for sku', sku); return res.status(500).json({ ok: false, error: 'file_unavailable' }); }

    const fileRes = await fetch(blobUrl, { signal: controller.signal });
    if (!fileRes.ok) { console.error('[store-download] blob fetch failed', fileRes.status); return res.status(502).json({ ok: false, error: 'file_fetch_failed' }); }
    const buf = Buffer.from(await fileRes.arrayBuffer());

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Content-Disposition', 'attachment; filename="' + product.fileName + '"');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(buf);
  } catch (err) {
    console.error('[store-download] error:', err && err.message);
    const status = err && err.status === 404 ? 404 : 502;
    return res.status(status).json({ ok: false, error: 'verification_failed' });
  } finally { clearTimeout(timer); }
};

module.exports.verifyPurchase = verifyPurchase;
module.exports.DOWNLOAD_TTL_MS = DOWNLOAD_TTL_MS;
