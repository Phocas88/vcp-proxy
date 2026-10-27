'use strict';
const crypto=require('node:crypto');
const DESIGNS=new Set('classic modern compact federal executive minimal heritage technical scholar horizon atlas signal patriot leadership consultant civic folio graduate industrial contemporary manager creative federal-concise federal-experience'.split(' '));
const PRODUCT='vcp-resume-template',PRICE=100;
const fail=(status,message)=>Object.assign(new Error(message),{status,public:true});
function documentInput(value){
 if(!value||!DESIGNS.has(value.design)||typeof value.resume!=='string'||!value.resume.trim()||value.resume.length>20000)throw fail(400,'Choose a template and a resume of up to 20,000 characters.');
 const result={design:value.design,resume:value.resume,applicationType:['private','government','federal'].includes(value.applicationType)?value.applicationType:'private',role:String(value.role||'').slice(0,200),jobDescription:String(value.jobDescription||'').slice(0,8000),additionalDetails:String(value.additionalDetails||'').slice(0,4000),arrangement:String(value.arrangement||'original').slice(0,40),paper:value.paper==='a4'?'a4':'letter',reflow:value.reflow!==false,pageBreaks:Array.isArray(value.pageBreaks)?value.pageBreaks.filter(x=>typeof x==='string').slice(0,100):[],exportSettings:value.exportSettings&&typeof value.exportSettings==='object'&&!Array.isArray(value.exportSettings)?value.exportSettings:{}};
 if(value.design.startsWith('federal')!==(result.applicationType==='federal'))throw fail(400,'Choose a template matching your civilian or federal resume type.');
 if(Buffer.byteLength(JSON.stringify(result))>850000)throw fail(413,'The saved resume is too large. Use a smaller photo.');
 return result;
}
function checkTemplatePayment(s,uid,buildId,design,sessionId){
 const total=s?.amount_total,discount=s?.total_details?.amount_discount;
 return s?.id===sessionId&&s.status==='complete'&&s.mode==='payment'&&s.currency==='usd'&&s.client_reference_id===buildId&&s.metadata?.product===PRODUCT&&s.metadata?.uid===uid&&s.metadata?.buildId===buildId&&s.metadata?.design===design&&s.amount_subtotal===PRICE&&Number.isInteger(total)&&total>=0&&total<=PRICE&&Number.isInteger(discount)&&discount===PRICE-total&&(s.payment_status==='paid'||total===0&&s.payment_status==='no_payment_required')&&!s.payment_intent?.latest_charge?.refunded;
}
async function handleTemplates({req,res,ref,data,db,uid,id,stripe,key,now,checkPayment,base,checkoutQuota}){
 const action=req.body.action,design=req.body.design||req.body.document?.design;
 if(!DESIGNS.has(design))throw fail(400,'Choose a resume template.');
 if(!key||!data.sessionId)throw fail(402,'Complete the original resume purchase first.');
 const baseCheckout=await stripe.stripeGet('/v1/checkout/sessions/'+encodeURIComponent(data.sessionId)+'?expand[]=payment_intent.latest_charge',key,AbortSignal.timeout(12000));
 if(!checkPayment(baseCheckout,uid,id,data.sessionId))throw fail(402,'Reopen the original checkout from purchase history.');
 const order=ref.collection('templateOrders').doc(design),finished=ref.collection('finishedResumes').doc(design);
 if(action==='template-open'){
  const snapshot=await finished.get();if(!snapshot.exists)throw fail(404,'Finish and save this template first.');
  const saved=snapshot.data();
  if(data.includedTemplate!==design){const purchase=await order.get();const o=purchase.data();if(!o?.sessionId||!checkTemplatePayment(await stripe.stripeGet('/v1/checkout/sessions/'+encodeURIComponent(o.sessionId)+'?expand[]=payment_intent.latest_charge',key,AbortSignal.timeout(12000)),uid,id,design,o.sessionId))throw fail(402,'Verify the existing template checkout before opening this design.');}
  return res.status(200).json({document:saved.document,templates:data.templates||[],includedTemplate:data.includedTemplate});
 }
 if(req.body.storageConsent!==true)throw fail(400,'Choose Finish & save to keep the finished resume privately.');
 const document=action==='template-finish'?{...documentInput(req.body.document),buildId:id}:null;
 // Claim the included template atomically. Two tabs cannot claim two free designs.
 if(action==='template-finish'){
  const result=await db.runTransaction(async tx=>{const s=await tx.get(ref),d=s.data();if(d.status==='deleted')throw fail(410,'This build was deleted.');if(d.includedTemplate&&d.includedTemplate!==design)return null;const templates=[...new Set([...(d.templates||[]),design])];tx.update(ref,{includedTemplate:design,templates,deletedTemplates:(d.deletedTemplates||[]).filter(value=>value!==design),updatedAt:now()});tx.set(finished,{document,updatedAt:now()});return {templates,includedTemplate:design,document};});
  if(result)return res.status(200).json(result);
 }
 const snap=await order.get();let purchase=snap.exists?snap.data():null;
 if(purchase?.sessionId){
  const session=await stripe.stripeGet('/v1/checkout/sessions/'+encodeURIComponent(purchase.sessionId)+'?expand[]=payment_intent.latest_charge',key,AbortSignal.timeout(12000));
  if(checkTemplatePayment(session,uid,id,design,purchase.sessionId)){
   const saved=document||purchase.document||(await finished.get()).data()?.document;if(!saved)throw fail(409,'Reopen this template and finish saving it.');
   const result=await db.runTransaction(async tx=>{const s=await tx.get(ref),d=s.data();if(d.status==='deleted')throw fail(410,'This build was deleted.');const templates=[...new Set([...(d.templates||[]),design])];tx.update(ref,{templates,deletedTemplates:(d.deletedTemplates||[]).filter(value=>value!==design),updatedAt:now()});tx.set(finished,{document:saved,updatedAt:now()});tx.update(order,{status:'paid',document:null,updatedAt:now()});return {templates,includedTemplate:d.includedTemplate,document:saved};});
   return res.status(200).json(result);
  }
  if(action==='template-verify')throw fail(402,'This template checkout is not complete. Resume it without paying twice.');
  if(session.status==='open'&&session.url){await order.update({document,updatedAt:now()});return res.status(200).json({url:session.url,design});}
  if(session.status==='complete')throw fail(402,'This template payment could not be verified. Contact support before paying again.');
 }
 if(action!=='template-finish')throw fail(402,'Finish the existing template checkout first.');
 if(checkoutQuota&&!await checkoutQuota(uid))throw fail(429,'Wait before opening another checkout; existing paid templates remain available.');
 const attempt=(purchase?.attempt||0)+(purchase?.sessionId?1:0);
 const body={mode:'payment',allow_promotion_codes:true,client_reference_id:id,metadata:{product:PRODUCT,uid,buildId:id,design},payment_intent_data:{metadata:{product:PRODUCT,uid,buildId:id,design}},payment_method_types:['card'],line_items:[{quantity:1,price_data:{currency:'usd',unit_amount:PRICE,product_data:{name:'VCP Resume — additional template',description:'One additional resume template. Repeat downloads of this template included.'}}}],success_url:base+'?build='+id+'&template='+design+'&checkout=success',cancel_url:base+'?build='+id+'&template='+design+'&checkout=canceled'};
 const session=await stripe.stripePost('/v1/checkout/sessions',body,key,AbortSignal.timeout(12000),'resume-program-template-'+crypto.createHash('sha256').update(uid+id+design).digest('hex')+'-'+attempt);
 if(!session.id||!/^https:\/\/checkout\.stripe\.com\//.test(session.url||''))throw fail(502,'Template checkout could not open. Try again.');
 await db.runTransaction(async tx=>{const s=await tx.get(ref);if(s.data().status==='deleted')throw fail(410,'This build was deleted.');tx.set(order,{sessionId:session.id,document,status:'awaiting_payment',attempt,updatedAt:now()});});
 return res.status(200).json({url:session.url,design});
}
async function deleteTemplateData(ref){for(const name of ['finishedResumes','templateOrders']){const snap=await ref.collection(name).get();for(const doc of snap.docs)await ref.collection(name).doc(doc.id).delete();}}
module.exports={handleTemplates,deleteTemplateData,documentInput,checkTemplatePayment,DESIGNS,PRICE,PRODUCT};
