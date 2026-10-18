'use strict';
// Additional authenticated mode of /api/claude. Uses the existing function so
// the project does not consume another Vercel Hobby function slot.
const allowedOrigins = new Set(['https://veterancareerpath.com', 'https://www.veterancareerpath.com']);

async function consumeQuota(db, uid, now = Date.now()) {
  const ref = db.collection('_privateWorkspaceLimits').doc(uid);
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref); const previous = snap.exists ? snap.data() : {};
    const reset = Number(previous.reset) > now ? Number(previous.reset) : now + 15 * 60 * 1000;
    const count = Number(previous.reset) > now ? Number(previous.count) || 0 : 0;
    if (count >= 10) return false;
    tx.set(ref, { count: count + 1, reset }); return true;
  });
}

function createWorkspaceHandler(deps = {}) {
  return async function workspace(req, res) {
    if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) return res.status(403).json({ error: 'Open Veteran Career Path to request a review.' });
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return res.status(415).json({ error: 'Send resume text as JSON.' });
    if (Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8') > 150000) return res.status(413).json({ error: 'That draft is too large.' });
    if (req.body?.consent !== true) return res.status(400).json({ error: 'Agree to AI processing before requesting a review.' });
    const { bearerToken, verifySession } = deps.sessions || require('./session');
    if (!verifySession(bearerToken(req)).valid) return res.status(401).json({ error: 'A valid subscription or access code is required. Open My Account on Veteran Career Path to restore AI access.' });
    const idToken = req.headers['x-vcp-firebase-token'];
    if (typeof idToken !== 'string' || !idToken) return res.status(401).json({ error: 'Sign in to your Veteran Career Path account.' });
    let identity;
    try { identity = await (deps.verifyIdToken || (token => require('./firebase-admin').getAuth().verifyIdToken(token, true)))(idToken); }
    catch { return res.status(401).json({ error: 'Your account session expired. Sign in again.' }); }
    if (!identity?.uid) return res.status(401).json({ error: 'Sign in to your Veteran Career Path account.' });
    let input, reviewModule;
    try { reviewModule = await import('./resume-workspace/review.mjs'); input = reviewModule.validateInput(req.body.input); }
    catch (error) { return res.status(error.status || 400).json({ error: error.status ? error.message : 'Check your resume and application details.' }); }
    try {
      const allowed = await (deps.quota || (uid => consumeQuota(require('./firebase-admin').getDb(), uid)))(identity.uid);
      if (!allowed) { res.setHeader('Retry-After', '900'); return res.status(429).json({ error: 'You have made several reviews. Try again in 15 minutes.' }); }
      const { anthropicRequest, DEFAULT_MODEL } = deps.anthropic || require('./anthropic');
      const result = await anthropicRequest({ model: DEFAULT_MODEL, max_tokens: 12000, system: reviewModule.instructions,
        messages: [{ role: 'user', content: JSON.stringify(input) }],
        tools: [{ name: 'submit_resume_review', description: 'Return the complete factual resume rewrite and critical editorial review.', input_schema: reviewModule.reviewSchema }],
        tool_choice: { type: 'tool', name: 'submit_resume_review' }
      }, { signal: AbortSignal.timeout(150000) });
      if (!result.ok) return res.status(result.status === 429 ? 429 : 503).json({ error: 'AI review is temporarily unavailable. Your draft is unchanged. Try again later.' });
      if (result.data?.stop_reason === 'max_tokens') return res.status(502).json({ error: 'The rewrite could not finish. Shorten the draft and try again. Your current draft is unchanged.' });
      const tool = result.data?.content?.find(item => item.type === 'tool_use' && item.name === 'submit_resume_review');
      const review = reviewModule.normalizeReview(tool?.input, input.resume, input.additionalDetails);
      return res.status(200).json(review);
    } catch {
      // No request bodies, profile details, provider responses, or tokens in logs.
      return res.status(503).json({ error: 'AI review could not complete. Your draft is unchanged. Try again later.' });
    }
  };
}
module.exports = { createWorkspaceHandler, consumeQuota };
