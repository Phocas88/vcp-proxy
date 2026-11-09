'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { v4: uuidv4, v5: uuidv5 } = require('uuid');
const bootstrap = require('../api/_lib/firebase-admin');

test('the installed Firebase SDK loads without credentials and exposes supported Firestore helpers', () => {
  assert.equal(typeof bootstrap.FieldValue.increment, 'function');
  assert.equal(bootstrap.Timestamp.fromMillis(1234).toMillis(), 1234);
});

test('the patched UUID dependency preserves CommonJS identifiers and rejects undersized buffers', () => {
  assert.match(uuidv4(), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.throws(() => uuidv5('fictional-cache-key', uuidv5.URL, Buffer.alloc(1)), RangeError);
});

test('existing Firebase applications are reused by the auth and database bootstrap without a network request', async () => {
  const app = initializeApp({ projectId: 'qa-sdk-bootstrap' });
  try {
    assert.equal(bootstrap.getApp(), app);
    assert.equal(bootstrap.getAuth().app, app);
    assert.equal(bootstrap.getDb().projectId, 'qa-sdk-bootstrap');
    assert.equal(bootstrap.getDb(), bootstrap.getDb());
  } finally {
    await deleteApp(app);
  }
});
