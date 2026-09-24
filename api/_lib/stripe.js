// Shared Stripe REST helpers (no SDK — matches the proxy's zero-dependency pattern).
const crypto = require('crypto');

async function stripeGet(path, key, signal) {
  const r = await fetch('https://api.stripe.com' + path, {
    headers: { Authorization: 'Bearer ' + key },
    signal,
  });
  const d = await r.json();
  if (!r.ok) { const e = new Error(d?.error?.message || ('Stripe request failed (' + r.status + ')')); e.status = r.status; throw e; }
  return d;
}

// Flatten a nested object into Stripe's form-encoded array/object syntax.
function encodeForm(obj, prefix, out) {
  out = out || [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const key = prefix ? prefix + '[' + k + ']' : k;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object') encodeForm(item, key + '[' + i + ']', out);
        else out.push(encodeURIComponent(key + '[' + i + ']') + '=' + encodeURIComponent(item));
      });
    } else if (typeof v === 'object') {
      encodeForm(v, key, out);
    } else {
      out.push(encodeURIComponent(key) + '=' + encodeURIComponent(v));
    }
  }
  return out;
}

async function stripePost(path, body, key, signal) {
  const r = await fetch('https://api.stripe.com' + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: encodeForm(body).join('&'),
    signal,
  });
  const d = await r.json();
  if (!r.ok) { const e = new Error(d?.error?.message || ('Stripe request failed (' + r.status + ')')); e.status = r.status; throw e; }
  return d;
}

// Verify a Stripe webhook signature (Stripe-Signature: "t=...,v1=...") against the RAW body.
function verifyStripeWebhook(rawBody, sigHeader, secret, toleranceSec = 300) {
  if (!sigHeader || !secret || rawBody == null) return false;
  const parts = {};
  String(sigHeader).split(',').forEach(p => { const i = p.indexOf('='); if (i > 0) { const k = p.slice(0, i), val = p.slice(i + 1); (parts[k] = parts[k] || []).push(val); } });
  const t = parts.t && parts.t[0];
  const v1s = parts.v1 || [];
  if (!t || !v1s.length) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > toleranceSec) return false;
  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const expected = crypto.createHmac('sha256', secret).update(t + '.' + payload, 'utf8').digest('hex');
  return v1s.some(v => { try { return crypto.timingSafeEqual(Buffer.from(v), Buffer.from(expected)); } catch (_) { return false; } });
}

// Read the raw request body (needed for webhook signature verification).
function readRawBody(req) {
  return new Promise((resolve) => {
    if (typeof req.body === 'string') return resolve(req.body);
    if (Buffer.isBuffer(req.body)) return resolve(req.body.toString('utf8'));
    let data = '';
    let got = false;
    req.on('data', (c) => { got = true; data += c; });
    req.on('end', () => resolve(got ? data : (req.body && typeof req.body === 'object' ? JSON.stringify(req.body) : '')));
    req.on('error', () => resolve(''));
  });
}

module.exports = { stripeGet, stripePost, encodeForm, verifyStripeWebhook, readRawBody };
