'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { requireAdmin } = require('../api/_lib/admin-auth');

function req(headers) { return { headers: headers || {} }; }

test('rejects a missing Authorization header (401 missing_token)', async () => {
  const r = await requireAdmin(req({}));
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
  assert.equal(r.error, 'missing_token');
});

test('rejects an invalid/unverifiable token (401 invalid_token)', async () => {
  const verify = async () => { throw new Error('bad token'); };
  const r = await requireAdmin(req({ authorization: 'Bearer abc.def.ghi' }), verify);
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
  assert.equal(r.error, 'invalid_token');
});

test('rejects an expired token (401 expired_token)', async () => {
  const verify = async () => { const e = new Error('expired'); e.code = 'auth/id-token-expired'; throw e; };
  const r = await requireAdmin(req({ authorization: 'Bearer x' }), verify);
  assert.equal(r.status, 401);
  assert.equal(r.error, 'expired_token');
});

test('rejects a valid NON-admin token (403 not_admin)', async () => {
  const verify = async () => ({ uid: 'u1', admin: false, email: 'user@example.com' });
  const r = await requireAdmin(req({ authorization: 'Bearer x' }), verify);
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.equal(r.error, 'not_admin');
});

test('accepts a valid admin token', async () => {
  const verify = async () => ({ uid: 'admin1', admin: true, email: 'admin@example.com' });
  const r = await requireAdmin(req({ authorization: 'Bearer x' }), verify);
  assert.equal(r.ok, true);
  assert.equal(r.uid, 'admin1');
});
