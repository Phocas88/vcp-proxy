const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const claude = require('../api/claude');
const validateCode = require('../api/validate-code');
const verifySubscription = require('../api/verify-subscription');
const { issueSession } = require('../api/_lib/session');

const SECRET = 'test-session-secret-that-is-long-enough-1234567890';
let ipCounter = 0;

function resetEnv() {
  delete process.env.ACCESS_CODES;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_ALLOWED_MODELS;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.VCB_SESSION_SECRET;
  delete process.env.VCB_SESSION_TTL_SECONDS;
}

function mockReq({ method = 'POST', headers = {}, body = {} } = {}) {
  ipCounter += 1;
  return {
    method,
    headers: {
      'x-forwarded-for': `203.0.113.${ipCounter}`,
      ...headers,
    },
    body,
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
    end(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
  };
  return res;
}

async function invoke(handler, options) {
  const req = mockReq(options);
  const res = mockRes();
  await handler(req, res);
  return res;
}

function signPayload(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', SECRET).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

test('claude requires a valid signed session and ignores client-supplied identity headers', async () => {
  resetEnv();
  process.env.VCB_SESSION_SECRET = SECRET;
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

  for (const headers of [
    {},
    { 'x-vcb-email': 'paid@example.com' },
    { 'x-vcb-code': 'VALIDCODE' },
    { 'x-vcb-session': 'not-a-real-session' },
  ]) {
    const res = await invoke(claude, {
      headers,
      body: { messages: [{ role: 'user', content: 'hello' }] },
    });
    assert.equal(res.statusCode, 401);
  }
});

test('claude rejects tampered and expired signed sessions', async () => {
  resetEnv();
  process.env.VCB_SESSION_SECRET = SECRET;
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

  const session = issueSession({ subject: 'code:VALID', entitlement: 'access-code' });
  const tampered = `${session.token.slice(0, -1)}x`;
  const expired = signPayload({
    v: 1,
    sub: 'code:OLD',
    entitlement: 'access-code',
    iat: Math.floor(Date.now() / 1000) - 600,
    exp: Math.floor(Date.now() / 1000) - 60,
  });

  for (const token of [tampered, expired]) {
    const res = await invoke(claude, {
      headers: { authorization: `Bearer ${token}` },
      body: { messages: [{ role: 'user', content: 'hello' }] },
    });
    assert.equal(res.statusCode, 401);
  }
});

test('claude fails closed for missing config, oversized bodies, and unsupported models', async () => {
  resetEnv();
  process.env.VCB_SESSION_SECRET = SECRET;
  const session = issueSession({ subject: 'code:VALID', entitlement: 'access-code' });

  let res = await invoke(claude, {
    headers: { authorization: `Bearer ${session.token}` },
    body: { messages: [{ role: 'user', content: 'hello' }] },
  });
  assert.equal(res.statusCode, 500);
  assert.match(res.body.error, /not configured/i);

  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

  res = await invoke(claude, {
    headers: { authorization: `Bearer ${session.token}` },
    body: {
      model: 'claude-not-allowed',
      messages: [{ role: 'user', content: 'hello' }],
    },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /not allowed/i);

  res = await invoke(claude, {
    headers: { authorization: `Bearer ${session.token}` },
    body: { messages: [{ role: 'user', content: 'x'.repeat(90 * 1024) }] },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /too large/i);
});

test('validate-code rejects invalid codes and issues sessions only for server configured codes', async () => {
  resetEnv();
  process.env.ACCESS_CODES = JSON.stringify({ VALIDCODE: 0 });

  let res = await invoke(validateCode, { body: { code: 'VALIDCODE' } });
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.reason, 'configuration_error');

  process.env.VCB_SESSION_SECRET = SECRET;

  res = await invoke(validateCode, { body: { code: 'BADCODE' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.valid, false);

  res = await invoke(validateCode, { body: { code: 'validcode' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.valid, true);
  assert.equal(typeof res.body.token, 'string');
});

test('verify-subscription fails closed without Stripe config and rejects malformed identifiers', async () => {
  resetEnv();
  process.env.VCB_SESSION_SECRET = SECRET;

  let res = await invoke(verifySubscription, { body: { sessionId: 'cs_test_valid' } });
  assert.equal(res.statusCode, 500);

  process.env.STRIPE_SECRET_KEY = 'sk_test_proxy';

  res = await invoke(verifySubscription, { body: { sessionId: 'fake_session' } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.active, false);
});

test('verify-subscription supports checkout, subscription, and charge identifiers', async () => {
  resetEnv();
  process.env.VCB_SESSION_SECRET = SECRET;
  process.env.STRIPE_SECRET_KEY = 'sk_test_proxy';

  const now = Math.floor(Date.now() / 1000);
  const originalFetch = global.fetch;
  global.fetch = async url => {
    const value = String(url);
    if (value.includes('/v1/checkout/sessions/cs_test_valid')) {
      return {
        ok: true,
        json: async () => ({
          id: 'cs_test_valid',
          status: 'complete',
          payment_status: 'paid',
          created: now,
        }),
      };
    }
    if (value.includes('/v1/subscriptions/sub_valid')) {
      return {
        ok: true,
        json: async () => ({
          id: 'sub_valid',
          status: 'active',
          current_period_end: now + 3600,
          items: { data: [{ price: { recurring: { interval: 'monthly' } } }] },
        }),
      };
    }
    if (value.includes('/v1/charges/ch_valid')) {
      return {
        ok: true,
        json: async () => ({
          id: 'ch_valid',
          paid: true,
          refunded: false,
          amount: 1500,
          created: now,
        }),
      };
    }
    if (value.includes('/v1/checkout/sessions/cs_test_invalid')) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: { message: 'No such checkout session' } }),
      };
    }
    throw new Error(`Unexpected Stripe URL: ${value}`);
  };

  try {
    for (const sessionId of ['cs_test_valid', 'sub_valid', 'ch_valid']) {
      const res = await invoke(verifySubscription, { body: { sessionId } });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.active, true);
      assert.equal(res.body.sessionId, sessionId);
      assert.equal(typeof res.body.token, 'string');
    }

    const invalid = await invoke(verifySubscription, { body: { sessionId: 'cs_test_invalid' } });
    assert.equal(invalid.statusCode, 200);
    assert.equal(invalid.body.active, false);
  } finally {
    global.fetch = originalFetch;
  }
});
