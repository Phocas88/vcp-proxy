// Firebase Admin SDK bootstrap for the Veteran Career Path backend.
// Initialized once (module singleton) from FIREBASE_SERVICE_ACCOUNT_JSON.
// The service-account JSON is NEVER logged and NEVER committed — it lives only in the
// Vercel environment. Accepts either raw JSON or base64-encoded JSON for convenience.
'use strict';
const admin = require('firebase-admin');

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
  if (admin.apps.length) { app = admin.apps[0]; return app; }
  const creds = loadCredentials();
  app = admin.initializeApp({
    credential: admin.credential.cert(creds),
    projectId: creds.project_id || 'veteran-career-builder',
  });
  return app;
}

function getDb() { getApp(); return admin.firestore(); }
function getAuth() { getApp(); return admin.auth(); }

module.exports = {
  admin,
  getApp,
  getDb,
  getAuth,
  FieldValue: admin.firestore.FieldValue,
  Timestamp: admin.firestore.Timestamp,
};
