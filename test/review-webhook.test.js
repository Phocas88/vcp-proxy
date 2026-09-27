'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { verifyStripeWebhook } = require('../api/_lib/stripe');

function sign(payload, secret, t) {
  t = t || Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(t + '.' + payload, 'utf8').digest('hex');
  return `t=${t},v1=${sig}`;
}

const SECRET = 'whsec_test_secret';
const PAYLOAD = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { metadata: { product: 'resume-review-service', jobId: 'a'.repeat(24) }, payment_status: 'paid' } } });

test('accepts a correctly signed webhook body', () => {
  assert.equal(verifyStripeWebhook(PAYLOAD, sign(PAYLOAD, SECRET), SECRET), true);
});

test('rejects a tampered body', () => {
  const header = sign(PAYLOAD, SECRET);
  assert.equal(verifyStripeWebhook(PAYLOAD + 'x', header, SECRET), false);
});

test('rejects a wrong secret', () => {
  assert.equal(verifyStripeWebhook(PAYLOAD, sign(PAYLOAD, SECRET), 'whsec_wrong'), false);
});

test('rejects a stale timestamp (replay outside tolerance)', () => {
  const old = Math.floor(Date.now() / 1000) - 10000;
  assert.equal(verifyStripeWebhook(PAYLOAD, sign(PAYLOAD, SECRET, old), SECRET), false);
});

test('rejects a missing/garbage signature header', () => {
  assert.equal(verifyStripeWebhook(PAYLOAD, '', SECRET), false);
  assert.equal(verifyStripeWebhook(PAYLOAD, 'garbage', SECRET), false);
});
