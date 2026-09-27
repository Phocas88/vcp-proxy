'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const checkout = require('../api/_lib/review/checkout.js');

test('priceCents defaults to 999 and honors REVIEW_PRICE_CENTS', () => {
  delete process.env.REVIEW_PRICE_CENTS;
  assert.equal(checkout.priceCents(), 999);
  process.env.REVIEW_PRICE_CENTS = '1499';
  assert.equal(checkout.priceCents(), 1499);
  process.env.REVIEW_PRICE_CENTS = '10'; // below floor
  assert.equal(checkout.priceCents(), 50);
  delete process.env.REVIEW_PRICE_CENTS;
});

test('jobId shape validation', () => {
  assert.equal(checkout.isValidJobId('a'.repeat(24)), true);
  assert.equal(checkout.isValidJobId('deadBEEF'.repeat(2)), true);
  assert.equal(checkout.isValidJobId('short'), false);
  assert.equal(checkout.isValidJobId('nothex-zzzz-....'), false);
  assert.equal(checkout.isValidJobId(''), false);
});
