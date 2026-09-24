'use strict';
// Tests for the $1 résumé tool: payment entitlement, webhook replay/idempotency,
// source-backed claims, and report ownership. Run: `npm test` (node --test).
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

// Test secrets must exist before the modules read them.
process.env.VCB_SESSION_SECRET = process.env.VCB_SESSION_SECRET || 'test-secret-test-secret-test-secret-123456';
process.env.STRIPE_WEBHOOK_SECRET_RESUME = process.env.STRIPE_WEBHOOK_SECRET_RESUME || 'whsec_testtesttesttesttesttest';

const { issueSession } = require('../api/_lib/session');
const entitlement = require('../api/resume-entitlement');
const generate = require('../api/resume-generate');
const webhook = require('../api/resume-webhook');

const DRAFT = 'draft_abc12345';

function mockRes() {
  const r = { statusCode: 200, payload: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.payload = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = () => r;
  return r;
}

test('payment entitlement: paid resume-pro checkout mints a scoped token', () => {
  const checkout = { id: 'cs_test_123', mode: 'payment', payment_status: 'paid', created: Math.floor(Date.now() / 1000), metadata: { product: 'resume-pro', draft: DRAFT } };
  const grant = entitlement.grantFromCheckout(checkout, DRAFT);
  assert.equal(grant.active, true);
  assert.ok(grant.token, 'a token is issued');
  assert.equal(grant.draft, DRAFT);
});

test('payment entitlement: unpaid / wrong-product / missing-draft / mismatches are denied', () => {
  const base = { id: 'cs_test_1', mode: 'payment', created: Math.floor(Date.now() / 1000), metadata: { product: 'resume-pro', draft: DRAFT } };
  assert.equal(entitlement.grantFromCheckout({ ...base, payment_status: 'unpaid' }, DRAFT).active, false);
  assert.equal(entitlement.grantFromCheckout({ ...base, payment_status: 'paid', metadata: { product: 'other', draft: DRAFT } }, DRAFT).active, false);
  assert.equal(entitlement.grantFromCheckout({ ...base, payment_status: 'paid' }, 'draft_different').active, false);
  assert.equal(entitlement.grantFromCheckout({ ...base, payment_status: 'paid', metadata: { product: 'resume-pro' } }, DRAFT).active, false);
  assert.equal(entitlement.grantFromCheckout({ ...base, payment_status: 'paid' }, '').active, false);
  assert.equal(entitlement.grantFromCheckout({ ...base, payment_status: 'paid', client_reference_id: 'draft_different' }, DRAFT).active, false);
  assert.equal(entitlement.grantFromCheckout(null, DRAFT).active, false);
});

test('source-backed claims: report is rejected if any bullet lacks a source', () => {
  assert.equal(generate.validateReport({ bullets: [{ text: 'Led a team', source: 'Duty position: squad leader' }] }).ok, true);
  assert.equal(generate.validateReport({ bullets: [{ text: 'Led 500 people' }] }).ok, false);      // no source
  assert.equal(generate.validateReport({ bullets: [{ text: 'x', source: '  ' }] }).ok, false);       // blank source
  assert.equal(generate.validateReport({ bullets: [] }).ok, false);                                   // nothing
  assert.equal(generate.validateReport({}).ok, false);
});

test('report ownership: a token bound to draft A cannot generate draft B', async () => {
  const { token } = issueSession({ subject: 'resume:cs_test_9', entitlement: 'resume-oneshot', entitlementExpiryMs: Date.now() + 3600e3, metadata: { draft: DRAFT, sid: 'cs_test_9' } });
  const req = { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: { draft: 'draft_someoneelse', intake: { branch: 'Army' } } };
  const res = mockRes();
  await generate(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.payload.error, 'report_ownership');
});

test('report ownership: missing token is payment_required; wrong entitlement is rejected', async () => {
  const res1 = mockRes();
  await generate({ method: 'POST', headers: {}, body: { draft: DRAFT, intake: {} } }, res1);
  assert.equal(res1.statusCode, 401);

  const { token } = issueSession({ subject: 'sub_x', entitlement: 'stripe:monthly', entitlementExpiryMs: Date.now() + 3600e3, metadata: {} });
  const res2 = mockRes();
  await generate({ method: 'POST', headers: { authorization: 'Bearer ' + token }, body: { draft: DRAFT, intake: {} } }, res2);
  assert.equal(res2.statusCode, 403);
  assert.equal(res2.payload.error, 'wrong_entitlement');
});

test('webhook: valid signature is accepted; a replayed event id is idempotent', async () => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET_RESUME;
  const evt = JSON.stringify({ id: 'evt_replay_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_5', payment_status: 'paid', metadata: { product: 'resume-pro', draft: DRAFT } } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = 't=' + t + ',v1=' + crypto.createHmac('sha256', secret).update(t + '.' + evt, 'utf8').digest('hex');

  const res1 = mockRes();
  await webhook({ method: 'POST', headers: { 'stripe-signature': sig }, body: evt, on: () => {} }, res1);
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.payload.received, true);
  assert.notEqual(res1.payload.duplicate, true);

  const res2 = mockRes();
  await webhook({ method: 'POST', headers: { 'stripe-signature': sig }, body: evt, on: () => {} }, res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.payload.duplicate, true);   // replay is a no-op
});

test('webhook: a bad signature is rejected', async () => {
  const evt = JSON.stringify({ id: 'evt_bad', type: 'checkout.session.completed', data: { object: {} } });
  const res = mockRes();
  await webhook({ method: 'POST', headers: { 'stripe-signature': 't=1,v1=deadbeef' }, body: evt, on: () => {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error, 'invalid_signature');
});
