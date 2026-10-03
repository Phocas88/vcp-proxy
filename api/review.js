// Resume Review dispatcher.
// To fit the Vercel Hobby 12-function cap, all /api/review-* endpoints are served by this ONE
// function. vercel.json rewrites map each public path (e.g. /api/review-invite) to
// /api/review?__fn=invite; the individual handlers live in api/_lib/review/ (underscore dir →
// not counted as separate functions). Public URLs are unchanged, so no frontend/Stripe change.
'use strict';
const { readJsonBody } = require('./_lib/review-common');

const H = {
  'invite': require('./_lib/review/invite'),
  'invite-validate': require('./_lib/review/invite-validate'),
  'upload': require('./_lib/review/upload'),
  'submit': require('./_lib/review/submit'),
  'checkout': require('./_lib/review/checkout'),
  'webhook': require('./_lib/review/webhook'),
  'jobs': require('./_lib/review/jobs'),
  'job': require('./_lib/review/job'),
  'file': require('./_lib/review/file'),
  'extract': require('./_lib/review/extract'),
  'ai': require('./_lib/review/ai'),
  'journey': require('./_lib/review/journey'),
};
// These consume the raw request stream themselves (binary upload / Stripe signature).
const RAW = { upload: true, webhook: true };

function fnFromReq(req) {
  if (req.query && req.query.__fn) return String(req.query.__fn);
  const m = /\/api\/review-([a-z-]+)/.exec(req.url || '');
  return m ? m[1] : '';
}

module.exports = async function handler(req, res) {
  const fn = fnFromReq(req);
  const h = H[fn];
  if (!h) return res.status(404).json({ error: 'not_found' });

  // bodyParser is disabled for this function (raw routes need it). For JSON routes, parse once
  // here and attach req.body so the handlers work unchanged.
  if (!RAW[fn] && (req.method === 'POST' || req.method === 'PATCH')) {
    const body = await readJsonBody(req);
    if (body === null) return res.status(400).json({ error: 'bad_json' });
    req.body = body;
  }
  return h(req, res);
};

// Raw body required for the webhook + binary upload routes.
module.exports.config = { api: { bodyParser: false } };
