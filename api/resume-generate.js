// Veteran Career Path - AI generation for the paid $1 résumé & career tool.
// Route: /api/resume-generate   (POST { draft, intake }, Authorization: Bearer <resume-oneshot token>)
// Accepts ONLY a resume-oneshot token minted by /api/resume-entitlement after a verified $1 payment,
// bound to the same draft. This is a dedicated path — it never uses /api/claude or the subscription.
// Required env vars: ANTHROPIC_API_KEY, VCB_SESSION_SECRET
// Optional env vars: RESUME_MODEL (default claude-haiku-4-5-20251001)
const { verifySession, bearerToken } = require('./_lib/session');

const rateLimit = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 12; // report + reasonable edits/regenerations per minute
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 4000;
const MAX_INTAKE_BYTES = 60 * 1024;

function setCors(req, res) {
  const allowed = new Set(['https://veterancareerpath.com', 'https://www.veterancareerpath.com']);
  const origin = req.headers.origin;
  if (allowed.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
}
function isRateLimited(key) {
  const now = Date.now(); const e = rateLimit.get(key);
  if (!e || now - e.windowStart > RATE_WINDOW_MS) { rateLimit.set(key, { windowStart: now, count: 1 }); return false; }
  e.count += 1; return e.count > RATE_MAX_REQUESTS;
}

const SYSTEM = [
  'You are a military-to-civilian résumé and career expert helping a U.S. veteran build a truthful,',
  'ATS-friendly résumé and career report. You ONLY use facts the user confirmed in their intake.',
  'HARD RULES:',
  '- Never invent metrics, numbers supervised, budgets, certifications, awards, clearances, employers,',
  '  dates, or duties. If a useful number is missing, write a clearly bracketed placeholder like',
  '  "[add number]" for the user to fill in — never a fabricated figure.',
  '- Rank/MOS may inform phrasing but is NOT proof the person did something. Only use confirmed inputs.',
  '- Translate military jargon and acronyms into plain civilian language; do not leave unexplained codes.',
  '- Do not promise eligibility, employment, salary, or that a clearance transfers.',
  '- For every résumé bullet, include a "source" naming the exact confirmed input it is grounded in.',
  '- For each career recommendation, separate REQUIRED licenses/degrees from PREFERRED and OPTIONAL',
  '  certifications, and mark whether the user could pursue it now or needs more education/training.',
  'Return ONLY valid minified JSON (no markdown, no prose) matching this shape:',
  '{"summary":"","titles":[""],"skills":[""],"bullets":[{"text":"","source":""}],',
  '"careers":[{"title":"","match":"","transfers":"","readiness":"now|with-training","requirements":',
  '{"required":[""],"preferred":[""],"optional":[""]},"gap":"","links":[{"label":"","url":""}]}],',
  '"notes":""}',
].join('\n');

function buildUserPrompt(intake) {
  const target = intake.target && intake.target.trim();
  const lines = [];
  lines.push('CONFIRMED VETERAN INTAKE (use only this; blanks mean not provided):');
  lines.push(JSON.stringify(intake).slice(0, MAX_INTAKE_BYTES));
  lines.push('');
  if (target) lines.push('TARGET ROLE / JOB POSTING: ' + target);
  else lines.push('The user is UNSURE what to target — include a "career discovery" set in "careers" with several honest options their confirmed experience supports.');
  lines.push('');
  lines.push('Produce: a professional summary; civilian-friendly job titles; transferable skills; 6-10');
  lines.push('editable résumé bullets each grounded in a confirmed input (with its "source"); and career');
  lines.push('recommendations (include less-obvious ones the confirmed experience supports) with match,');
  lines.push('what transfers, entry requirements split into required/preferred/optional, readiness, the');
  lines.push('remaining gap, and real links to occupation/credential sources (e.g. onetonline.org,');
  lines.push('bls.gov/ooh, apprenticeship.gov, the relevant state licensing board).');
  return lines.join('\n');
}

// Exported for tests: every bullet must cite a source; nothing fabricated-looking slips through unmarked.
function validateReport(report) {
  if (!report || typeof report !== 'object') return { ok: false, reason: 'not_object' };
  if (!Array.isArray(report.bullets) || !report.bullets.length) return { ok: false, reason: 'no_bullets' };
  for (const b of report.bullets) {
    if (!b || typeof b.text !== 'string' || !b.text.trim()) return { ok: false, reason: 'empty_bullet' };
    if (typeof b.source !== 'string' || !b.source.trim()) return { ok: false, reason: 'unsourced_bullet' };
  }
  return { ok: true };
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const check = verifySession(bearerToken(req));
  if (!check.valid) return res.status(401).json({ error: 'payment_required', detail: 'A valid paid résumé session is required.' });
  if (check.payload.entitlement !== 'resume-oneshot') return res.status(403).json({ error: 'wrong_entitlement' });

  const draft = String(req.body?.draft || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (!draft || check.payload.draft !== draft) return res.status(403).json({ error: 'report_ownership', detail: 'This paid session is bound to a different report.' });

  const rateKey = check.payload.sub + ':' + (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown');
  if (isRateLimited(rateKey)) return res.status(429).json({ error: 'rate_limited' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.error('[resume-generate] ANTHROPIC_API_KEY not configured'); return res.status(500).json({ error: 'configuration_error' }); }

  const intake = req.body?.intake;
  if (!intake || typeof intake !== 'object') return res.status(400).json({ error: 'invalid_intake' });
  if (Buffer.byteLength(JSON.stringify(intake), 'utf8') > MAX_INTAKE_BYTES) return res.status(400).json({ error: 'intake_too_large' });

  const model = process.env.RESUME_MODEL || DEFAULT_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: MAX_TOKENS, system: SYSTEM,
        messages: [{ role: 'user', content: buildUserPrompt(intake) }],
      }),
      signal: controller.signal,
    });
    const data = await upstream.json();
    if (!upstream.ok) { console.error('[resume-generate] anthropic error', upstream.status, data?.error?.type); return res.status(502).json({ error: 'ai_error' }); }
    const text = Array.isArray(data.content) ? data.content.map(b => b?.text || '').join('') : '';
    let report;
    try { report = JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim()); }
    catch (_) { return res.status(502).json({ error: 'ai_bad_format' }); }
    const v = validateReport(report);
    if (!v.ok) return res.status(502).json({ error: 'ai_unsourced', detail: v.reason });
    return res.status(200).json({ report });
  } catch (err) {
    console.error('[resume-generate] failed', err && err.message);
    return res.status(err?.name === 'AbortError' ? 504 : 500).json({ error: 'generation_failed' });
  } finally { clearTimeout(timer); }
};

module.exports.validateReport = validateReport;
module.exports.buildUserPrompt = buildUserPrompt;
