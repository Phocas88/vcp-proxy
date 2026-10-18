'use strict';
const crypto = require('node:crypto');
// Guest identities use a server-minted custom Firebase token; no provider-setting
// changes or email signup are needed. Purchases keep the same UID on account linking.
async function allowGuest(db, ip, now=Date.now()) {
 const hash=crypto.createHmac('sha256',process.env.VCB_SESSION_SECRET||'resume-program-guest').update(ip).digest('hex');
 const ref=db.collection('_privateResumeGuestLimits').doc(hash);
 return db.runTransaction(async tx=>{
  const snap=await tx.get(ref);const old=snap.exists?snap.data():{};
  const active=Number(old.reset)>now;const count=active?Number(old.count)||0:0;
  if(count>=10)return false;
  tx.set(ref,{count:count+1,reset:active?old.reset:now+3600000});return true;
 });
}
async function guestToken(req,deps={}) {
 const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();
 const db=deps.db||require('./firebase-admin').getDb();
 if(!await (deps.guestQuota||((value)=>allowGuest(db,value)))(ip))return {status:429,error:'Several guest sessions have been started. Wait a while or sign in to your account.'};
 const uid='resumeGuest_'+crypto.randomUUID();
 const token=await (deps.mintGuestToken||((id)=>require('./firebase-admin').getAuth().createCustomToken(id,{resumeProgramGuest:true})))(uid);
 return {status:200,token};
}
module.exports={guestToken,allowGuest};
