// Admin-only: read one resume-review job, or patch its mutable fields.
// Route: /api/review-job?jobId=...
//   GET   -> full job (server-validated admin)
//   PATCH { status?, reviewerNotes?, workingReview?, finalReview?, unread? }
// Status is validated server-side against the allowed admin-settable set.
// Required env: FIREBASE_SERVICE_ACCOUNT_JSON
'use strict';
const { requireAdmin } = require('../admin-auth');
const { getDb, FieldValue } = require('../firebase-admin');
const { setCors, normStr, clientIp, rateLimiter, readJsonBody, ADMIN_SETTABLE_STATUSES, newRawToken, hashToken } = require('../review-common');

const limited = rateLimiter({ windowMs: 60_000, max: 120 });
const WORKING_KEYS = ['reviewerNotes', 'summaryFeedback', 'priorityFixes', 'bulletRewrites', 'careerRecommendations', 'questionsForClient', 'finalMessage'];
const BIG = 20000;

// Client "Career Journey" portal: a capability link that goes live when a review is
// delivered and stays up for 30 days (then the admin can archive it). The raw token is
// stored on the job so the admin can re-copy the same link; only its hash is used for the
// public lookup (review/journey.js). The portal returns no secrets, so a stable, re-copyable
// bearer link is an acceptable tradeoff for a good client experience.
const PORTAL_DAYS = 30;
const SITE = 'https://veterancareerpath.com';
function portalUrl(rawToken) { return SITE + '/journey.html?token=' + rawToken; }
function portalWindow() { return new Date(Date.now() + PORTAL_DAYS * 86400000); }

module.exports = async function handler(req, res) {
  setCors(req, res, 'GET, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const admin = await requireAdmin(req);
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error });
  if (limited('job:' + admin.uid)) return res.status(429).json({ error: 'rate_limited' });

  let db;
  try { db = getDb(); } catch (e) { console.error('[review-job] init:', e.code || e.message); return res.status(500).json({ error: 'configuration_error' }); }

  const jobId = normStr(req.query?.jobId, 64);
  if (!/^[a-f0-9]{16,32}$/i.test(jobId)) return res.status(400).json({ error: 'invalid_job' });
  const ref = db.collection('resumeReviewJobs').doc(jobId);

  try {
    if (req.method === 'GET') {
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'not_found' });
      return res.status(200).json({ jobId, job: serializeJob(snap.data()) });
    }

    if (req.method === 'PATCH') {
      const body = await readJsonBody(req);
      if (body === null) return res.status(400).json({ error: 'bad_json' });

      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'not_found' });
      const job = snap.data();

      const updates = { updatedAt: FieldValue.serverTimestamp() };
      const resp = { ok: true };

      // ── Portal lifecycle ──
      // portalAction: 'archive' takes the client link offline; 'relink' issues a fresh link
      // and resets the 30-day window (old link stops working). Delivering a review (below)
      // auto-publishes the portal the first time.
      const portalAction = normStr(body.portalAction, 20);
      if (portalAction === 'archive') {
        updates['portal.status'] = 'archived';
        updates['portal.archivedAt'] = FieldValue.serverTimestamp();
      } else if (portalAction === 'reactivate' && job.portalToken) {
        // Bring the client's EXISTING link back online + reset the 30-day window.
        updates['portal.status'] = 'active';
        updates['portal.expiresAt'] = portalWindow();
        resp.portalUrl = portalUrl(job.portalToken);
      } else if (portalAction === 'relink' || (portalAction === 'reactivate' && !job.portalToken)) {
        const raw = newRawToken();
        updates.portalToken = raw;
        updates.portalHash = hashToken(raw);
        updates['portal.status'] = 'active';
        updates['portal.publishedAt'] = FieldValue.serverTimestamp();
        updates['portal.expiresAt'] = portalWindow();
        resp.portalUrl = portalUrl(raw);
      }

      if (body.status !== undefined) {
        const st = normStr(body.status, 40);
        if (!ADMIN_SETTABLE_STATUSES.includes(st)) return res.status(400).json({ error: 'invalid_status' });
        updates.status = st;
        if (st === 'delivered') {
          updates.deliveredAt = FieldValue.serverTimestamp();
          if (!job.portalHash && portalAction !== 'relink') {
            // First delivery: mint the portal and open the 30-day window.
            const raw = newRawToken();
            updates.portalToken = raw;
            updates.portalHash = hashToken(raw);
            updates['portal.status'] = 'active';
            updates['portal.publishedAt'] = FieldValue.serverTimestamp();
            updates['portal.expiresAt'] = portalWindow();
            resp.portalUrl = portalUrl(raw);
          } else if (job.portalToken && portalAction !== 'relink' && (job.portal && job.portal.status) !== 'active') {
            // Re-delivering after an archive/expiry: reactivate the same link + reset window.
            updates['portal.status'] = 'active';
            updates['portal.expiresAt'] = portalWindow();
            resp.portalUrl = portalUrl(job.portalToken);
          }
        }
      }

      if (body.unread !== undefined) updates.unread = !!body.unread;
      if (body.reviewerNotes !== undefined) updates.reviewerNotes = normStr(body.reviewerNotes, BIG);
      if (body.finalReview !== undefined) updates.finalReview = normStr(body.finalReview, BIG);
      if (body.workingReview !== undefined && body.workingReview && typeof body.workingReview === 'object') {
        for (const k of WORKING_KEYS) {
          if (body.workingReview[k] !== undefined) updates['workingReview.' + k] = normStr(body.workingReview[k], BIG);
        }
      }

      await ref.update(updates);
      return res.status(200).json(resp);
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[review-job] error:', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
};

function ms(t) { return t && t.toMillis ? t.toMillis() : null; }
function serializeJob(j) {
  // Convert timestamps; drop internal blob URLs from file metadata (admin fetches via review-file).
  const files = Array.isArray(j.files) ? j.files.map((f) => ({ fileId: f.fileId, filename: f.filename, size: f.size, contentType: f.contentType, kind: f.kind })) : [];
  return {
    serviceType: j.serviceType, track: j.track || 'veteran', status: j.status, unread: !!j.unread, source: j.source,
    client: j.client || {}, military: j.military || {}, background: j.background || {}, career: j.career || {}, reviewRequest: j.reviewRequest || {},
    files,
    payment: { status: j.payment?.status || 'unpaid', amount: j.payment?.amount || null, currency: j.payment?.currency || 'usd', paidAt: ms(j.payment?.paidAt) },
    reviewerNotes: j.reviewerNotes || '', extractedResumeText: j.extractedResumeText || '',
    workingReview: j.workingReview || {}, finalReview: j.finalReview || '',
    createdAt: ms(j.createdAt), updatedAt: ms(j.updatedAt), deliveredAt: ms(j.deliveredAt),
    portal: {
      status: (j.portal && j.portal.status) || null,
      publishedAt: ms(j.portal && j.portal.publishedAt),
      expiresAt: ms(j.portal && j.portal.expiresAt),
    },
    portalUrl: j.portalToken ? ('https://veterancareerpath.com/journey.html?token=' + j.portalToken) : null,
  };
}
