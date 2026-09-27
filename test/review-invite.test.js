'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  newRawToken, hashToken, isRawTokenShape, loadInviteByToken, normStr,
} = require('../api/_lib/review-common');

function stubDb(doc) {
  return { collection: () => ({ doc: () => ({ get: async () => doc }) }) };
}
function docSnap(exists, data) { return { exists, data: () => data }; }
function future() { return { toMillis: () => Date.now() + 3600_000 }; }
function past() { return { toMillis: () => Date.now() - 3600_000 }; }

test('invite tokens: 32 random bytes (64 hex), stable SHA-256 hash, shape check', () => {
  const raw = newRawToken();
  assert.match(raw, /^[a-f0-9]{64}$/);
  assert.ok(isRawTokenShape(raw));
  assert.ok(!isRawTokenShape('short'));
  assert.equal(hashToken(raw), hashToken(raw));
  assert.equal(hashToken('abc').length, 64);
  assert.notEqual(hashToken(raw), raw); // hash is not the raw token
});

test('loadInviteByToken classifies invites', async () => {
  const raw = newRawToken();
  assert.equal((await loadInviteByToken(stubDb(docSnap(false)), raw)).reason, 'not_found');
  assert.equal((await loadInviteByToken(stubDb(), 'not-a-token')).reason, 'invalid');
  assert.equal((await loadInviteByToken(stubDb(docSnap(true, { status: 'revoked', expiresAt: future() })), raw)).reason, 'revoked');
  assert.equal((await loadInviteByToken(stubDb(docSnap(true, { status: 'used', expiresAt: future() })), raw)).reason, 'used');
  assert.equal((await loadInviteByToken(stubDb(docSnap(true, { status: 'active', expiresAt: past() })), raw)).reason, 'expired');
  const ok = await loadInviteByToken(stubDb(docSnap(true, { status: 'active', expiresAt: future(), prefillName: 'Jeremy' })), raw);
  assert.equal(ok.ok, true);
  assert.equal(ok.data.prefillName, 'Jeremy');
});

test('normStr trims, strips control chars, clamps length', () => {
  assert.equal(normStr('  hi  '), 'hi');
  assert.equal(normStr('abcdef', 3), 'abc');
  assert.equal(normStr(null), '');
});
