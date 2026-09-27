// Admin-only: run an AI-assisted resume-review tool for a job and log the run.
// Route: /api/review-ai   POST { jobId, tool, model? }
// Requires an admin Firebase ID token. Uses the shared Anthropic helper. The API key is
// server-only. Every run is saved to resumeReviewJobs/{jobId}/aiRuns/{runId}. Nothing here
// is ever sent to the client automatically — output loads into the reviewer's editable fields.
// Required env: FIREBASE_SERVICE_ACCOUNT_JSON, ANTHROPIC_API_KEY. Optional: ANTHROPIC_ALLOWED_MODELS.
'use strict';
const { requireAdmin } = require('./_lib/admin-auth');
const { getDb, FieldValue } = require('./_lib/firebase-admin');
const { setCors, normStr, rateLimiter, newId } = require('./_lib/review-common');
const { callAnthropic, extractText, resolveModel, DEFAULT_MODEL } = require('./_lib/anthropic');

const limited = rateLimiter({ windowMs: 60_000, max: 30 });
const PROMPT_VERSION = 'rr-v1';

// These rules are non-negotiable and live server-side so they cannot be edited away by the client.
const SYSTEM = [
  'You are an experienced U.S. military-to-civilian resume reviewer assisting a HUMAN reviewer at Veteran Career Path.',
  'Your output is a DRAFT for the human reviewer to edit. It is never sent to the client automatically.',
  '',
  'ABSOLUTE RULES — NEVER FABRICATE any of the following if not explicitly supplied by the client:',
  'number of people led, dollar values, budgets, readiness rates, percentages, certifications, awards,',
  'security clearances, education/degrees, software/tools experience, licenses, job titles, responsibilities,',
  'deployment history, or years of experience.',
  'If a stronger bullet would benefit from a metric you do not have, insert the literal token',
  '"[CLIENT METRIC NEEDED]" and state exactly what question the reviewer should ask the client.',
  '',
  'Do NOT inflate titles. Do NOT translate a rank into a civilian title the experience does not support',
  '(e.g., "Squad Leader" is NOT automatically "Operations Manager"). Translate demonstrated CAPABILITIES and',
  'OUTCOMES, not ranks. Never imply the veteran performed licensed/regulated civilian work they were not',
  'licensed for (e.g., 12B does not make someone a licensed blaster/surveyor/civil engineer; 11B does not make',
  'someone a law-enforcement officer). Stay grounded strictly in the client-supplied experience and resume text.',
  'Be specific, honest, and useful. Use plain civilian language a hiring manager understands.',
].join('\n');

const TOOLS = {
  full_review: { label: 'Full Resume Review', max: 3000, instr:
`Produce a complete review with these numbered sections, each with a clear heading:
1. Reviewer Summary
2. Strongest Existing Content
3. Biggest Problems
4. Military Language That Needs Translation
5. Before / After Bullet Rewrites (show ORIGINAL: then SUGGESTED: for each)
6. Missing Metrics to Ask Client About (use [CLIENT METRIC NEEDED])
7. Missing Civilian Keywords
8. Skills Already Demonstrated
9. Career Fit Observations
10. Certifications or Credential Gaps
11. Resume Structure / Formatting Advice
12. Questions for the Client
13. Recommended Next Actions` },
  translate: { label: 'Military → Civilian Translation', max: 2000, instr:
`Translate the client's military experience and resume bullets into civilian language a hiring manager understands. Show ORIGINAL then SUGGESTED. Translate capabilities/outcomes, not ranks. Flag anything that needs a metric with [CLIENT METRIC NEEDED].` },
  rewrite_bullets: { label: 'Rewrite Bullets', max: 2500, instr:
`Rewrite the resume's experience bullets. Respond with ONLY a JSON array (no prose, no code fences) of objects: [{"original":"<verbatim original bullet>","suggested":"<improved civilian bullet>"}]. Keep every claim grounded in supplied facts; use [CLIENT METRIC NEEDED] inside "suggested" where a number would strengthen it but is unknown. Include 5-15 items.` },
  summary: { label: 'Professional Summary', max: 1200, instr:
`Write 2-3 professional-summary options (3-4 lines each) for the target role, grounded only in supplied experience. Use [CLIENT METRIC NEEDED] rather than inventing numbers.` },
  ats: { label: 'ATS / Keyword Review', max: 1800, instr:
`Give ATS/keyword feedback for the target role/industry (and job description if provided): missing keywords the client's real experience supports, formatting issues that hurt parsing, and section/heading advice. Do not promise ATS results.` },
  career_fit: { label: 'Career Fit', max: 1800, instr:
`Assess fit for the stated target role/industry based on real experience. Note transferable strengths, gaps, and 2-4 adjacent roles worth considering. No guarantees.` },
  missing_metrics: { label: 'Missing Metrics / Questions', max: 1500, instr:
`List the specific quantifiable metrics and details the reviewer should collect to strengthen this resume. For each, write the exact question to ask the client. Use [CLIENT METRIC NEEDED] framing.` },
  target_job: { label: 'Target This Job', max: 2200, instr:
`Using the provided TARGET JOB DESCRIPTION, tailor advice: which real experience to foreground, which keywords to add (only if supported), and 5-10 tailored ORIGINAL→SUGGESTED bullet rewrites. If no job description was provided, say so and give role-based guidance instead.` },
  cert_gaps: { label: 'Certification / Skill Gaps', max: 1600, instr:
`Identify realistic certifications, licenses, or skills that would strengthen candidacy for the target role, distinguishing "already has (per client)" from "would help". Never claim the client holds a credential they did not state.` },
  draft_feedback: { label: 'Draft Client Feedback', max: 2000, instr:
`Draft a warm, professional client-facing feedback message (first person, from the reviewer) summarizing the top strengths, the priority fixes, and the questions you need answered. This is a DRAFT for the human reviewer to edit before sending.` },
};

