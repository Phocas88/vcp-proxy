// Stripe webhook for the Veteran Resume Review service.
// Route: /api/review-webhook   (Stripe -> server; POST raw body)
// Configure in Stripe: endpoint https://vcp-proxy.vercel.app/api/review-webhook, event checkout.session.completed
// On a verified paid resume-review session it flips the job to "new"/unread and marks the invite used.
// Required env: STRIPE_WEBHOOK_SECRET_REVIEW, FIREBASE_SERVICE_ACCOUNT_JSON
'use strict';
const { verifyStripeWebhook, readRawBody } = require('../stripe');
const { getDb, FieldValue } = require('../firebase-admin');

// In-memory replay guard (bounded). Firestore transaction below is the durable idempotency.
const processed = new Map();
const TTL = 60 * 60 * 1000;
const MAX = 5000;
function seen(id) {
  const now = Date.now();
  if (processed.size > MAX) for (const [k, t] of processed) if (now - t > TTL) processed.delete(k);
  if (processed.has(id) && now - processed.get(id) < TTL) return true;
  processed.set(id, now); return false;
}

async function maybeSendAlert(job) {
  const to = process.env.RESUME_REVIEW_ALERT_EMAIL;
  const resendKey = process.env.RESEND_API_KEY; // only used if the site already has Resend
  if (!to || !resendKey) return; // no brand-new vendor added; skip unless already configured
  const who = job.track === 'civilian'
    ? `${job.background?.currentTitle || ''}`.trim()
    : `${job.military?.branch || ''} ${job.military?.mos || ''}`.trim();
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + resendKey },
      body: JSON.stringify({
        from: process.env.RESUME_REVIEW_ALERT_FROM || 'alerts@veterancareerpath.com',
        to,
        subject: `New Resume Review (${job.track === 'civilian' ? 'Civilian' : 'Veteran'})`,
        text: `New paid resume review: ${job.client?.name || 'Client'} • ${who}`.trim(),
      }),
    });
  } catch (_) { /* alerting is best-effort */ }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const secret = process.env.STRIPE_WEBHOOK_SECRET_REVIEW;
  if (!secret) { console.error('[review-webhook] STRIPE_WEBHOOK_SECRET_REVIEW not configured'); return res.status(500).json({ error: 'configuration_error' }); }

  const raw = await readRawBody(req);
  const sig = req.headers['stripe-signature'];
  if (!verifyStripeWebhook(raw, sig, secret)) return res.status(400).json({ error: 'invalid_signature' });

  let event;
  try { event = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)); }
  catch (_) { return res.status(400).json({ error: 'bad_json' }); }

  if (event.id && seen(event.id)) return res.status(200).json({ received: true, duplicate: true });

  if (event.type !== 'checkout.session.completed') return res.status(200).json({ received: true, ignored: true });

  const s = event.data?.object || {};
  if (s.metadata?.product !== 'resume-review-service' || s.payment_status !== 'paid') {
    return res.status(200).json({ received: true, ignored: true });
  }

  const jobId = String(s.metadata?.jobId || '');
  const inviteHash = String(s.metadata?.inviteHash || '');
  if (!/^[a-f0-9]{16,32}$/i.test(jobId)) { console.error('[review-webhook] bad jobId in metadata'); return res.status(200).json({ received: true }); }

  let db;
  try { db = getDb(); } catch (e) { console.error('[review-webhook] init:', e.code || e.message); return res.status(500).json({ error: 'configuration_error' }); }

  try {
    const jobRef = db.collection('resumeReviewJobs').doc(jobId);
    const alertJob = await db.runTransaction(async (tx) => {
      const snap = await tx.get(jobRef);
      if (!snap.exists) { console.error('[review-webhook] job not found', jobId); return null; }
      const job = snap.data();
      if (job.inviteHash && inviteHash && job.inviteHash !== inviteHash) { console.error('[review-webhook] invite mismatch', jobId); return null; }
      if (job.payment?.status === 'paid') return null; // already processed (durable idempotency)

      tx.update(jobRef, {
        'payment.status': 'paid',
        'payment.stripeSessionId': s.id || null,
        'payment.paymentIntentId': (typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id) || null,
        'payment.amount': typeof s.amount_total === 'number' ? s.amount_total : null,
        'payment.currency': s.currency || 'usd',
        'payment.paidAt': FieldValue.serverTimestamp(),
        status: 'new',
        unread: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (job.inviteHash) {
        tx.update(db.collection('resumeReviewInvites').doc(job.inviteHash), {
          status: 'used', usedAt: FieldValue.serverTimestamp(),
        });
      }
      return job;
    });

    if (alertJob) { await maybeSendAlert(alertJob); }
    console.log('[review-webhook] processed', event.id, 'job', jobId);
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[review-webhook] error:', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
};

// Keep Vercel from parsing the body so we can verify Stripe's exact raw bytes.
// (Set AFTER the handler assignment so it is not clobbered.)
module.exports.config = { api: { bodyParser: false } };
