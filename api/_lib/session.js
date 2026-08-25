const crypto = require('crypto');

const DEFAULT_TTL_SECONDS = 2 * 60 * 60;
const MIN_SECRET_LENGTH = 32;

function getSecret() {
  const secret = process.env.VCB_SESSION_SECRET || '';
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`VCB_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  return secret;
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signPart(encodedPayload, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function tokenTtlSeconds() {
  const raw = Number.parseInt(process.env.VCB_SESSION_TTL_SECONDS || '', 10);
  if (!Number.isFinite(raw) || raw < 300) return DEFAULT_TTL_SECONDS;
  return Math.min(raw, 24 * 60 * 60);
}

function issueSession({ subject, entitlement, entitlementExpiryMs = 0, metadata = {} }) {
  const secret = getSecret();
  const now = Math.floor(Date.now() / 1000);
  const ttlExpiry = now + tokenTtlSeconds();
  const entitlementExpiry = entitlementExpiryMs > 0
    ? Math.floor(entitlementExpiryMs / 1000)
    : ttlExpiry;
  const exp = Math.min(ttlExpiry, entitlementExpiry);

  if (exp <= now) {
    throw new Error('Cannot issue a session for an expired entitlement');
  }

  const payload = {
    v: 1,
    sub: String(subject || 'vcp-user').slice(0, 160),
    entitlement: String(entitlement || 'unknown').slice(0, 40),
    iat: now,
    exp,
    ...metadata,
  };

  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = signPart(encodedPayload, secret);

  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt: exp * 1000,
  };
}

function verifySession(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'missing' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, reason: 'malformed' };
  }

  try {
    const secret = getSecret();
    const [encodedPayload, providedSignature] = parts;
    const expectedSignature = signPart(encodedPayload, secret);

    if (!safeEqual(providedSignature, expectedSignature)) {
      return { valid: false, reason: 'signature' };
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);

    if (payload.v !== 1 || !payload.exp || payload.exp <= now) {
      return { valid: false, reason: 'expired' };
    }

    return { valid: true, payload };
  } catch (error) {
    console.error('[session] Verification failed:', error);
    return { valid: false, reason: 'invalid' };
  }
}

function bearerToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  const legacyHeader = req.headers['x-vcb-session'];
  return typeof legacyHeader === 'string' ? legacyHeader.trim() : '';
}

module.exports = {
  issueSession,
  verifySession,
  bearerToken,
};
