'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { mkdtemp, writeFile, access } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { rimraf } = require('rimraf');
const bootstrap = require('../api/_lib/firebase-admin');

test('the installed Firebase SDK loads without credentials and exposes supported Firestore helpers', () => {
  assert.equal(typeof bootstrap.FieldValue.increment, 'function');
  assert.equal(bootstrap.Timestamp.fromMillis(1234).toMillis(), 1234);
});

test('the patched cleanup dependency retains the async API used by Google clients', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vcp-sdk-cleanup-'));
  try {
    await writeFile(join(directory, 'example-cache.txt'), 'fictional cache entry');
    await rimraf(directory);
    await assert.rejects(access(directory), { code: 'ENOENT' });
  } finally {
    await rimraf(directory);
  }
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
