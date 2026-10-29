'use strict';
// Separate $1.99 resume program. All purchase/build records are server-owned;
// existing Firestore default-deny rules exclude this root collection.
const crypto = require('node:crypto');
const PRICE = 199;
// No-cost Checkout requires 2023-08-16 or later. Scope this version to this program.
const STRIPE_API_VERSION = '2024-06-20';
const PRODUCT = 'vcp-resume-workspace';
const ORIGINS = new Set(['https://veterancareerpath.com','https://www.veterancareerpath.com','https://mobile-resume-review-app.vercel.app']);
const sitePath = origin => origin.includes('mobile-resume-review-app') ? '/index.html' : '/resumereview/';
const fail = (status,message,publicCode) => Object.assign(new Error(message),{status,public:true,publicCode});
const DIAGNOSTIC_CODES=new Set(['AI_AUTHENTICATION','AI_ACCESS','AI_BILLING_LIMIT','AI_RATE_LIMIT','AI_QUOTA_OR_RATE_LIMIT','AI_PROVIDER_UNAVAILABLE','AI_REQUEST_REJECTED','AI_TIMEOUT','AI_INVALID_RESPONSE','AI_OUTPUT_TRUNCATED','AI_REWRITE_WITHHELD']);
const DIAGNOSTIC_MESSAGES={
 AI_AUTHENTICATION:'The AI connection could not authenticate. The site owner needs to reconnect the AI service.',
 AI_ACCESS:'The AI connection does not have access to the configured model. The site owner needs to check AI access.',
 AI_BILLING_LIMIT:'AI builds are paused because the AI provider reports insufficient credits or a billing or spending limit. The site owner needs to check AI billing.',
 AI_RATE_LIMIT:'The AI provider is rate limiting build requests. Wait a minute before retrying this existing build.',
 AI_QUOTA_OR_RATE_LIMIT:'The AI provider has reached a credit, usage or rate limit.',
 AI_PROVIDER_UNAVAILABLE:'The AI provider is temporarily unavailable.',
 AI_REQUEST_REJECTED:'The AI provider rejected the build request.',
 AI_TIMEOUT:'The AI provider did not finish before the request timed out.',
 AI_INVALID_RESPONSE:'The AI provider returned a result the resume builder could not read.',
 AI_OUTPUT_TRUNCATED:'The AI response stopped before the complete resume was returned.',
 AI_REWRITE_WITHHELD:'The AI could not produce a complete rewrite within the supplied numeric facts and size limit. Your original resume is unchanged. Retry this existing build from purchase history.',
 BUILD_STORAGE_UNAVAILABLE:'The resume service could not reserve this build for processing.',
 RESULT_STORAGE_UNAVAILABLE:'The resume service could not save the generated result.',
 CHECKOUT_VERIFICATION_UNAVAILABLE:'The checkout service could not be reached to verify this build.'
};
const diagnostic=(code,validationDetails)=>Object.assign(new Error('Resume build failed'),{diagnosticCode:code,...(validationDetails?{validationDetails}: {})});
function safeValidationDetails(value){
 if(!value||typeof value!=='object')return null;
 const unsupportedNumbers=Array.isArray(value.unsupportedNumbers)?value.unsupportedNumbers.filter(x=>typeof x==='string'&&x.length<=40&&/^\d+(?:[.,]\d+)*(?:\s*%|[ \t]*[KMB]\b)?$/iu.test(x)).slice(0,8).map(x=>x.replace(/\s+/gu,' ')):[];
 const reasons=[...(value.empty===true?['empty_rewrite']:[]),...(value.overLength===true?['length_limit']:[]),...(unsupportedNumbers.length?['unsupported_numbers']:[])];
 return reasons.length?{reasons,unsupportedNumbers,...(Number.isInteger(value.characters)&&value.characters>=0?{characters:value.characters}:{}),characterLimit:20000}:null;
}
function reference(db,uid,id) { return db.collection('_privateResumeProgramUsers').doc(uid).collection('builds').doc(id); }
function checkPayment(s,uid,id,sessionId) {
 // Trust only the server-created Session retrieved directly from Stripe. A zero
 // total alone is not proof of a valid discount or a completed checkout.
 const total=s?.amount_total, discount=s?.total_details?.amount_discount;
 const validTotal=Number.isInteger(total) && total>=0 && total<=PRICE && s.amount_subtotal===PRICE && Number.isInteger(discount) && discount===PRICE-total;
 // A fully discounted payment-mode Session can still be reported as paid.
 // Accept either settled status at $0; positive totals must always be paid.
 const settled=s?.payment_status==='paid' || (total===0 && s?.payment_status==='no_payment_required');
 return s?.id===sessionId && s.mode==='payment' && s.status==='complete' && validTotal && settled && s.currency==='usd' && s.client_reference_id===id && s.metadata?.uid===uid && s.metadata?.buildId===id && s.metadata?.product===PRODUCT && !s.payment_intent?.latest_charge?.refunded;
}
function settlement(s){return {amount:s.amount_total,discountAmount:s.total_details.amount_discount};}
function publicBuild(id,data,details=false){return {id,status:data.status,createdAt:data.createdAt,prepaid:data.prepaid===true,entryMode:data.entryMode||'edit',refinementCount:data.refinementCount||0,amount:data.amount??PRICE,discountAmount:data.discountAmount??0,currency:'usd',hasSubmittedResume:typeof data.input?.resume==='string'&&!!data.input.resume.trim(),templates:data.templates||[],deletedTemplates:data.deletedTemplates||[],includedTemplate:data.includedTemplate||null,...(details?{input:data.input,entryContext:data.entryContext||null,requestId:data.requestId||null,careerMatches:data.careerAssessment?.matchingVersion===require('./career-matches').MATCHING_VERSION?data.careerAssessment.matches:undefined,review:data.result?{...data.result,submittedResume:data.input?.resume||'',refinementCount:data.refinementCount||0}:null,lastError:data.lastError||null,answers:data.answers||[]}:{} )};}
function clarificationInput(data,answers){
 if(!Array.isArray(answers)||!answers.length||answers.length>16)throw fail(400,'Answer at least one review question.');
 const seen=new Set(),verified=[];
 const text=answers.map(item=>{
  if(!item||typeof item.id!=='string'||seen.has(item.id)||typeof item.answer!=='string'||!item.answer.trim()||item.answer.length>1000)throw fail(400,'Keep each answer between 1 and 1,000 characters.');
  if(item.context!==undefined&&(typeof item.context!=='string'||item.context.length>160))throw fail(400,'Identify the related job or section in 160 characters or fewer.');
  seen.add(item.id);let prompt;
  const match=/^(finding|step)-(\d+)$/.exec(item.id);
  if(match){const index=Number(match[2]);prompt=match[1]==='finding'?data.result?.findings?.[index]?.action:data.result?.nextSteps?.[index];}
  else if(/^extra-[0-2]$/.test(item.id)&&typeof item.context==='string'&&item.context.trim()&&item.context.length<=160)prompt='Additional verified fact for '+item.context.trim();
  if(!prompt)throw fail(400,'Choose a question from this build’s review or identify the job or section for an additional fact.');
  verified.push({id:item.id,answer:item.answer.trim(),...(item.context?{context:item.context.trim()}: {})});
  return prompt+'\nApplicant’s verified answer: '+item.answer.trim();
 }).join('\n\n');
 const additionalDetails=[data.input.additionalDetails,text].filter(Boolean).join('\n\n');
 if(additionalDetails.length>4000)throw fail(400,'Keep the combined verified details and answers within 4,000 characters.');
 return {input:{...data.input,additionalDetails},answers:verified};
}
function createProgramHandler(deps={}) {
 const now=deps.now||Date.now;
 return async function(req,res){
  res.setHeader('Cache-Control','no-store');
  let ref, lease, heartbeat, streaming=false, stage='request';
  const stopHeartbeat=()=>clearInterval(heartbeat);
  const reply=(status,body)=>{
   if(!streaming)return res.status(status).json(body);
   // Headers have already been flushed. Keep application status in the final
   // JSON envelope; whitespace heartbeats remain valid JSON for older clients.
   if(!res.destroyed&&!res.writableEnded)res.end(JSON.stringify({...body,httpStatus:status}));
   return res;
  };
  try {
   const origin=req.headers.origin;
   if(!ORIGINS.has(origin))throw fail(403,'Open the Veteran Career Path resume program to continue.');
   if(!String(req.headers['content-type']||'').startsWith('application/json'))throw fail(415,'Send resume text as JSON.');
   if(Buffer.byteLength(JSON.stringify(req.body||{}))>(String(req.body?.action).startsWith('template-')?950000:150000))throw fail(413,'That draft is too large.');
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
   const client=deps.stripe||require('./stripe');const key=deps.stripeKey||process.env.STRIPE_SECRET_KEY;
   const stripe={stripeGet:(path,key,signal)=>client.stripeGet(path,key,signal,STRIPE_API_VERSION),stripePost:(path,body,key,signal,idempotency)=>client.stripePost(path,body,key,signal,idempotency,STRIPE_API_VERSION)};
   if(action.startsWith('letter-'))return require('./cover-letters').handleCoverLetters({req,res,db,uid,stripe,key,deps,now,base:origin+sitePath(origin),checkBuildPayment:checkPayment});
   if(action==='list'){
    const snap=await db.collection('_privateResumeProgramUsers').doc(uid).collection('builds').orderBy('createdAt','desc').limit(50).get();
    return res.status(200).json({builds:snap.docs.filter(d=>d.data().status!=='deleted').map(d=>publicBuild(d.id,d.data()))});
   }
   if(action==='prepare'||action==='purchase'){
    const prepaid=action==='purchase';
    let entryContext=null;
    if(prepaid&&req.body.entryContext){const c=req.body.entryContext;if(typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['jobId','resumeVersionId'].includes(k))||typeof c.jobId!=='string'||!/^[\w-]{1,160}$/.test(c.jobId)||typeof c.resumeVersionId!=='string'||c.resumeVersionId&&!/^[\w-]{1,160}$/.test(c.resumeVersionId))throw fail(400,'Choose a saved application and resume version.');entryContext={jobId:c.jobId,resumeVersionId:c.resumeVersionId};}
    if(req.body.storageConsent!==true||(!prepaid&&req.body.consent!==true))throw fail(400,'Agree to the purchase and recovery storage terms before checkout.');
    let input=null;
    if(prepaid){if(typeof req.body.requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(req.body.requestId)||!['build','edit'].includes(req.body.entryMode))throw fail(400,'Choose how to start your resume build.');}
    else{const mod=await import('./resume-workspace/review.mjs');try{input=mod.validateInput(req.body.input);}catch(error){throw fail(error.status||400,error.message);}}
    if(!key||(!deps.generate&&!process.env.ANTHROPIC_API_KEY&&!process.env.OPENAI_API_KEY))throw fail(503,'Purchases are paused while the AI or payment service is being configured. You have not been charged.');
    const id=crypto.createHash('sha256').update(uid+'\0'+(prepaid?'prepaid:'+req.body.requestId:JSON.stringify(input))).digest('hex');ref=reference(db,uid,id);
    let data=await db.runTransaction(async tx=>{const s=await tx.get(ref);if(s.exists)return s.data();const d={uid,input,...(prepaid?{prepaid:true,entryMode:req.body.entryMode,requestId:req.body.requestId,...(entryContext?{entryContext}: {})}:{}),status:'awaiting_payment',createdAt:now(),updatedAt:now(),attempt:0,origin};tx.set(ref,d);return d;});
    if(data.status==='deleted')throw fail(409,'This build was deleted. Change the draft to start a new build, or contact support about the purchase.');
    if(data.status==='complete'||data.status==='paid'||data.status==='running')return res.status(200).json(publicBuild(id,data,true));
    let expired=false;
    if(data.sessionId){
     const s=await stripe.stripeGet('/v1/checkout/sessions/'+encodeURIComponent(data.sessionId),key,AbortSignal.timeout(12000));
     if(checkPayment(s,uid,id,data.sessionId)){await ref.update({status:'paid',...settlement(s),updatedAt:now()});return res.status(200).json(publicBuild(id,{...data,status:'paid',...settlement(s)},true));}
     if(s.status==='open'&&s.url){
      if(s.allow_promotion_codes===true)return res.status(200).json({id,status:'awaiting_payment',url:s.url});
      // Old unpaid sessions cannot have this setting updated. Expire them before
      // replacing them, so returning customers can enter a code as well.
      await stripe.stripePost('/v1/checkout/sessions/'+encodeURIComponent(data.sessionId)+'/expire',{},key,AbortSignal.timeout(12000));
     }
     if(s.status==='complete')throw fail(402,'Payment is still processing or could not be verified. Check your purchase history before trying again.');
     expired=true;
    }
    if(expired||now()-data.createdAt>23*60*60*1000){data=await db.runTransaction(async tx=>{const s=await tx.get(ref);const d=s.data();if(d.status!=='awaiting_payment')throw fail(409,'Build state changed. Open purchase history.');if(d.sessionId===data.sessionId&&d.attempt===data.attempt){const next={...d,attempt:d.attempt+1,sessionId:null,checkoutUrl:null,createdAt:now()};tx.set(ref,next);return next;}return d;});}
    if(deps.checkoutQuota&&!await deps.checkoutQuota(uid))throw fail(429,'Several checkouts have been requested. Wait 15 minutes before opening another; existing paid builds remain available.');
    const base=data.origin+sitePath(data.origin);
    const body={mode:'payment',allow_promotion_codes:true,client_reference_id:id,metadata:{product:PRODUCT,uid,buildId:id},payment_intent_data:{metadata:{product:PRODUCT,uid,buildId:id}},payment_method_types:['card'],line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:PRICE,product_data:{name:'Veteran Career Path — one AI resume build',description:'One AI build and one chosen template. Additional templates $1 each. No subscription.'}}}],success_url:base+'?build='+id+'&checkout=success',cancel_url:base+'?build='+id+'&checkout=canceled'};
    const session=await stripe.stripePost('/v1/checkout/sessions',body,key,AbortSignal.timeout(12000),'resume-program-promo-v1-'+id+'-'+data.attempt);
    if(!session.id||!/^https:\/\/checkout\.stripe\.com\//.test(session.url||''))throw fail(502,'Stripe checkout could not open. You have not been charged by this request.');
    await ref.update({sessionId:session.id,checkoutUrl:session.url,updatedAt:now()});
    return res.status(200).json({id,status:'awaiting_payment',url:session.url});
   }
   if(action==='career-assess-saved'){
    const resumeId=req.body.resumeId;
    if(typeof resumeId!=='string'||!/^[\w-]{1,160}$/.test(resumeId))throw fail(400,'Choose a saved resume from this account.');
    const sourceRef=db.collection('profiles').doc(uid).collection('resumeProgramResumes').doc(resumeId);
    return require('./career-saved').handleSavedCareerMatches({req,res,sourceRef,db,deps,uid,now});
   }
   const id=req.body.buildId;if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw fail(400,'Choose a build from your purchase history.');
   ref=reference(db,uid,id);const snap=await ref.get();if(!snap.exists)throw fail(404,'Build not found in this program account.');let data=snap.data();
   if(data.status==='deleted'&&action!=='delete')throw fail(410,'The resume data for this build was deleted.');
   if(['feedback-prompt','feedback-submit'].includes(action))return await require('./resume-feedback').handleFeedback({req,res,ref,db,uid,id,now});
   if(['template-finish','template-verify','template-open'].includes(action))return await require('./resume-templates').handleTemplates({req,res,ref,data,db,uid,id,stripe,key,now,checkPayment,base:origin+sitePath(origin),checkoutQuota:deps.checkoutQuota});
   if(action==='resume-delete')return res.status(200).json(await require('./resume-delete').deleteSavedTemplate({db,ref,uid,id,design:req.body.design,now}));
   if(action==='delete'){
    if(data.status==='running'&&data.leaseUntil>now())throw fail(409,'Wait for this build to finish before deleting its data.');
    if(data.status==='awaiting_payment'&&data.sessionId&&key){try{const session=await stripe.stripeGet('/v1/checkout/sessions/'+encodeURIComponent(data.sessionId),key,AbortSignal.timeout(12000));if(session.status==='open')await stripe.stripePost('/v1/checkout/sessions/'+encodeURIComponent(data.sessionId)+'/expire',{},key,AbortSignal.timeout(12000));}catch{/* Data deletion still proceeds; Stripe remains the payment source of truth. */}}
    await ref.update({templates:[],includedTemplate:null,input:null,entryContext:null,result:null,answers:null,clarificationDetails:null,careerKit:null,legacyCoverLetter:null,careerLease:null,careerLeaseUntil:0,careerAssessment:null,careerAssessmentLease:null,careerAssessmentLeaseUntil:0,lastError:null,status:'deleted',checkoutUrl:null,updatedAt:now()});await db.collection(require('./resume-feedback').COLLECTION).doc(require('./resume-feedback').feedbackId(uid,id)).delete();await require('./resume-templates').deleteTemplateData(ref);await require('./resume-delete').deleteBuildMirrors({db,uid,id,templates:data.templates||[]});return res.status(200).json({deleted:true});
   }
   if(data.status==='deleted')throw fail(410,'The resume data for this build was deleted. Contact support for purchase questions.');
   if(action==='verify'||action==='bind'){
    if(!key||!data.sessionId)throw fail(402,'Complete this build’s checkout first.');
    stage='checkout_verification';
    const checkout=await stripe.stripeGet('/v1/checkout/sessions/'+encodeURIComponent(data.sessionId)+'?expand[]=payment_intent.latest_charge',key,AbortSignal.timeout(12000));
    if(!checkPayment(checkout,uid,id,data.sessionId))throw fail(402,'Checkout is not complete. Continue the existing checkout from purchase history.');
    let input;
    if(action==='bind'){
     if(!data.prepaid)throw fail(400,'This purchase already has its resume input.');
     if(req.body.consent!==true||req.body.storageConsent!==true)throw fail(400,'Agree to AI processing and recovery storage before submitting your resume.');
     const mod=await import('./resume-workspace/review.mjs');try{input=mod.validateInput(req.body.input);}catch(e){throw fail(e.status||400,e.message);}
    }
    data=await db.runTransaction(async tx=>{
     const s=await tx.get(ref),d=s.data();if(d.status==='deleted')throw fail(410,'This build was deleted.');
     if(input&&d.input&&JSON.stringify(d.input)!==JSON.stringify(input))throw fail(409,'This purchase is already assigned to a different resume. Reopen its result or purchase a new build.');
     const patch={...settlement(checkout),updatedAt:now(),...(d.status==='awaiting_payment'?{status:'paid'}:{}),...(input&&!d.input?{input}: {})};
     tx.update(ref,patch);return {...d,...patch};
    });
    return res.status(200).json(publicBuild(id,data,true));
   }
   if(action==='get')return res.status(200).json(publicBuild(id,data,true));
   if(action==='career-assess'&&req.body.design){
    const design=req.body.design;
    if(!require('./resume-templates').DESIGNS.has(design)||!(data.templates||[]).includes(design))throw fail(400,'Choose a saved template from this purchase.');
    if(!key||!data.sessionId)throw fail(402,'Open the existing resume purchase first.');
    const checkout=await stripe.stripeGet('/v1/checkout/sessions/'+encodeURIComponent(data.sessionId)+'?expand[]=payment_intent.latest_charge',key,AbortSignal.timeout(12000));
    if(!checkPayment(checkout,uid,id,data.sessionId))throw fail(402,'This purchase could not be verified. Reopen its existing checkout.');
    return require('./career-saved').handleSavedCareerMatches({req,res,sourceRef:ref.collection('finishedResumes').doc(design),parentRef:ref,db,deps,uid,now});
   }
   if(action==='career-assess')return require('./career-matches').handleCareerMatches({req,res,ref,data,db,uid,id,stripe,key,deps,now,checkPayment});
   if(action==='career')return require('./career-kit').handleCareerKit({req,res,ref,data,db,uid,id,stripe,key,deps,now,checkPayment});
   if(!['run','refine'].includes(action))throw fail(400,'Unknown program action.');
   if(req.body.consent!==true)throw fail(400,'Agree to AI processing before building.');
   const refining=action==='refine';
   if(!data.input)throw fail(400,'Add your resume and job details before starting the AI build.');
   if(!refining&&data.status==='complete')return res.status(200).json({id,review:publicBuild(id,data,true).review});
   let clarification;
   if(refining){
    if(!data.result)throw fail(409,'Complete the initial review before answering its questions.');
    if((data.refinementCount||0)>=1)throw fail(409,'Your included AI update has been used. Manual edits and downloads remain included. A new AI build costs $1.99.','CLARIFICATION_UPDATE_USED');
    clarification=clarificationInput(data,req.body.answers);
   }
   if(!key||!data.sessionId)throw fail(402,'Purchase this build for $1.99 first. No main-site subscription is required.');
   stage='checkout_verification';
   const checkout=await stripe.stripeGet('/v1/checkout/sessions/'+encodeURIComponent(data.sessionId)+'?expand[]=payment_intent.latest_charge',key,AbortSignal.timeout(12000));
   if(!checkPayment(checkout,uid,id,data.sessionId))throw fail(402,'Payment has not completed or could not be verified. Resume the existing checkout from purchase history; do not pay again if your card was charged.');
   stage='build_storage';lease=crypto.randomUUID();
   const prior=await db.runTransaction(async tx=>{const s=await tx.get(ref);const d=s.data();if(!refining&&d.status==='complete')return publicBuild(id,d,true).review;if(d.status==='deleted')throw fail(410,'This build was deleted.');if(refining&&(d.refinementCount||0)>=1)throw fail(409,'Your included AI update has already been used.','CLARIFICATION_UPDATE_USED');if(d.status==='running'&&d.leaseUntil>now())throw fail(409,'This build is already running. Wait a moment, then reopen it from purchase history.');tx.update(ref,{status:'running',...settlement(checkout),lease,leaseUntil:now()+210000,lastError:null,updatedAt:now()});return null;});
   if(prior){lease=null;return res.status(200).json({id,review:prior});}
   // Quota applies only to actual AI executions. Failed executions retain the purchase.
   if(deps.quota&&!await deps.quota(uid))throw fail(429,'Too many AI attempts. Wait 15 minutes; your purchase is still available.');
   if(req.body.keepAlive===true){
    res.status(200);res.setHeader('Content-Type','application/json; charset=utf-8');
    streaming=true;
    const pulse=()=>{if(!res.destroyed&&!res.writableEnded)res.write(' \n');};
    pulse();heartbeat=setInterval(pulse,5000);heartbeat.unref?.();
    res.once?.('close',stopHeartbeat);
   }
   stage='ai_build';
   const review=await (deps.generate||generate)(clarification?.input||data.input);
   if (!review || typeof review.revisedResume !== 'string' || !review.revisedResume.trim()) throw diagnostic('AI_REWRITE_WITHHELD');
   stage='result_storage';
   const refinementCount=(data.refinementCount||0)+(refining?1:0);
   await db.runTransaction(async tx=>{const s=await tx.get(ref);if(s.data().lease!==lease)throw fail(409,'A recovery attempt is already handling this build. Open it from purchase history.');tx.update(ref,{status:'complete',result:review,refinementCount,...(clarification?{answers:clarification.answers,clarificationDetails:clarification.input.additionalDetails}:{}),lease:null,leaseUntil:0,updatedAt:now()});});
   lease=null;return reply(200,{id,review:{...review,submittedResume:data.input.resume,refinementCount}});
  }catch(e){
   // Never log resumes, results, Stripe responses, credentials, or identity tokens.
   const errorCode=e.publicCode||(DIAGNOSTIC_CODES.has(e.diagnosticCode)?e.diagnosticCode:({checkout_verification:'CHECKOUT_VERIFICATION_UNAVAILABLE',build_storage:'BUILD_STORAGE_UNAVAILABLE',ai_build:'AI_BUILD_UNAVAILABLE',result_storage:'RESULT_STORAGE_UNAVAILABLE'}[stage]||'SERVICE_UNAVAILABLE'));
   const message=DIAGNOSTIC_MESSAGES[errorCode]||'The service could not complete this action.';
   // These details are only returned to the authenticated build owner and saved
   // in that owner's private recovery record. Never send the rejected draft or
   // log its content, even when generation fails repeatedly.
   const validationDetails=errorCode==='AI_REWRITE_WITHHELD'?safeValidationDetails(e.validationDetails):null;
   const reason=validationDetails?.unsupportedNumbers.length?'The AI rewrite added or changed numeric details ('+validationDetails.unsupportedNumbers.join(', ')+'), so it was not applied.':validationDetails?.reasons.includes('length_limit')?'The AI rewrite exceeded the 20,000-character limit, so it was not applied.':validationDetails?.reasons.includes('empty_rewrite')?'The AI returned no complete revised resume.':message;
   const status=e.public&&e.status<500?e.status:503;
   const body={error:e.public&&e.status<500?e.message:reason+' Your checkout remains available in purchase history; no second payment is needed. Support code: '+errorCode+'.',errorCode,...(validationDetails?{validationDetails}: {})};
   if(lease&&ref){try{await (deps.db||require('./firebase-admin').getDb()).runTransaction(async tx=>{const s=await tx.get(ref);if(s.data()?.lease===lease)tx.update(ref,{status:s.data().result?'complete':'paid',lease:null,leaseUntil:0,lastError:{...body,status},updatedAt:now()});});}catch{/* An expired execution lease is recoverable. */}}
   return reply(status,body);
  }finally{stopHeartbeat();res.removeListener?.('close',stopHeartbeat);}
 };
}
async function generate(input){
 const mod=await import('./resume-workspace/review.mjs');
 try{
 // Prefer the configured OpenAI API; retain Anthropic for deployments using it.
 // Both providers use the same guarded repair and are disclosed in the notice.
 if(process.env.OPENAI_API_KEY){
  return await mod.reviewResume(input,{apiKey:process.env.OPENAI_API_KEY});
 }
 const {anthropicRequest,DEFAULT_MODEL}=require('./anthropic');
 return await mod.reviewWithRecovery(input,async(validated,{instructions,signal})=>{
 let response;
 try{response=await anthropicRequest({model:DEFAULT_MODEL,max_tokens:12000,system:instructions,messages:[{role:'user',content:JSON.stringify(validated)}],tools:[{name:'submit_resume_review',description:'Return the complete factual resume rewrite and editorial review.',input_schema:mod.reviewSchema}],tool_choice:{type:'tool',name:'submit_resume_review'}},{signal});}
 catch(error){throw diagnostic(['AbortError','TimeoutError'].includes(error.name)?'AI_TIMEOUT':'AI_PROVIDER_UNAVAILABLE');}
 if(!response.ok){
  const error=response.data?.error;
  // Match only known billing language; never return the provider's raw message.
  if(error?.type==='invalid_request_error'&&typeof error.message==='string'&&/credit balance.{0,40}too low|insufficient credits/i.test(error.message))throw diagnostic('AI_BILLING_LIMIT');
  if(response.status===429&&error?.type==='rate_limit_error')throw diagnostic('AI_RATE_LIMIT');
  throw diagnostic(({401:'AI_AUTHENTICATION',403:'AI_ACCESS',429:'AI_QUOTA_OR_RATE_LIMIT'}[response.status])||(response.status>=500?'AI_PROVIDER_UNAVAILABLE':'AI_REQUEST_REJECTED'));
 }
 if(response.data?.stop_reason==='max_tokens')throw diagnostic('AI_OUTPUT_TRUNCATED');
 return response.data?.content?.find(x=>x.type==='tool_use'&&x.name==='submit_resume_review')?.input;
 });
 }catch(error){if(error instanceof mod.ReviewError)throw diagnostic(DIAGNOSTIC_CODES.has(error.diagnosticCode)?error.diagnosticCode:'AI_INVALID_RESPONSE',error.validationDetails);throw error;}
}
module.exports={createProgramHandler,checkPayment,PRICE,PRODUCT,ORIGINS};

