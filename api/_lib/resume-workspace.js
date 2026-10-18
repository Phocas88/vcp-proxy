'use strict';
// Additional authenticated mode of /api/claude. Uses the existing function so
// the project does not consume another Vercel Hobby function slot.

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
 return require('./resume-program').createProgramHandler({
  quota: uid => consumeQuota(deps.db || require('./firebase-admin').getDb(), uid),
  checkoutQuota: uid => consumeQuota(deps.db || require('./firebase-admin').getDb(), uid + '-checkout'),
  ...deps
 });
}
module.exports = { createWorkspaceHandler, consumeQuota };
