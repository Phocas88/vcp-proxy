'use strict';
// Derive assessment input from the authenticated owner's saved record. Client
// resume text, owner IDs and alleged purchase flags never select the source.
const crypto=require('node:crypto');
const {normalizeMatches,generateMatches}=require('./career-matches');
const fail=(status,message)=>Object.assign(new Error(message),{public:true,status});
function savedInput(record){
 if(record?.document?.resume)return record.document;
 if(record?.workspace?.resume)return record.workspace;
 if(typeof record?.content==='string'){
  try{const parsed=JSON.parse(record.content.replace(/^```(?:json)?\s*|\s*```$/g,''));if(parsed&&typeof parsed==='object')record={...record,resumeData:parsed};}catch{}
  if(!record.resumeData)return {resume:record.content};
 }
 const data=record?.resumeData;if(!data||typeof data!=='object')throw fail(400,'This saved item has no resume text. Upload or save its text first.');
 const text=v=>typeof v==='string'?v:'',list=v=>Array.isArray(v)?v.map(text).filter(Boolean):[];
 const sections=[text(data.name),text(data.contact),data.summary&&'PROFESSIONAL SUMMARY\n'+text(data.summary)];
 if(Array.isArray(data.experience))sections.push('EXPERIENCE\n'+data.experience.map(e=>[text(e.title),text(e.employer),text(e.dates),...list(e.bullets)].filter(Boolean).join('\n')).join('\n\n'));
 if(Array.isArray(data.education))sections.push('EDUCATION\n'+data.education.map(e=>[text(e.degree),text(e.school),text(e.year)].filter(Boolean).join(' · ')).join('\n'));
 for(const key of ['skills','certifications','awards'])if(list(data[key]).length)sections.push(key.toUpperCase()+'\n'+list(data[key]).join('\n'));
 return {resume:sections.filter(Boolean).join('\n\n')};
}
async function handleSavedCareerMatches({req,res,sourceRef,parentRef,db,deps,uid,now}){
 let lease,heartbeat,streaming=false;
 const reply=(status,body)=>{if(!streaming)return res.status(status).json(body);if(!res.destroyed&&!res.writableEnded)res.end(JSON.stringify({...body,httpStatus:status}));return res;};
 try{
  const {validateInput}=await import('./resume-workspace/review.mjs');
  const read=async tx=>{if(parentRef){const parent=tx?await tx.get(parentRef):await parentRef.get();if(!parent.exists||parent.data().status==='deleted')throw fail(410,'This purchased resume was deleted.');}const snapshot=tx?await tx.get(sourceRef):await sourceRef.get();if(!snapshot.exists)throw fail(404,'That resume is no longer saved in this account. Refresh the resume list.');const record=snapshot.data();return {record,input:validateInput(savedInput(record))};};
  const fingerprint=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const source=await read(),hash=fingerprint(source.input);
  const cached=await db.runTransaction(async tx=>{const current=await read(tx);if(fingerprint(current.input)!==hash)throw fail(409,'The resume changed. Select it again to assess its saved version.');const cache=current.record.careerAssessmentV2;if(cache?.fingerprint===hash&&Array.isArray(cache.matches))return normalizeMatches(cache.matches,current.input);if(req.body.consent!==true)throw fail(400,'Agree to AI assessment and private recovery storage first.');if(cache?.leaseUntil>now())throw fail(409,'This resume is already being assessed. Wait a moment, then retry.');lease=crypto.randomUUID();tx.update(sourceRef,{careerAssessmentV2:{fingerprint:hash,lease,leaseUntil:now()+150000}});return null;});
  if(cached)return reply(200,{matches:cached,source:'selected saved resume'});
  if(deps.quota&&!await deps.quota(uid))throw fail(429,'Too many AI attempts. Wait 15 minutes, then retry.');
  if(req.body.keepAlive===true){res.status(200);res.setHeader('Content-Type','application/json; charset=utf-8');streaming=true;const pulse=()=>{if(!res.destroyed&&!res.writableEnded)res.write(' \n');};pulse();heartbeat=setInterval(pulse,5000);heartbeat.unref?.();}
  const matches=normalizeMatches(await(deps.generateCareerMatches||generateMatches)(source.input),source.input);
  await db.runTransaction(async tx=>{const current=await read(tx);if(fingerprint(current.input)!==hash||current.record.careerAssessmentV2?.lease!==lease)throw fail(409,'This resume changed while it was being assessed. Select its saved version again.');tx.update(sourceRef,{careerAssessmentV2:{fingerprint:hash,matches,updatedAt:now(),lease:null,leaseUntil:0}});});lease=null;return reply(200,{matches,source:'selected saved resume'});
 }catch(e){if(lease)try{await db.runTransaction(async tx=>{const snap=await tx.get(sourceRef);if(snap.exists&&snap.data()?.careerAssessmentV2?.lease===lease)tx.update(sourceRef,{careerAssessmentV2:{lease:null,leaseUntil:0}});});}catch{}return reply(e.public?e.status:e.status||503,{error:e.public||e.status===400?e.message:'Career assessment could not finish. Your saved resume is unchanged; retry without another checkout.',errorCode:'CAREER_MATCHES_UNAVAILABLE'});
 }finally{clearInterval(heartbeat);}
}
module.exports={savedInput,handleSavedCareerMatches};
