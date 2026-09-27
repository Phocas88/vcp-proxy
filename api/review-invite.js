// Admin-only: create / revoke / list resume-review invitations.
// Route: /api/review-invite
//   POST { action:'create', clientName?, mos?, source?, adminNotes?, expiresInHours? } -> { url, token, inviteHash, expiresAt }
//   POST { action:'revoke', inviteHash }                                             -> { ok:true }
//   GET  ?limit=50                                                                    -> { invites:[...] } (no raw tokens)
// The raw token is 32 secure random bytes (64 hex). Only its SHA-256 hash is stored; the raw
// token is returned exactly once at creation and never persisted.
// Required env: FIREBASE_SERVICE_ACCOUNT_JSON
'use strict';
const { requireAdmin } = require('./_lib/admin-auth');
const { getDb, FieldValue } = require('./_lib/firebase-admin');
const { setCors, newRawToken, hashToken, normStr, clientIp, rateLimiter } = require('./_lib/review-common');

const SITE = 'https://veterancareerpath.com';
const EXPIRY_CHOICES = new Set([24, 72, 168, 336]); // 1d, 3d, 7d, 14d
const limited = rateLimiter({ windowMs: 60_000, max: 30 });

module.exports = async function handler(req, res) {
  setCors(req, res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const admin = await requireAdmin(req);
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error });
  if (limited('inv:' + admin.uid + ':' + clientIp(req))) return res.status(429).json({ error: 'rate_limited' });

  let db;
  try { db = getDb(); } catch (e) { console.error('[review-invite] admin init:', e.code || e.message); return res.status(500).json({ error: 'configuration_error' }); }

  try {
    if (req.method === 'GET') {
      const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 50, 1), 100);
      const snap = await db.collection('resumeReviewInvites').orderBy('createdAt', 'desc').limit(limit).get();
      const now = Date.now();
      const invites = snap.docs.map((d) => {
        const v = d.data();
        const expMs = v.expiresAt?.toMillis ? v.expiresAt.toMillis() : 0;
        let status = v.status;
        if (status === 'active' && expMs && expMs < now) status = 'expired';
        return {
          inviteHash: d.id,
          status,
          prefillName: v.prefillName || '',
          prefillMos: v.prefillMos || '',
          source: v.source || '',
          adminNotes: v.adminNotes || '',
          createdAt: v.createdAt?.toMillis ? v.createdAt.toMillis() : null,
          expiresAt: expMs || null,
          usedAt: v.usedAt?.toMillis ? v.usedAt.toMillis() : null,
          jobId: v.jobId || null,
        };
      });
      return res.status(200).json({ invites });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const action = normStr(body.action, 20) || 'create';

      if (action === 'revoke') {
        const inviteHash = normStr(body.inviteHash, 128);
        if (!/^[a-f0-9]{64}$/i.test(inviteHash)) return res.status(400).json({ error: 'invalid_invite' });
        const ref = db.collection('resumeReviewInvites').doc(inviteHash);
        const doc = await ref.get();
        if (!doc.exists) return res.status(404).json({ error: 'not_found' });
        if (doc.data().status === 'used') return res.status(409).json({ error: 'already_used' });
        await ref.update({ status: 'revoked', revokedAt: FieldValue.serverTimestamp() });
        return res.status(200).json({ ok: true });
      }

      if (action === 'create') {
        const hours = EXPIRY_CHOICES.has(Number(body.expiresInHours)) ? Number(body.expiresInHours) : 168;
        const raw = newRawToken();
        const inviteHash = hashToken(raw);
        const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
        await db.collection('resumeReviewInvites').doc(inviteHash).set({
          createdAt: FieldValue.serverTimestamp(),
          createdBy: admin.uid,
          expiresAt,
          usedAt: null,
          status: 'active',
          serviceType: 'resume_review',
          prefillName: normStr(body.clientName, 120),
          prefillMos: normStr(body.mos, 60),
          source: normStr(body.source, 60) || 'TikTok DM',
          adminNotes: normStr(body.adminNotes, 1000),
          jobId: null,
        });
        return res.status(200).json({
          url: `${SITE}/resume-review.html?token=${raw}`,
          token: raw,
          inviteHash,
          expiresAt: expiresAt.getTime(),
        });
      }

      return res.status(400).json({ error: 'unknown_action' });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    console.error('[review-invite] error:', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
};
