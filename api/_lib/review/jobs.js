// Admin-only: list / filter resume-review jobs (server fallback; the dashboard also uses a
// realtime Firestore listener). Route: /api/review-jobs?status=new&limit=200
// Returns compact queue summaries — not full working-review bodies.
// Required env: FIREBASE_SERVICE_ACCOUNT_JSON
'use strict';
const { requireAdmin } = require('../admin-auth');
const { getDb } = require('../firebase-admin');
const { setCors, clientIp, rateLimiter, JOB_STATUSES } = require('../review-common');

const limited = rateLimiter({ windowMs: 60_000, max: 60 });

function summary(id, j) {
  const f = Array.isArray(j.files) && j.files[0] ? j.files[0] : null;
  return {
    jobId: id,
    serviceType: j.serviceType || 'resume_review',
    status: j.status,
    unread: !!j.unread,
    paymentStatus: j.payment?.status || 'unpaid',
    amount: j.payment?.amount || null,
    currency: j.payment?.currency || 'usd',
    source: j.source || '',
    client: { name: j.client?.name || '' },
    military: { branch: j.military?.branch || '', mos: j.military?.mos || '' },
    career: { primaryTarget: j.career?.primaryTarget || '' },
    resumeFilename: f ? f.filename : '',
    fileCount: Array.isArray(j.files) ? j.files.length : 0,
    createdAt: j.createdAt?.toMillis ? j.createdAt.toMillis() : null,
    updatedAt: j.updatedAt?.toMillis ? j.updatedAt.toMillis() : null,
    paidAt: j.payment?.paidAt?.toMillis ? j.payment.paidAt.toMillis() : null,
    deliveredAt: j.deliveredAt?.toMillis ? j.deliveredAt.toMillis() : null,
  };
}

module.exports = async function handler(req, res) {
  setCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = await requireAdmin(req);
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error });
  if (limited('jobs:' + admin.uid)) return res.status(429).json({ error: 'rate_limited' });

  let db;
  try { db = getDb(); } catch (e) { console.error('[review-jobs] init:', e.code || e.message); return res.status(500).json({ error: 'configuration_error' }); }

  try {
    const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 200, 1), 500);
    const status = String(req.query?.status || '').trim();
    // Order by a single field (auto-indexed) and filter status in memory to avoid needing a
    // composite index. The dashboard's realtime listener is the primary path; this is a fallback.
    const snap = await db.collection('resumeReviewJobs').orderBy('createdAt', 'desc').limit(limit).get();
    let jobs = snap.docs.map((d) => summary(d.id, d.data()));
    if (status && JOB_STATUSES.includes(status)) jobs = jobs.filter((j) => j.status === status);
    return res.status(200).json({ jobs });
  } catch (err) {
    console.error('[review-jobs] error:', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
};
