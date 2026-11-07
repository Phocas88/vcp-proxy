'use strict';
// Synthetic acceptance adapter: real program handlers/validators, in-memory
// storage, and controlled Stripe/provider responses. No external calls or keys.
const {createProgramHandler}=require('../../api/_lib/resume-program');
const fixtures=require('../fixtures/88m-profiles.json');
function memoryDb(){
 const records=new Map();let queue=Promise.resolve();
 const ref=path=>({path,id:path.split('/').at(-1),collection:name=>ref(path+'/'+name),doc:id=>ref(path+'/'+id),orderBy(){return this;},limit(){return this;},
  async get(){return {exists:records.has(path),data:()=>structuredClone(records.get(path)),docs:[...records].filter(([key])=>key.startsWith(path+'/')&&!key.slice(path.length+1).includes('/')).map(([key,value])=>({id:key.split('/').at(-1),data:()=>structuredClone(value)}))};},
  async set(value,options){records.set(path,options?.merge?{...records.get(path),...structuredClone(value)}:structuredClone(value));},
  async update(value){records.set(path,{...records.get(path),...structuredClone(value)});},async delete(){records.delete(path);}});
 return {records,collection:ref,runTransaction(run){const task=queue.then(()=>run({get:r=>r.get(),set:(r,v)=>records.set(r.path,structuredClone(v)),update:(r,v)=>records.set(r.path,{...records.get(r.path),...structuredClone(v)}),delete:r=>records.delete(r.path)}));queue=task.catch(()=>{});return task;}};
}
const match=(code,evidence,reason,connection='Experience connection')=>({code,connection,evidence,reason,checkNext:'Check civilian licensing, training and employer requirements before applying.'});
function rawMatches(input){
 const a=input.resume.includes('Drove convoy vehicles.'),values=a?[match('vcp-freight-truck-driver','Drove convoy vehicles.','Your confirmed convoy driving connects to transport work.')]:[
  match('vcp-transport-dispatch-coordinator','Dispatched vehicles.','You confirmed dispatching vehicles.'),
  match('vcp-fleet-operations-coordinator','Recorded vehicle status in GCSS-Army.','Recording vehicle status supports fleet coordination.'),
  match('vcp-employee-training-specialist','Trained drivers.','Driver training offers a transferable connection to employee training.','Transferable skills')];
 const metadata=input.resume.split('\n').find(line=>line.includes('MOS'))||'Army | MOS 88M';
 return [...values,match('vcp-software-engineer',metadata,'The occupation code establishes software engineering experience.'),...(!a?[match('vcp-software-engineer','Recorded vehicle status in GCSS-Army.','Using GCSS-Army establishes software engineering experience.')]:[])];
}
function rawKit(input){
 const facts=input.resume+'\n'+(input.additionalDetails||''),b=facts.includes('Dispatched vehicles.'),confirmed=facts.includes(fixtures.reportAnswer),evidence=b?'Recorded vehicle status in GCSS-Army.':'Performed vehicle inspections before and after missions.';
 return {summary:'Compare the supplied duties with the posting and confirm missing facts.',qualifications:[
  ...[['Dispatch vehicles.','Dispatched vehicles.'],['Train drivers.','Trained drivers.'],['Record vehicle status in GCSS-Army.','Recorded vehicle status in GCSS-Army.']].filter(([requirement])=>input.jobDescription?.includes(requirement)).map(([requirement,quote])=>({requirement,status:facts.includes(quote)?'Supported':'Not demonstrated',evidence:facts.includes(quote)?quote:'',nextAction:'Add an example only if you personally performed this duty.'})),
  {requirement:'Prepare weekly vehicle availability reports.',status:'Supported',evidence:confirmed?fixtures.reportAnswer:evidence,nextAction:fixtures.reportQuestion},
  {requirement:'Current civilian CDL required.',status:'Supported',evidence:input.resume.split('\n').find(line=>line.includes('MOS'))||'Army | MOS 88M',nextAction:'Check civilian licensing.'}
 ].filter(q=>input.jobDescription?.includes(q.requirement)),translations:[
  {militaryTerm:b?'GCSS-Army':'88M',civilianSkill:b?'Vehicle-status recordkeeping':'Convoy driving',evidence:b?'Recorded vehicle status in GCSS-Army.':'Drove convoy vehicles.',resumeWording:b?'Recorded vehicle status in GCSS-Army.':'Drove convoy vehicles.',careerDirections:b?['Fleet operations coordinator']:['Freight truck driver']},
  {militaryTerm:b?'GCSS-Army':'88M',civilianSkill:'ERP implementation',evidence,resumeWording:'Implemented GCSS-Army and prepared weekly vehicle availability reports.',careerDirections:['Software engineer']}
 ],coverLetter:'',checks:['Confirm civilian licensing and the employer’s requirements.']};
}
function rawReview(input,revisedResume){return {score:70,summary:'Use the confirmed duties and clarify reporting before applying.',strengths:['You supplied specific duties.'],findings:[],suggestions:[],nextSteps:[fixtures.reportQuestion],revisedResume,rewriteNotes:[],careerMatches:rawMatches(input)};}
function createEvidenceProgram(){
 const db=memoryDb(),sessions=new Map(),keys=new Map(),requests=[],providerAttempts=[],careerInputs=[];let sequence=0,clock=1790000000000;
 for(const person of fixtures.applicants){db.records.set('profiles/'+person.id+'/resumeProgramResumes/source-88m',{title:person.name+' · original history',content:person.resume,createdAt:'2026-01-01T00:00:00Z'});db.records.set('profiles/'+person.id+'/resumeProgram/background',{profile:{name:person.name,roles:[{branch:'army',code:'88M',duties:person.duties.join('\n')}]}});}
 const stripe={async stripePost(path,body,key,signal,idempotency){
  if(path.endsWith('/expire')){const s=sessions.get(path.split('/')[4]);s.status='expired';return s;}
  if(keys.has(idempotency))return keys.get(idempotency);
  const session={id:'cs_fixture_'+(++sequence),url:'https://checkout.stripe.com/c/pay/synthetic-only',status:'complete',mode:'payment',payment_status:'paid',amount_subtotal:body.line_items[0].price_data.unit_amount,amount_total:body.line_items[0].price_data.unit_amount,total_details:{amount_discount:0},currency:'usd',client_reference_id:body.client_reference_id,metadata:body.metadata};sessions.set(session.id,session);keys.set(idempotency,session);return session;
 },async stripeGet(path){return structuredClone(sessions.get(path.split('/').at(-1).split('?')[0]));}};
 const handler=createProgramHandler({db,stripe,stripeKey:'synthetic-stripe-adapter',now:()=>++clock,verifyIdToken:async token=>{const uid=token.replace(/^firebase-/,'');if(!fixtures.applicants.some(p=>p.id===uid))throw new Error('Unknown synthetic user');return {uid};},quota:async()=>true,
  generate:async input=>{const {reviewWithRecovery}=await import('../../api/_lib/resume-workspace/review.mjs');let attempt=0;return reviewWithRecovery(input,async()=>{attempt++;providerAttempts.push({attempt,reportConfirmed:input.additionalDetails?.includes(fixtures.reportAnswer)||false});const safe=input.resume+(input.additionalDetails?.includes(fixtures.reportAnswer)?'\n'+fixtures.reportAnswer:'');return rawReview(input,attempt===1?input.resume+'\nImplemented GCSS-Army and prepared weekly vehicle availability reports.':safe);});},
  generateCareerMatches:async input=>{careerInputs.push(structuredClone(input));return rawMatches(input);},generateCareer:async input=>rawKit(input)
 });
 async function run(uid,body){
  requests.push({uid,action:body.action,buildId:body.buildId,resumeId:body.resumeId});
  const res={code:200,chunks:[],setHeader(){},status(code){this.code=code;return this;},json(data){this.data=data;return this;},write(chunk){this.chunks.push(chunk);},end(chunk){this.chunks.push(chunk);this.data=JSON.parse(this.chunks.join(''));this.writableEnded=true;}};
  await handler({method:'POST',headers:{origin:'https://veteranresumes.com','content-type':'application/json','x-vcp-firebase-token':'firebase-'+uid},body:{workspace:true,...body}},res);return {status:res.code,data:res.data};
 }
 return {db,requests,providerAttempts,careerInputs,sessions,run,fixtures};
}
module.exports={createEvidenceProgram,rawMatches,rawKit,rawReview,fixtures};
