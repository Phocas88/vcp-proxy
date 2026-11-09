'use strict';
const crypto=require('node:crypto');
const {DESIGNS,checkTemplatePayment}=require('./resume-templates');
const fail=(status,message)=>Object.assign(new Error(message),{public:true,status});
const fingerprint=d=>crypto.createHash('sha256').update(JSON.stringify([d?.resume,d?.applicationType])).digest('hex');
function validateSource(source){
 if(!source||typeof source.buildId!=='string'||!/^[a-f0-9]{64}$/.test(source.buildId)||!DESIGNS.has(source.design))throw fail(400,'Choose a finished resume from My Resumes before creating a cover letter.');
 return {buildId:source.buildId,design:source.design};
}
async function resolveLetterSource({db,uid,source,stripe,key,checkBuildPayment}){
 const selected=validateSource(source),parent=db.collection('_privateResumeProgramUsers').doc(uid).collection('builds').doc(selected.buildId),documentRef=parent.collection('finishedResumes').doc(selected.design);
 const [build,snapshot]=await Promise.all([parent.get(),documentRef.get()]);
 const available=d=>d&&d.status!=='deleted'&&(d.templates||[]).includes(selected.design)&&!(d.deletedTemplates||[]).includes(selected.design);
 const data=build.data(),document=snapshot.data()?.document;
 if(!build.exists||!snapshot.exists||!available(data)||typeof document?.resume!=='string'||!document.resume.trim())throw fail(404,'That finished resume is not available in this account. Refresh My Resumes and choose another.');
 if(!key||!data.sessionId)throw fail(402,'Verify the original resume purchase in Purchase History first.');
 const payment=await stripe.stripeGet('/v1/checkout/sessions/'+encodeURIComponent(data.sessionId)+'?expand[]=payment_intent.latest_charge',key,AbortSignal.timeout(12000));
 if(!checkBuildPayment(payment,uid,selected.buildId,data.sessionId))throw fail(402,'The selected resume purchase could not be verified. Reopen it in Purchase History.');
 if(data.includedTemplate!==selected.design){
  const order=(await parent.collection('templateOrders').doc(selected.design).get()).data();
  if(!order?.sessionId||!checkTemplatePayment(await stripe.stripeGet('/v1/checkout/sessions/'+encodeURIComponent(order.sessionId)+'?expand[]=payment_intent.latest_charge',key,AbortSignal.timeout(12000)),uid,selected.buildId,selected.design,order.sessionId))throw fail(402,'Verify this resume design in Purchase History before using it.');
 }
 const hash=fingerprint(document);
 return {source:selected,document,async confirm(tx){const [p,s]=await Promise.all([tx.get(parent),tx.get(documentRef)]);if(!p.exists||!s.exists||!available(p.data())||fingerprint(s.data()?.document)!==hash)throw fail(409,'The selected resume changed. Select its saved version again before checkout.');}};
}
function letterJobUrl(value){
 if(value===undefined||value===null||value==='')return '';
 if(typeof value!=='string'||value.length>2000)throw fail(400,'Use a job posting link of up to 2,000 characters.');
 try{const url=new URL(value.trim());if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error();return url.href;}catch{throw fail(400,'Enter a valid HTTP or HTTPS job posting link.');}
}
module.exports={resolveLetterSource,validateSource,letterJobUrl};
