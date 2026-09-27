// Public (invite-gated): store a resume-review intake and create the job as awaiting_payment.
// Route: /api/review-submit   POST { token, ...fields, fileIds:[...] }
// The browser NEVER sets payment state. Duplicate submissions from one invite are prevented
// atomically via a jobId claim on the invite document.
// Required env: FIREBASE_SERVICE_ACCOUNT_JSON
'use strict';
const { getDb, FieldValue } = require('./_lib/firebase-admin');
const {
  setCors, normStr, normEmail, pick, clientIp, rateLimiter, loadInviteByToken, newId, SERVICE_TYPE,
} = require('./_lib/review-common');

const limited = rateLimiter({ windowMs: 60_000, max: 10 });
const SERVICE_STATUS = ['Active Duty', 'Veteran', 'National Guard', 'Reserve'];

function buildIntake(b) {
  const missing = [];
  const req = (v, label, max) => { const s = normStr(v, max); if (!s) missing.push(label); return s; };

  const client = {
    name: req(b.fullName, 'Full name', 120),
    email: normEmail(b.email),
    phone: normStr(b.phone, 40),
  };
  if (!client.email) missing.push('Email address');

  const military = {
    branch: req(b.branch, 'Military branch', 40),
    mos: req(b.mos, 'MOS / Rate / AFSC', 60),
    rank: req(b.rank, 'Highest rank or grade', 60),
    yearsService: req(b.yearsService, 'Years of service', 20),
    serviceStatus: pick(b.serviceStatus, SERVICE_STATUS, ''),
    clearance: normStr(b.clearance, 60),
    certifications: normStr(b.certifications, 2000),
    education: normStr(b.education, 2000),
    additionalExperience: normStr(b.additionalExperience, 4000),
    awardsQualifications: normStr(b.awardsQualifications, 2000),
  };
  if (!military.serviceStatus) missing.push('Current status');

  const career = {
    primaryTarget: req(b.primaryTarget, 'Primary civilian target', 120),
    secondaryTarget: normStr(b.secondaryTarget, 120),
    industry: req(b.industry, 'Target industry', 80),
    targetCompany: normStr(b.targetCompany, 120),
    targetLocation: normStr(b.targetLocation, 120),
    remotePreference: normStr(b.remotePreference, 60),
    jobPostingUrl: normStr(b.jobPostingUrl, 500),
    jobDescription: normStr(b.jobDescription, 8000),
  };
  if (!career.targetLocation && !career.remotePreference) missing.push('Location or remote preference');

  const reviewRequest = {
    requestedHelp: req(b.requestedHelp, 'What you want help with', 4000),
    missingInfo: normStr(b.missingInfo, 2000),
    clientNotes: normStr(b.clientNotes, 4000),
  };

  return { client, military, career, reviewRequest, missing };
}

module.exports = async function handler(req, res) {
  setCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (limited('sub:' + clientIp(req))) return res.status(429).json({ error: 'rate_limited' });

  let db;
  try { db = getDb(); } catch (e) { console.error('[review-submit] init:', e.code || e.message); return res.status(500).json({ error: 'configuration_error' }); }

  const b = req.body || {};
  const rawToken = normStr(b.token, 128);
  const invite = await loadInviteByToken(db, rawToken);
  if (!invite.ok) return res.status(403).json({ error: 'invalid_invite', reason: invite.reason });

  // Required consent.
  if (b.consentEmployment !== true || b.consentAI !== true) {
    return res.status(400).json({ error: 'consent_required' });
  }

  const intake = buildIntake(b);
  if (intake.missing.length) return res.status(400).json({ error: 'missing_fields', missing: intake.missing });
  if (career_urlBad(intake.career.jobPostingUrl)) return res.status(400).json({ error: 'invalid_url' });

  // Resolve uploaded files (must belong to this invite, not already consumed).
  const fileIds = Array.isArray(b.fileIds) ? b.fileIds.map((x) => normStr(x, 32)).filter(Boolean).slice(0, 5) : [];
  const files = [];
  for (const fid of fileIds) {
    const up = await db.collection('resumeReviewUploads').doc(fid).get();
    if (up.exists && up.data().inviteHash === invite.inviteHash) {
      const u = up.data();
      files.push({ fileId: fid, filename: u.filename, size: u.size, contentType: u.contentType, kind: u.kind, pathname: u.pathname, url: u.url });
    }
  }
  if (files.length === 0) return res.status(400).json({ error: 'resume_required' });

  try {
    const jobId = newId(12);
    const jobRef = db.collection('resumeReviewJobs').doc(jobId);

    const outcome = await db.runTransaction(async (tx) => {
      const inviteSnap = await tx.get(invite.ref);
      const iv = inviteSnap.data();
      if (!iv || iv.status !== 'active') return { duplicate: false, blocked: iv ? iv.status : 'not_found' };
      if (iv.jobId) return { duplicate: true, existingJobId: iv.jobId };

      tx.set(jobRef, {
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        serviceType: SERVICE_TYPE,
        inviteHash: invite.inviteHash,
        source: iv.source || 'TikTok DM',
        client: intake.client,
        military: intake.military,
        career: intake.career,
        reviewRequest: intake.reviewRequest,
        consent: { employment: true, aiAssist: true, at: FieldValue.serverTimestamp() },
        files,
        payment: { status: 'unpaid', stripeSessionId: null, paymentIntentId: null, amount: null, currency: null, paidAt: null },
        status: 'awaiting_payment',
        unread: false,
        reviewerNotes: '',
        extractedResumeText: '',
        workingReview: {
          reviewerNotes: '', summaryFeedback: '', priorityFixes: '',
          bulletRewrites: '', careerRecommendations: '', questionsForClient: '', finalMessage: '',
        },
        finalReview: '',
        deliveredAt: null,
      });
      tx.update(invite.ref, { jobId });
      return { duplicate: false, created: true, jobId };
    });

    if (outcome.blocked) return res.status(403).json({ error: 'invalid_invite', reason: outcome.blocked });
    if (outcome.duplicate) return res.status(200).json({ jobId: outcome.existingJobId, checkoutAvailable: true, duplicate: true });

    // Mark pending uploads consumed (best-effort).
    await Promise.all(files.map((f) => db.collection('resumeReviewUploads').doc(f.fileId).update({ consumed: true, jobId }).catch(() => {})));

    return res.status(200).json({ jobId, checkoutAvailable: true });
  } catch (err) {
    console.error('[review-submit] error:', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
};

function career_urlBad(url) {
  if (!url) return false;
  return !/^https?:\/\/[^\s]+$/i.test(url);
}

// Exposed for unit tests.
module.exports.buildIntake = buildIntake;
module.exports.career_urlBad = career_urlBad;
