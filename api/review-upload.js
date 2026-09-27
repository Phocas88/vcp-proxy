// Public (invite-gated): accept ONE resume file and store it in PRIVATE Vercel Blob.
// Route: /api/review-upload?token=RAW&filename=NAME   (POST, raw binary body = the file bytes)
// The browser posts the file bytes directly (Content-Type = the file type). We validate the
// invite, size, extension, declared MIME, AND magic bytes, then store under a random private
// path. The blob URL is written to a server-only pending record and NEVER returned to the
// browser. review-submit later attaches the pending upload to the created job.
// Required env: FIREBASE_SERVICE_ACCOUNT_JSON, BLOB_REVIEW_RW_TOKEN (or BLOB_READ_WRITE_TOKEN)
'use strict';
const { put } = require('@vercel/blob');
const { getDb, FieldValue } = require('./_lib/firebase-admin');
const {
  setCors, normStr, clientIp, rateLimiter, loadInviteByToken,
  ALLOWED_UPLOAD, MAX_FILE_BYTES, newId,
} = require('./_lib/review-common');

const limited = rateLimiter({ windowMs: 60_000, max: 10 });

function blobToken() { return process.env.BLOB_REVIEW_RW_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || ''; }

function safeName(name) {
  const base = String(name || 'resume').split(/[\\/]/).pop();
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_').replace(/^\.+/, '').slice(0, 120);
  return cleaned || 'resume';
}
function extOf(name) { const m = /\.([A-Za-z0-9]+)$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; }

function classify(ext, declaredMime, buf) {
  const spec = ALLOWED_UPLOAD[ext];
  if (!spec) return { ok: false, reason: 'bad_extension' };
  const head = buf.subarray(0, 8);
  if (ext === 'pdf') {
    if (!(head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46)) return { ok: false, reason: 'not_pdf' };
  } else if (ext === 'docx') {
    // DOCX is a ZIP container: "PK\x03\x04"
    if (!(head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07))) return { ok: false, reason: 'not_docx' };
  } else if (ext === 'txt') {
    // Reject obvious binary in a .txt (NUL byte in the first block).
    if (buf.subarray(0, 1024).includes(0x00)) return { ok: false, reason: 'not_text' };
  }
  const mime = (declaredMime || '').split(';')[0].trim().toLowerCase();
  // Declared MIME is a soft check (browsers vary for docx); magic bytes above are authoritative.
  const contentType = spec.mimes.includes(mime) ? mime : spec.mimes[0];
  return { ok: true, kind: ext, contentType };
}

async function readBody(req, cap) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > cap) { reject(new Error('too_large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  setCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (limited('up:' + clientIp(req))) return res.status(429).json({ error: 'rate_limited' });

  const token = blobToken();
  if (!token) { console.error('[review-upload] blob token not configured'); return res.status(500).json({ error: 'configuration_error' }); }

  let db;
  try { db = getDb(); } catch (e) { console.error('[review-upload] init:', e.code || e.message); return res.status(500).json({ error: 'configuration_error' }); }

  const rawToken = normStr(req.query?.token, 128);
  const invite = await loadInviteByToken(db, rawToken);
  if (!invite.ok) return res.status(403).json({ error: 'invalid_invite', reason: invite.reason });

  let buf;
  try { buf = await readBody(req, MAX_FILE_BYTES + 1024); }
  catch (e) { return res.status(413).json({ error: 'file_too_large' }); }
  if (!buf || buf.length === 0) return res.status(400).json({ error: 'empty_file' });
  if (buf.length > MAX_FILE_BYTES) return res.status(413).json({ error: 'file_too_large' });

  const filename = safeName(req.query?.filename);
  const ext = extOf(filename);
  const check = classify(ext, req.headers['content-type'], buf);
  if (!check.ok) return res.status(400).json({ error: 'invalid_file', reason: check.reason });

  const fileId = newId(10);
  const pathname = `resume-reviews/pending/${invite.inviteHash}/${fileId}/${filename}`;

  try {
    const blob = await put(pathname, buf, {
      access: 'private',
      addRandomSuffix: false,
      contentType: check.contentType,
      token,
    });
    await db.collection('resumeReviewUploads').doc(fileId).set({
      inviteHash: invite.inviteHash,
      url: blob.url,
      downloadUrl: blob.downloadUrl || blob.url,
      pathname,
      filename,
      size: buf.length,
      contentType: check.contentType,
      kind: check.kind,
      consumed: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    // Return only safe, client-displayable metadata (no blob URL).
    return res.status(200).json({ fileId, filename, size: buf.length, kind: check.kind, contentType: check.contentType });
  } catch (err) {
    console.error('[review-upload] store error:', err && err.message);
    return res.status(502).json({ error: 'upload_failed' });
  }
};

// Raw body needed for the binary upload. Set AFTER the handler so it is not clobbered.
module.exports.config = { api: { bodyParser: false } };
// Exposed for unit tests.
module.exports.classify = classify;
module.exports.safeName = safeName;
module.exports.extOf = extOf;
