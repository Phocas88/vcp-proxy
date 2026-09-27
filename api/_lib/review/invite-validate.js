// Public: validate a raw resume-review invitation token for the intake page.
// Route: /api/review-invite-validate   POST { token }
// Hashes the token server-side, classifies the invite, and returns ONLY safe display fields.
// Never returns internal Firestore data or the raw token.
// Required env: FIREBASE_SERVICE_ACCOUNT_JSON
'use strict';
const { getDb } = require('../firebase-admin');
const { setCors, normStr, clientIp, rateLimiter, loadInviteByToken } = require('../review-common');

const limited = rateLimiter({ windowMs: 60_000, max: 30 });

module.exports = async function handler(req, res) {
  setCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (limited('val:' + clientIp(req))) return res.status(429).json({ valid: false, reason: 'rate_limited' });

  let db;
  try { db = getDb(); } catch (e) { console.error('[review-invite-validate] init:', e.code || e.message); return res.status(500).json({ valid: false, reason: 'configuration_error' }); }

  const token = normStr(req.body?.token, 128);
  try {
    const result = await loadInviteByToken(db, token);
    if (!result.ok) {
      // Uniform 200 so callers can't distinguish "not found" from "invalid" via status codes.
      return res.status(200).json({
        valid: false,
        expired: result.reason === 'expired',
        used: result.reason === 'used',
        revoked: result.reason === 'revoked',
        reason: result.reason,
      });
    }
    const v = result.data;
    // Also block if a job already progressed past awaiting_payment for this invite.
    return res.status(200).json({
      valid: true,
      expired: false,
      used: false,
      prefill: {
        name: v.prefillName || '',
        mos: v.prefillMos || '',
        source: v.source || 'TikTok DM',
      },
    });
  } catch (err) {
    console.error('[review-invite-validate] error:', err && err.message);
    return res.status(500).json({ valid: false, reason: 'server_error' });
  }
};
