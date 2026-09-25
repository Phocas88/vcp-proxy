'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { verifyPurchase, DOWNLOAD_TTL_MS } = require('../api/store-download.js');
const { getProduct, SKU_REGEX } = require('../api/_lib/store-catalog.js');

const SKU = 'infantry-11-series';
function paidSession(overrides = {}) {
  return {
    mode: 'payment',
    payment_status: 'paid',
    metadata: { product: 'book', sku: SKU },
    created: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

test('store catalog exposes a well-formed product with a positive price', () => {
  const p = getProduct(SKU);
  assert.ok(p, 'product exists');
  assert.equal(typeof p.name, 'string');
  assert.ok(p.priceCents > 0);
  assert.ok(p.blobKey && p.fileName);
  assert.equal(getProduct('does-not-exist'), null);
  assert.equal(getProduct(undefined), null);
  assert.ok(SKU_REGEX.test(SKU));
  assert.ok(!SKU_REGEX.test('Bad SKU!'));
});

test('verifyPurchase grants only a paid, matching, in-window book session', () => {
  assert.deepEqual(verifyPurchase(paidSession(), SKU), { ok: true });

  // Fails closed on every tampered dimension.
  assert.equal(verifyPurchase(null, SKU).ok, false);
  assert.equal(verifyPurchase(paidSession({ payment_status: 'unpaid' }), SKU).reason, 'unpaid');
  assert.equal(verifyPurchase(paidSession({ mode: 'subscription' }), SKU).reason, 'wrong_mode');
  assert.equal(verifyPurchase(paidSession({ metadata: { product: 'resume-pro', sku: SKU } }), SKU).reason, 'wrong_product');
  assert.equal(verifyPurchase(paidSession(), 'some-other-sku').reason, 'sku_mismatch');

  // Expired outside the download window.
  const old = Math.floor((Date.now() - DOWNLOAD_TTL_MS - 1000) / 1000);
  assert.equal(verifyPurchase(paidSession({ created: old }), SKU).reason, 'expired');
});
