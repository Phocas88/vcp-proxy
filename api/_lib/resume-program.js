'use strict';
// Separate $1.99 resume program. All purchase/build records are server-owned;
// existing Firestore default-deny rules exclude this root collection.
const crypto = require('node:crypto');
const PRICE = 199;
const PRODUCT = 'vcp-resume-workspace';
const ORIGINS = new Set(['https://veterancareerpath.com','https://www.veterancareerpath.com','https://mobile-resume-review-app.vercel.app']);
const sitePath = origin => origin.includes('mobile-resume-review-app') ? '/index.html' : '/resumereview/';
const fail = (status,message) => Object.assign(new Error(message),{status,public:true});
function reference(db,uid,id) { return db.collection('_privateResumeProgramUsers').doc(uid).collection('builds').doc(id); }
function checkPayment(s,uid,id,sessionId) {
 return s?.id===sessionId && s.mode==='payment' && s.status==='complete' && s.payment_status==='paid' && s.amount_total===PRICE && s.currency==='usd' && s.client_reference_id===id && s.metadata?.uid===uid && s.metadata?.buildId===id && s.metadata?.product===PRODUCT && !s.payment_intent?.latest_charge?.refunded;
}
function publicBuild(id,data,details=false){return {id,status:data.status,createdAt:data.createdAt,amount:PRICE,currency:'usd',...(details?{input:data.input,review:data.result||null}:{} )};}
function createProgramHandler(deps={}) {
 const now=deps.now||Date.now;
 return async function(req,res){
  res.setHeader('Cache-Control','no-store');
  let ref, lease;
  try {
   const origin=req.headers.origin;
   if(!ORIGINS.has(origin))throw fail(403,'Open the Veteran Career Path resume program to continue.');
   if(!String(req.headers['content-type']||'').startsWith('application/json'))throw fail(415,'Send resume text as JSON.');
   if(Buffer.byteLength(JSON.stringify(req.body||{}))>150000)throw fail(413,'That draft is too large.');
   if(req.body.action==='guest') {
    if(Object.keys(req.body).some(key=>!['workspace','action'].includes(key)))throw fail(400,'Guest sign-in does not accept resume content.');
    const result=await require('./resume-guest').guestToken(req,deps);
    return res.status(result.status).json(result.token ? {token:result.token} : {error:result.error});
   }
   const token=req.headers['x-vcp-firebase-token'];
   if(typeof token!=='string'||!token)throw fail(401,'Sign in to your free resume-program account. No main-site subscription is required.');
   let identity;try{identity=await (deps.verifyIdToken||(t=>require('./firebase-admin').getAuth().verifyIdToken(t,true)))(token);}catch{throw fail(401,'Your program session expired. Sign in again.');}
   if(!identity?.uid)throw fail(401,'Sign in again.');
   const uid=identity.uid;const db=deps.db||require('./firebase-admin').getDb();
   const action=req.body.action||'run';
   const stripe=deps.stripe||require('./stripe');const key=deps.stripeKey||process.env.STRIPE_SECRET_KEY;
   if(action==='list'){
    const snap=await db.collection('_privateResumeProgramUsers').doc(uid).collection('builds').orderBy('createdAt','desc').limit(50).get();
    return res.status(200).json({builds:snap.docs.filter(d=>d.data().status!=='deleted').map(d=>publicBuild(d.id,d.data()))});
   }
   if(action==='prepare'){
    if(req.body.consent!==true||req.body.storageConsent!==true)throw fail(400,'Agree to AI processing and storage for purchase recovery before checkout.');
    const mod=await import('./resume-workspace/review.mjs');let input;try{input=mod.validateInput(req.body.input);}catch(error){throw fail(error.status||400,error.message);}
    if(!key||(!deps.generate&&!process.env.ANTHROPIC_API_KEY&&!process.env.OPENAI_API_KEY))throw fail(503,'Purchases are paused while the AI or payment service is being configured. You have not been charged.');
    const id=crypto.createHash('sha256').update(uid+'\0'+JSON.stringify(input)).digest('hex');ref=reference(db,uid,id);
    let data=await db.runTransaction(async tx=>{const s=await tx.get(ref);if(s.exists)return s.data();const d={uid,input,status:'awaiting_payment',createdAt:now(),updatedAt:now(),attempt:0,origin};tx.set(ref,d);return d;});
    if(data.status==='deleted')throw fail(409,'This build was deleted. Change the draft to start a new build, or contact support about the purchase.');
    if(data.status==='complete'||data.status==='paid'||data.status==='running')return res.status(200).json(publicBuild(id,data,true));
    let expired=false;
    if(data.sessionId){
     const s=await stripe.stripeGet('/v1/checkout/sessions/'+encodeURIComponent(data.sessionId),key,AbortSignal.timeout(12000));
     if(checkPayment(s,uid,id,data.sessionId)){await ref.update({status:'paid',updatedAt:now()});return res.status(200).json({id,status:'paid'});}
     if(s.status==='open'&&s.url)return res.status(200).json({id,status:'awaiting_payment',url:s.url});
     if(s.status==='complete')throw fail(402,'Payment is still processing or could not be verified. Check your purchase history before trying again.');
     expired=true;
    }
    if(expired||now()-data.createdAt>23*60*60*1000){data=await db.runTransaction(async tx=>{const s=await tx.get(ref);const d=s.data();if(d.status!=='awaiting_payment')throw fail(409,'Build state changed. Open purchase history.');if(d.sessionId===data.sessionId&&d.attempt===data.attempt){const next={...d,attempt:d.attempt+1,sessionId:null,checkoutUrl:null,createdAt:now()};tx.set(ref,next);return next;}return d;});}
    if(deps.checkoutQuota&&!await deps.checkoutQuota(uid))throw fail(429,'Several checkouts have been requested. Wait 15 minutes before opening another; existing paid builds remain available.');
    const base=data.origin+sitePath(data.origin);
    const body={mode:'payment',client_reference_id:id,metadata:{product:PRODUCT,uid,buildId:id},payment_intent_data:{metadata:{product:PRODUCT,uid,buildId:id}},payment_method_types:['card'],line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:PRICE,product_data:{name:'Veteran Career Path — one AI resume build',description:'One fact-preserving AI build. Formatting and downloads included. No subscription.'}}}],success_url:base+'?build='+id+'&checkout=success',cancel_url:base+'?build='+id+'&checkout=canceled'};
    const session=await stripe.stripePost('/v1/checkout/sessions',body,key,AbortSignal.timeout(12000),'resume-program-'+id+'-'+data.attempt);
    if(!session.id||!/^https:\/\/checkout\.stripe\.com\//.test(session.url||''))throw fail(502,'Stripe checkout could not open. You have not been charged by this request.');
    await ref.update({sessionId:session.id,checkoutUrl:session.url,updatedAt:now()});
    return res.status(200).json({id,status:'awaiting_payment',url:session.url});
   }
   const id=req.body.buildId;if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw fail(400,'Choose a build from your purchase history.');
   ref=reference(db,uid,id);const snap=await ref.get();if(!snap.exists)throw fail(404,'Build not found in this program account.');let data=snap.data();
   if(action==='delete'){
    if(data.status==='running'&&data.leaseUntil>now())throw fail(409,'Wait for this build to finish before deleting its data.');
    if(data.status==='awaiting_payment'&&data.sessionId&&key){try{const session=await stripe.stripeGet('/v1/checkout/sessions/'+encodeURIComponent(data.sessionId),key,AbortSignal.timeout(12000));if(session.status==='open')await stripe.stripePost('/v1/checkout/sessions/'+encodeURIComponent(data.sessionId)+'/expire',{},key,AbortSignal.timeout(12000));}catch{/* Data deletion still proceeds; Stripe remains the payment source of truth. */}}
    await ref.update({input:null,result:null,status:'deleted',checkoutUrl:null,updatedAt:now()});return res.status(200).json({deleted:true});
   }
   if(data.status==='deleted')throw fail(410,'The resume data for this build was deleted. Contact support for purchase questions.');
   if(action==='get')return res.status(200).json(publicBuild(id,data,true));
   if(action!=='run')throw fail(400,'Unknown program action.');
   if(req.body.consent!==true)throw fail(400,'Agree to AI processing before building.');
   if(data.status==='complete')return res.status(200).json({id,review:data.result});
   if(!key||!data.sessionId)throw fail(402,'Purchase this build for $1.99 first. No main-site subscription is required.');
   const checkout=await stripe.stripeGet('/v1/checkout/sessions/'+encodeURIComponent(data.sessionId)+'?expand[]=payment_intent.latest_charge',key,AbortSignal.timeout(12000));
   if(!checkPayment(checkout,uid,id,data.sessionId))throw fail(402,'Payment has not completed or could not be verified. Resume the existing checkout from purchase history; do not pay again if your card was charged.');
   lease=crypto.randomUUID();
   const prior=await db.runTransaction(async tx=>{const s=await tx.get(ref);const d=s.data();if(d.status==='complete')return d.result;if(d.status==='deleted')throw fail(410,'This build was deleted.');if(d.status==='running'&&d.leaseUntil>now())throw fail(409,'This build is already running. Wait a moment, then reopen it from purchase history.');tx.update(ref,{status:'running',lease,leaseUntil:now()+210000,updatedAt:now()});return null;});
   if(prior){lease=null;return res.status(200).json({id,review:prior});}
   // Quota applies only to actual AI executions. Failed executions retain the purchase.
   if(deps.quota&&!await deps.quota(uid))throw fail(429,'Too many AI attempts. Wait 15 minutes; your purchase is still available.');
   const review=await (deps.generate||generate)(data.input);
   if (!review || typeof review.revisedResume !== 'string' || !review.revisedResume.trim()) throw new Error('incomplete_rewrite');
   await db.runTransaction(async tx=>{const s=await tx.get(ref);if(s.data().lease!==lease)throw fail(409,'A recovery attempt is already handling this build. Open it from purchase history.');tx.update(ref,{status:'complete',result:review,lease:null,leaseUntil:0,updatedAt:now()});});
   lease=null;return res.status(200).json({id,review});
  }catch(e){
   if(lease&&ref){try{await (deps.db||require('./firebase-admin').getDb()).runTransaction(async tx=>{const s=await tx.get(ref);if(s.data()?.lease===lease)tx.update(ref,{status:'paid',lease:null,leaseUntil:0,updatedAt:now()});});}catch{/* An expired execution lease is recoverable. */}}
   // Never log resumes, results, Stripe responses, credentials, or identity tokens.
   return res.status(e.public&&e.status<500?e.status:503).json({error:e.public&&e.status<500?e.message:'The service could not complete this action. Your purchase remains recoverable in purchase history; no second payment is needed for a failed build.'});
  }
 };
}
async function generate(input){
 const mod=await import('./resume-workspace/review.mjs');
 // Use the configured OpenAI API when supplied; the existing production service
 // currently uses Anthropic. Both providers are disclosed in the program notice.
 if(process.env.OPENAI_API_KEY)return mod.reviewResume(input,{apiKey:process.env.OPENAI_API_KEY});
 const {anthropicRequest,DEFAULT_MODEL}=require('./anthropic');
 const response=await anthropicRequest({model:DEFAULT_MODEL,max_tokens:12000,system:mod.instructions,messages:[{role:'user',content:JSON.stringify(input)}],tools:[{name:'submit_resume_review',description:'Return the complete factual resume rewrite and editorial review.',input_schema:mod.reviewSchema}],tool_choice:{type:'tool',name:'submit_resume_review'}},{signal:AbortSignal.timeout(150000)});
 if(!response.ok||response.data?.stop_reason==='max_tokens')throw new Error('provider_unavailable');
 return mod.normalizeReview(response.data?.content?.find(x=>x.type==='tool_use'&&x.name==='submit_resume_review')?.input,input.resume,input.additionalDetails);
}
module.exports={createProgramHandler,checkPayment,PRICE,PRODUCT,ORIGINS};
