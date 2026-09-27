// Admin-only: read one resume-review job, or patch its mutable fields.
// Route: /api/review-job?jobId=...
//   GET   -> full job (server-validated admin)
//   PATCH { status?, reviewerNotes?, workingReview?, finalReview?, unread? }
// Status is validated server-side against the allowed admin-settable set.
// Required env: FIREBASE_SERVICE_ACCOUNT_JSON
'use strict';
const { requireAdmin } = require('./_lib/admin-auth');
const { getDb, FieldValue } = require('./_lib/firebase-admin');
const { setCors, normStr, clientIp, rateLimiter, readJsonBody, ADMIN_SETTABLE_STATUSES } = require('./_lib/review-common');

const limited = rateLimiter({ windowMs: 60_000, max: 120 });
const WORKING_KEYS = ['reviewerNotes', 'summaryFeedback', 'priorityFixes', 'bulletRewrites', 'careerRecommendations', 'questionsForClient', 'finalMessage'];
const BIG = 20000;

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
      const updates = { updatedAt: FieldValue.serverTimestamp() };

      if (body.status !== undefined) {
        const st = normStr(body.status, 40);
        if (!ADMIN_SETTABLE_STATUSES.includes(st)) return res.status(400).json({ error: 'invalid_status' });
        updates.status = st;
        if (st === 'delivered') updates.deliveredAt = FieldValue.serverTimestamp();
      }
      if (body.unread !== undefined) updates.unread = !!body.unread;
      if (body.reviewerNotes !== undefined) updates.reviewerNotes = normStr(body.reviewerNotes, BIG);
      if (body.finalReview !== undefined) updates.finalReview = normStr(body.finalReview, BIG);
      if (body.workingReview !== undefined && body.workingReview && typeof body.workingReview === 'object') {
        for (const k of WORKING_KEYS) {
          if (body.workingReview[k] !== undefined) updates['workingReview.' + k] = normStr(body.workingReview[k], BIG);
        }
      }

      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'not_found' });
      await ref.update(updates);
      return res.status(200).json({ ok: true });
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
    serviceType: j.serviceType, status: j.status, unread: !!j.unread, source: j.source,
    client: j.client || {}, military: j.military || {}, career: j.career || {}, reviewRequest: j.reviewRequest || {},
    files,
    payment: { status: j.payment?.status || 'unpaid', amount: j.payment?.amount || null, currency: j.payment?.currency || 'usd', paidAt: ms(j.payment?.paidAt) },
    reviewerNotes: j.reviewerNotes || '', extractedResumeText: j.extractedResumeText || '',
    workingReview: j.workingReview || {}, finalReview: j.finalReview || '',
    createdAt: ms(j.createdAt), updatedAt: ms(j.updatedAt), deliveredAt: ms(j.deliveredAt),
  };
}
