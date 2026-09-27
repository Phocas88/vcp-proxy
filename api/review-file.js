// Admin-only: stream a private resume file for preview/download.
// Route: /api/review-file?jobId=...&fileId=...&mode=preview|download
// Verifies admin, verifies the file belongs to the job, then reads the PRIVATE blob
// server-side and streams the bytes. The permanent blob URL is never exposed to the browser.
// Required env: FIREBASE_SERVICE_ACCOUNT_JSON, BLOB_REVIEW_RW_TOKEN (or BLOB_READ_WRITE_TOKEN)
'use strict';
const { get } = require('@vercel/blob');
const { requireAdmin } = require('./_lib/admin-auth');
const { getDb } = require('./_lib/firebase-admin');
const { setCors, normStr } = require('./_lib/review-common');

function blobToken() { return process.env.BLOB_REVIEW_RW_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || ''; }

module.exports = async function handler(req, res) {
  setCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = await requireAdmin(req);
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error });

  const token = blobToken();
  if (!token) { console.error('[review-file] blob token not configured'); return res.status(500).json({ error: 'configuration_error' }); }

  let db;
  try { db = getDb(); } catch (e) { console.error('[review-file] init:', e.code || e.message); return res.status(500).json({ error: 'configuration_error' }); }

  const jobId = normStr(req.query?.jobId, 64);
  const fileId = normStr(req.query?.fileId, 32);
  const mode = normStr(req.query?.mode, 12) === 'download' ? 'download' : 'preview';
  if (!/^[a-f0-9]{16,32}$/i.test(jobId) || !fileId) return res.status(400).json({ error: 'invalid_request' });

  try {
    const snap = await db.collection('resumeReviewJobs').doc(jobId).get();
    if (!snap.exists) return res.status(404).json({ error: 'not_found' });
    const file = (snap.data().files || []).find((f) => f.fileId === fileId);
    if (!file || !file.url) return res.status(404).json({ error: 'file_not_found' });

    const blob = await get(file.url, { token });
    if (!blob || blob.statusCode !== 200) return res.status(404).json({ error: 'blob_not_found' });

    const buf = Buffer.from(await new Response(blob.stream).arrayBuffer());
    const disp = mode === 'download' ? 'attachment' : 'inline';
    // ASCII-safe filename in the header; keep a UTF-8 variant per RFC 5987.
    const asciiName = (file.filename || 'resume').replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
    res.statusCode = 200;
    res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Content-Disposition', `${disp}; filename="${asciiName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.end(buf);
  } catch (err) {
    console.error('[review-file] error:', err && err.message);
    return res.status(502).json({ error: 'file_error' });
  }
};
