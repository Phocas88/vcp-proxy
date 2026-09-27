// Server-side admin authorization for Veteran Career Path resume-review endpoints.
// Verifies a Firebase ID token (Authorization: Bearer <token>) with the Admin SDK and
// requires the custom claim admin === true. The client-side admin PIN is NOT an
// authorization boundary — this is. Returns { ok, status, error } or { ok, uid, email, token }.
'use strict';
const { getAuth } = require('./firebase-admin');

function bearer(req) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return '';
}

// verifyFn is injectable for tests; defaults to the real Firebase Admin verifier.
async function requireAdmin(req, verifyFn) {
  const idToken = bearer(req);
  if (!idToken) return { ok: false, status: 401, error: 'missing_token' };

  const verify = verifyFn || ((t) => getAuth().verifyIdToken(t, true)); // checkRevoked
  let decoded;
  try {
    decoded = await verify(idToken);
  } catch (err) {
    // Do not leak token internals; distinguish expired vs invalid only coarsely.
    const code = err && err.code === 'auth/id-token-expired' ? 'expired_token' : 'invalid_token';
    return { ok: false, status: 401, error: code };
  }

  if (decoded.admin !== true) {
    return { ok: false, status: 403, error: 'not_admin' };
  }
  return { ok: true, uid: decoded.uid, email: decoded.email || null, token: decoded };
}

module.exports = { requireAdmin, bearer };
