// Store dispatcher.
// Serves /api/store-checkout and /api/store-download from ONE function (Hobby 12-function cap).
// vercel.json rewrites map the public paths to /api/store?__fn=checkout|download. Handlers live
// in api/_lib/store/. Default body parsing is fine (checkout=JSON POST, download=GET stream).
'use strict';
const H = {
  'checkout': require('./_lib/store/checkout'),
  'download': require('./_lib/store/download'),
};
function fnFromReq(req) {
  if (req.query && req.query.__fn) return String(req.query.__fn);
  const m = /\/api\/store-([a-z-]+)/.exec(req.url || '');
  return m ? m[1] : '';
}
module.exports = async function handler(req, res) {
  const h = H[fnFromReq(req)];
  if (!h) return res.status(404).json({ error: 'not_found' });
  return h(req, res);
};
