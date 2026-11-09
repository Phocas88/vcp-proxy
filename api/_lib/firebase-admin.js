// Firebase Admin SDK bootstrap for the Veteran Career Path backend.
// Initialized once (module singleton) from FIREBASE_SERVICE_ACCOUNT_JSON.
// The service-account JSON is NEVER logged and NEVER committed — it lives only in the
// Vercel environment. Accepts either raw JSON or base64-encoded JSON for convenience.
'use strict';
const admin = require('firebase-admin');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth: firebaseAuth } = require('firebase-admin/auth');

let app = null;

function loadCredentials() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    const e = new Error('FIREBASE_SERVICE_ACCOUNT_JSON not configured');
    e.code = 'configuration_error';
    throw e;
  }
  let text = raw.trim();
  // Support base64-encoded JSON (avoids newline/quoting issues in some env UIs).
  if (!text.startsWith('{')) {
    try { text = Buffer.from(text, 'base64').toString('utf8'); } catch (_) { /* fall through */ }
  }
  let creds;
  try { creds = JSON.parse(text); }
  catch (_) {
    const e = new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON');
    e.code = 'configuration_error';
    throw e;
  }
  // Env stores often escape newlines in the private key.
  if (typeof creds.private_key === 'string' && creds.private_key.includes('\\n')) {
    creds.private_key = creds.private_key.replace(/\\n/g, '\n');
  }
  return creds;
}

function getApp() {
  if (app) return app;
  if (getApps().length) { app = getApps()[0]; return app; }
  const creds = loadCredentials();
  app = initializeApp({
    credential: cert(creds),
    projectId: creds.project_id || 'veteran-career-builder',
  });
  return app;
}

function getDb() { return getFirestore(getApp()); }
function getAuth() { return firebaseAuth(getApp()); }

module.exports = {
  admin,
  getApp,
  getDb,
  getAuth,
  FieldValue,
  Timestamp,
};

