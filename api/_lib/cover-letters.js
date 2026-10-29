'use strict';
// Each letter has its own immutable source, Stripe receipt and recoverable result.
const crypto=require('node:crypto');
const {normalizeLetter,generateLetter}=require('./cover-letter-ai');
const PRODUCT='vcp-resume-cover-letter',PRICE=100;
const fail=(status,message)=>Object.assign(new Error(message),{public:true,status});
const validId=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
function checkLetterPayment(s,uid,id,sessionId){
 const total=s?.amount_total,discount=s?.total_details?.amount_discount;
 return s?.id===sessionId&&s.mode==='payment'&&s.status==='complete'&&s.currency==='usd'&&s.client_reference_id===id&&s.metadata?.uid===uid&&s.metadata?.letterId===id&&s.metadata?.product===PRODUCT&&s.amount_subtotal===PRICE&&Number.isInteger(total)&&total>=0&&total<=PRICE&&Number.isInteger(discount)&&discount===PRICE-total&&(s.payment_status==='paid'||total===0&&s.payment_status==='no_payment_required')&&!s.payment_intent?.latest_charge?.refunded;
}
const publicLetter=(id,d,details=false)=>({id,status:d.status,title:[d.input?.role,d.input?.company].filter(Boolean).join(' · ')||'Cover letter',createdAt:d.createdAt,updatedAt:d.updatedAt,amount:d.amount??PRICE,discountAmount:d.discountAmount??0,currency:'usd',hasResult:!!d.result,...(details?{input:d.input,requestId:d.requestId,result:d.result?{...d.result,coverLetter:d.editedContent??d.result.coverLetter}:null}: {})});
async function handleCoverLetters({req,res,db,uid,stripe,key,deps,now,base,checkBuildPayment}){
 const collection=db.collection('_privateResumeProgramUsers').doc(uid).collection('coverLetters'),action=req.body.action;
 let ref,lease,heartbeat,streaming=false;
 const reply=(status,body)=>{if(!streaming)return res.status(status).json(body);if(!res.destroyed&&!res.writableEnded)res.end(JSON.stringify({...body,httpStatus:status}));return res;};
 async function checkout(d,id){
  if(!key||!d.sessionId)throw fail(402,'Complete this letter’s checkout first.');
  const s=await stripe.stripeGet('/v1/checkout/sessions/'+encodeURIComponent(d.sessionId)+'?expand[]=payment_intent.latest_charge',key,AbortSignal.timeout(12000));
  if(!checkLetterPayment(s,uid,id,d.sessionId))throw fail(402,'This letter’s checkout is not complete or could not be verified. Reopen the existing checkout; do not pay again.');
  return {amount:s.amount_total,discountAmount:s.total_details.amount_discount};
 }
 try{
  if(action==='letter-list'){
   const [letters,builds]=await Promise.all([collection.orderBy('createdAt','desc').limit(100).get(),db.collection('_privateResumeProgramUsers').doc(uid).collection('builds').orderBy('createdAt','desc').limit(50).get()]);
   return reply(200,{letters:letters.docs.filter(d=>d.data().status!=='deleted').map(d=>publicLetter(d.id,d.data())),legacy:builds.docs.filter(d=>d.data().status!=='deleted'&&(d.data().legacyCoverLetter||d.data().careerKit?.coverLetter)).map(d=>({id:d.id,title:d.data().input?.role||'Previously generated cover letter'}))});
  }
  if(action==='letter-legacy'){
   const id=req.body.letterId;if(!validId(id))throw fail(400,'Choose an existing cover letter.');
   const s=await db.collection('_privateResumeProgramUsers').doc(uid).collection('builds').doc(id).get(),d=s.data();
   const content=d?.legacyCoverLetter||d?.careerKit?.coverLetter;
   if(!s.exists||d.status==='deleted'||!content)throw fail(404,'That cover letter is not available in this account.');
   if(!key||!d.sessionId||!checkBuildPayment(await stripe.stripeGet('/v1/checkout/sessions/'+encodeURIComponent(d.sessionId)+'?expand[]=payment_intent.latest_charge',key,AbortSignal.timeout(12000)),uid,id,d.sessionId))throw fail(402,'Reopen the original resume purchase to verify this existing letter.');
   return reply(200,{id,legacy:true,title:d.input?.role||'Cover letter',result:{coverLetter:content,checks:[]}});
  }
  if(action==='letter-prepare'){
   if(req.body.consent!==true||req.body.storageConsent!==true)throw fail(400,'Agree to the $1 cover letter, AI processing after payment, and private recovery storage first.');
   if(typeof req.body.requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(req.body.requestId))throw fail(400,'Start a new cover letter from Cover letters.');
   const {validateInput}=await import('./resume-workspace/review.mjs');let input;try{input=validateInput(req.body.input);}catch(e){throw fail(400,e.message);}
   if(req.body.input?.company!==undefined&&(typeof req.body.input.company!=='string'||req.body.input.company.length>200))throw fail(400,'Keep the company name within 200 characters.');
   input.company=(req.body.input.company||'').trim();
   if(!input.role.trim()&&!input.jobDescription.trim())throw fail(400,'Add a target job title or job posting for this letter.');
   if(!key||!deps.generateLetter&&!process.env.OPENAI_API_KEY&&!process.env.ANTHROPIC_API_KEY)throw fail(503,'Cover letter purchases are paused while the payment or AI service is configured. You have not been charged.');
   const id=crypto.createHash('sha256').update(uid+'\0cover-letter:'+req.body.requestId).digest('hex');ref=collection.doc(id);
   let data=await db.runTransaction(async tx=>{const s=await tx.get(ref);if(s.exists){const d=s.data();if(d.status==='deleted')throw fail(410,'This letter was deleted. Start a new letter if you want another.');if(JSON.stringify(d.input)!==JSON.stringify(input))throw fail(409,'This purchase belongs to the original resume and job details. Reopen it, or start a new $1 letter.');return d;}const d={input,requestId:req.body.requestId,status:'awaiting_payment',attempt:0,base,createdAt:now(),updatedAt:now()};tx.set(ref,d);return d;});
   if(data.sessionId){
    const s=await stripe.stripeGet('/v1/checkout/sessions/'+encodeURIComponent(data.sessionId)+'?expand[]=payment_intent.latest_charge',key,AbortSignal.timeout(12000));
    if(checkLetterPayment(s,uid,id,data.sessionId)){data=await db.runTransaction(async tx=>{const snap=await tx.get(ref),d=snap.data();if(d.status==='deleted')throw fail(410,'This letter was deleted.');const patch={amount:s.amount_total,discountAmount:s.total_details.amount_discount,...(d.status==='awaiting_payment'?{status:'paid'}:{})};tx.update(ref,patch);return {...d,...patch};});return reply(200,publicLetter(id,data,true));}
    if(s.status==='complete'||data.status!=='awaiting_payment')throw fail(402,'This letter’s payment could not be verified. Contact support before paying again.');
    if(s.status==='open'&&/^https:\/\/checkout\.stripe\.com\//.test(s.url||''))return reply(200,{...publicLetter(id,data),url:s.url});
    data=await db.runTransaction(async tx=>{const snap=await tx.get(ref),d=snap.data();if(d.status!=='awaiting_payment')throw fail(409,'This letter changed. Reopen it from Cover letters.');if(d.sessionId===data.sessionId&&d.attempt===data.attempt){const next={...d,attempt:d.attempt+1,sessionId:null};tx.set(ref,next);return next;}return d;});
   }
   if(deps.checkoutQuota&&!await deps.checkoutQuota(uid))throw fail(429,'Wait 15 minutes before opening another checkout. Existing letter purchases remain available.');
   const metadata={product:PRODUCT,uid,letterId:id};
   const session=await stripe.stripePost('/v1/checkout/sessions',{mode:'payment',allow_promotion_codes:true,client_reference_id:id,metadata,payment_intent_data:{metadata},payment_method_types:['card'],line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:PRICE,product_data:{name:'VCP Resume — cover letter',description:'One cover letter. Manual edits, retries and repeat downloads included.'}}}],success_url:data.base+'?letter='+id+'&checkout=success#letter',cancel_url:data.base+'?letter='+id+'&checkout=canceled#letter'},key,AbortSignal.timeout(12000),'resume-program-letter-'+id+'-'+data.attempt);
   if(!session.id||!/^https:\/\/checkout\.stripe\.com\//.test(session.url||''))throw fail(502,'Checkout could not open. Retry this letter.');
   await db.runTransaction(async tx=>{const s=await tx.get(ref);if(s.data()?.status==='deleted')throw fail(410,'This letter was deleted.');tx.update(ref,{sessionId:session.id,updatedAt:now()});});
   return reply(200,{...publicLetter(id,data),url:session.url});
  }
  const id=req.body.letterId;if(!validId(id))throw fail(400,'Choose a letter from Cover letters.');
  ref=collection.doc(id);const snapshot=await ref.get();let data=snapshot.data();if(!snapshot.exists)throw fail(404,'Letter not found in this account.');if(data.status==='deleted')throw fail(410,'This letter’s data was deleted.');
  if(action==='letter-delete'){
   await db.runTransaction(async tx=>{const s=await tx.get(ref),d=s.data();if(d.status==='running'&&d.leaseUntil>now())throw fail(409,'Wait for this letter to finish before deleting it.');tx.update(ref,{input:null,result:null,editedContent:null,status:'deleted',lease:null,leaseUntil:0,updatedAt:now()});});return reply(200,{deleted:true});
  }
  if(action==='letter-get'&&data.status==='awaiting_payment'){
   try{const paid=await checkout(data,id);data=await db.runTransaction(async tx=>{const snap=await tx.get(ref),d=snap.data();if(d.status==='deleted')throw fail(410,'This letter was deleted.');const patch={...paid,...(d.status==='awaiting_payment'?{status:'paid'}:{}),updatedAt:now()};tx.update(ref,patch);return {...d,...patch};});}catch(e){if(e.status!==402)throw e;return reply(200,{...publicLetter(id,data,true),result:null});}
  }else{
   const paid=await checkout(data,id);data={...data,...paid,...(data.status==='awaiting_payment'?{status:'paid'}:{})};
  }
  if(action==='letter-get')return reply(200,publicLetter(id,data,true));
  if(action==='letter-save'){
   if(!data.result||typeof req.body.content!=='string'||!req.body.content.trim()||req.body.content.length>10000)throw fail(400,'Open a generated letter and keep edits within 10,000 characters.');
   await db.runTransaction(async tx=>{const s=await tx.get(ref);if(s.data()?.status!=='complete')throw fail(409,'This letter changed. Reopen it.');tx.update(ref,{editedContent:req.body.content.trim(),updatedAt:now()});});return reply(200,{saved:true});
  }
  if(action!=='letter-run')throw fail(400,'Unknown cover letter action.');
  if(req.body.consent!==true)throw fail(400,'Agree to AI processing before creating this letter.');
  const cached=await db.runTransaction(async tx=>{const s=await tx.get(ref),d=s.data();if(d.status==='deleted')throw fail(410,'This letter was deleted.');if(d.result)return publicLetter(id,d,true);if(d.leaseUntil>now())throw fail(409,'Your letter is still being written. Reopen it in a moment; do not pay again.');lease=crypto.randomUUID();tx.update(ref,{status:'running',lease,leaseUntil:now()+150000,updatedAt:now()});return null;});
  if(cached)return reply(200,cached);
  if(deps.quota&&!await deps.quota(uid))throw fail(429,'Wait 15 minutes, then retry this purchased letter. No second payment is needed.');
  if(req.body.keepAlive===true){res.status(200);res.setHeader('Content-Type','application/json; charset=utf-8');streaming=true;const pulse=()=>{if(!res.destroyed&&!res.writableEnded)res.write(' \n');};pulse();heartbeat=setInterval(pulse,5000);heartbeat.unref?.();}
  const result=await normalizeLetter(await (deps.generateLetter||generateLetter)(data.input),data.input);
  data=await db.runTransaction(async tx=>{const s=await tx.get(ref),d=s.data();if(d.lease!==lease||d.status!=='running')throw fail(409,'Reopen this letter to recover its current result.');const patch={status:'complete',result,lease:null,leaseUntil:0,amount:data.amount,discountAmount:data.discountAmount,updatedAt:now()};tx.update(ref,patch);return {...d,...patch};});lease=null;
  return reply(200,publicLetter(id,data,true));
 }catch(e){
  if(ref&&lease)try{await db.runTransaction(async tx=>{const s=await tx.get(ref);if(s.data()?.lease===lease)tx.update(ref,{status:'paid',lease:null,leaseUntil:0,updatedAt:now()});});}catch{/* The expired lease remains recoverable. */}
  return reply(e.public?e.status:503,{error:e.public?e.message:'This action could not finish. Your letter purchase remains recoverable in Cover letters; do not pay again.',errorCode:'COVER_LETTER_UNAVAILABLE'});
 }finally{clearInterval(heartbeat);}
}
module.exports={handleCoverLetters,checkLetterPayment,PRICE,PRODUCT};