function contextBlock(job) {
  const m = job.military || {}, c = job.career || {}, r = job.reviewRequest || {};
  const line = (k, v) => (v ? `${k}: ${v}` : '');
  return [
    'CLIENT-SUPPLIED FACTS (authoritative — do not contradict or exceed):',
    line('Branch', m.branch), line('MOS/Rate/AFSC', m.mos), line('Highest rank/grade', m.rank),
    line('Years of service', m.yearsService), line('Current status', m.serviceStatus),
    line('Security clearance (as stated)', m.clearance),
    line('Certifications (as stated)', m.certifications),
    line('Education (as stated)', m.education),
    line('Additional military experience', m.additionalExperience),
    line('Awards/qualifications to consider', m.awardsQualifications),
    line('Target civilian role', c.primaryTarget), line('Secondary target', c.secondaryTarget),
    line('Target industry', c.industry), line('Target company', c.targetCompany),
    line('Target location / remote', c.targetLocation || c.remotePreference),
    line('What the client wants help with', r.requestedHelp),
    line('Anything the client thinks is missing', r.missingInfo),
    line('Reviewer notes', job.reviewerNotes),
    c.jobDescription ? `\nTARGET JOB DESCRIPTION:\n${c.jobDescription}` : '',
    '\nCLIENT RESUME TEXT (verbatim extraction; may be empty):',
    job.extractedResumeText ? job.extractedResumeText : '(no resume text extracted yet — advise the reviewer to click Extract Resume Text)',
  ].filter(Boolean).join('\n');
}

module.exports = async function handler(req, res) {
  setCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = await requireAdmin(req);
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error });
  if (limited('ai:' + admin.uid)) return res.status(429).json({ error: 'rate_limited' });

  let db;
  try { db = getDb(); } catch (e) { console.error('[review-ai] init:', e.code || e.message); return res.status(500).json({ error: 'configuration_error' }); }

  const jobId = normStr(req.body?.jobId, 64);
  const toolKey = normStr(req.body?.tool, 40);
  if (!/^[a-f0-9]{16,32}$/i.test(jobId)) return res.status(400).json({ error: 'invalid_job' });
  const tool = TOOLS[toolKey];
  if (!tool) return res.status(400).json({ error: 'unknown_tool' });

  const model = resolveModel(req.body?.model) || DEFAULT_MODEL;

  let job;
  try {
    const snap = await db.collection('resumeReviewJobs').doc(jobId).get();
    if (!snap.exists) return res.status(404).json({ error: 'not_found' });
    job = snap.data();
  } catch (e) { console.error('[review-ai] load error:', e.message); return res.status(500).json({ error: 'server_error' }); }

  const runId = newId(10);
  const runRef = db.collection('resumeReviewJobs').doc(jobId).collection('aiRuns').doc(runId);
  const inputSummary = `${tool.label} • target: ${normStr(job.career?.primaryTarget, 80) || 'n/a'} • resumeChars: ${(job.extractedResumeText || '').length}`;

  const userPrompt = `${tool.instr}\n\n${contextBlock(job)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);

  try {
    const data = await callAnthropic({
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
      model,
      maxTokens: tool.max,
      signal: controller.signal,
    });
    const output = extractText(data);

    await runRef.set({
      tool: toolKey,
      promptVersion: PROMPT_VERSION,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: admin.uid,
      inputSummary,
      output,
      model: data.model || model,
      status: 'success',
      error: null,
    });
    return res.status(200).json({ runId, tool: toolKey, label: tool.label, model: data.model || model, output });
  } catch (err) {
    const message = (err && err.message) ? String(err.message).slice(0, 300) : 'ai_error';
    console.error('[review-ai] tool', toolKey, 'failed:', err && (err.status || ''), err && err.type);
    try {
      await runRef.set({
        tool: toolKey, promptVersion: PROMPT_VERSION, createdAt: FieldValue.serverTimestamp(),
        createdBy: admin.uid, inputSummary, output: '', model, status: 'error', error: message,
      });
    } catch (_) { /* logging best-effort */ }
    const code = err && err.name === 'AbortError' ? 504 : (err && err.status) || 502;
    return res.status(code).json({ error: 'ai_failed', runId });
  } finally { clearTimeout(timer); }
};
