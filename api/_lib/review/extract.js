// Admin-only: extract plain text from a job's uploaded resume (PDF / DOCX / TXT).
// Route: /api/review-extract   POST { jobId, fileId }
// Reads the private blob server-side, extracts text with established libraries (no macro/code
// execution), sanitizes it, and stores it in the job's extractedResumeText. The original file
// is never modified.
// Required env: FIREBASE_SERVICE_ACCOUNT_JSON, BLOB_REVIEW_RW_TOKEN (or BLOB_READ_WRITE_TOKEN)
'use strict';
const { get } = require('@vercel/blob');
const { requireAdmin } = require('../admin-auth');
const { getDb, FieldValue } = require('../firebase-admin');
const { setCors, normStr, rateLimiter } = require('../review-common');

const limited = rateLimiter({ windowMs: 60_000, max: 20 });
const MAX_TEXT = 60000;
function blobToken() { return process.env.BLOB_REVIEW_RW_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || ''; }

function sanitizeText(s) {
  return String(s || '')
    .replace(/\r\n/g, '\n')
    .replace(/[^\S\n\t]+/g, ' ')          // collapse runs of spaces
    .replace(/[ --]/g, '')       // strip control chars (keep \n \t)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT);
}

async function extract(kind, buf) {
  if (kind === 'txt') return buf.toString('utf8');
  if (kind === 'pdf') {
    const pdfParse = require('pdf-parse');
    const out = await pdfParse(buf);
    return out.text || '';
  }
  if (kind === 'docx') {
    const mammoth = require('mammoth');
    const out = await mammoth.extractRawText({ buffer: buf });
    return out.value || '';
  }
  return '';
}

module.exports = async function handler(req, res) {
  setCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = await requireAdmin(req);
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error });
  if (limited('ext:' + admin.uid)) return res.status(429).json({ error: 'rate_limited' });

  const token = blobToken();
  if (!token) return res.status(500).json({ error: 'configuration_error' });

  let db;
  try { db = getDb(); } catch (e) { console.error('[review-extract] init:', e.code || e.message); return res.status(500).json({ error: 'configuration_error' }); }

  const jobId = normStr(req.body?.jobId, 64);
  const fileId = normStr(req.body?.fileId, 32);
  if (!/^[a-f0-9]{16,32}$/i.test(jobId) || !fileId) return res.status(400).json({ error: 'invalid_request' });

  try {
    const ref = db.collection('resumeReviewJobs').doc(jobId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'not_found' });
    const file = (snap.data().files || []).find((f) => f.fileId === fileId);
    if (!file || !file.url) return res.status(404).json({ error: 'file_not_found' });

    const blob = await get(file.url, { token });
    if (!blob || blob.statusCode !== 200) return res.status(404).json({ error: 'blob_not_found' });
    const buf = Buffer.from(await new Response(blob.stream).arrayBuffer());

    let text;
    try { text = sanitizeText(await extract(file.kind, buf)); }
    catch (e) { console.error('[review-extract] parse failed', file.kind); return res.status(422).json({ error: 'extract_failed' }); }

    await ref.update({ extractedResumeText: text, extractedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return res.status(200).json({ ok: true, chars: text.length, text });
  } catch (err) {
    console.error('[review-extract] error:', err && err.message);
    return res.status(500).json({ error: 'server_error' });
  }
};
