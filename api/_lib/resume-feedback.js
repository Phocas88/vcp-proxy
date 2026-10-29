'use strict';
const {createHash}=require('node:crypto');
const COLLECTION='_privateResumeFeedback';
const feedbackId=(uid,id)=>createHash('sha256').update(uid+'\0'+id).digest('hex');
const fail=(status,message)=>Object.assign(new Error(message),{status,public:true});
// Called only after the program handler has verified the Firebase identity and
// loaded a build from that identity's private collection. No resume content is
// copied into feedback, and feedback never goes through analytics or an LLM.
async function handleFeedback({req,res,ref,db,uid,id,now}){
 const action=req.body.action,body=req.body;
 const allowed=action==='feedback-submit'?['workspace','action','buildId','rating','comment']:['workspace','action','buildId'];
 if(Object.keys(body).some(key=>!allowed.includes(key)))throw fail(400,'Send only your rating and optional comment.');
 if(action==='feedback-submit'&&(!Number.isInteger(body.rating)||body.rating<1||body.rating>5||typeof body.comment!=='string'||body.comment.length>1000))throw fail(400,'Choose 1 to 5 stars and a comment of up to 1,000 characters.');
 const result=await db.runTransaction(async tx=>{
  const snapshot=await tx.get(ref),build=snapshot.data();
  if(!snapshot.exists||!['paid','complete'].includes(build.status)||!build.includedTemplate)throw fail(409,'Finish and save your resume before leaving feedback.');
  if(action==='feedback-prompt'){
   if(build.completionPromptAt||build.feedbackSubmittedAt)return {show:false};
   tx.update(ref,{completionPromptAt:now()});return {show:true};
  }
  // Retries and duplicate tabs cannot create multiple ratings or change an
  // already submitted rating. A failed transaction leaves submission retryable.
  if(build.feedbackSubmittedAt)return {submitted:true};
  const createdAt=now();
  tx.set(db.collection(COLLECTION).doc(feedbackId(uid,id)),{rating:body.rating,comment:body.comment.trim(),createdAt});
  tx.update(ref,{feedbackSubmittedAt:createdAt,completionPromptAt:build.completionPromptAt||createdAt});
  return {submitted:true};
 });
 return res.status(200).json(result);
}
module.exports={handleFeedback,feedbackId,COLLECTION};
