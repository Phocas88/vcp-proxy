'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createEvidenceProgram,fixtures}=require('./helpers/evidence-program.cjs');
async function paidBuild(server,person,role='Fleet Coordinator'){
 const purchase=await server.run(person.id,{action:'purchase',requestId:crypto.randomUUID(),entryMode:'edit',storageConsent:true});assert.equal(purchase.status,200,JSON.stringify(purchase));const id=purchase.data.id;
 assert.equal((await server.run(person.id,{action:'verify',buildId:id})).status,200);
 assert.equal((await server.run(person.id,{action:'bind',buildId:id,input:{resume:person.resume,role,jobDescription:fixtures.posting,applicationType:'private',additionalDetails:''},consent:true,storageConsent:true})).status,200);
 const result=await server.run(person.id,{action:'run',buildId:id,consent:true});assert.equal(result.status,200,JSON.stringify(result));return {id,review:result.data.review};
}
test('88M applicants receive distinct duty-supported careers, independent of a target role',async()=>{
 const server=createEvidenceProgram();for(const person of fixtures.applicants){const result=await server.run(person.id,{action:'career-assess-saved',resumeId:'source-88m',consent:true});assert.equal(result.status,200);assert.deepEqual(result.data.matches.map(m=>m.code),person.expectedCareers);for(const m of result.data.matches)assert.ok(person.resume.includes(m.evidence));assert.ok(!result.data.matches.some(m=>m.code==='vcp-software-engineer'));}
 assert.ok(server.careerInputs.every(input=>Object.keys(input).sort().join(',')==='additionalDetails,resume'));assert.equal(server.sessions.size,0);
});
test('the same paid build repairs an invented duty, asks about reports and accepts only B’s confirmed answer',async()=>{
 const server=createEvidenceProgram(),[a,b]=fixtures.applicants;
 for(const person of [a,b]){
  const {id,review}=await paidBuild(server,person);assert.equal(review.revisedResume,person.resume);assert.ok(!review.revisedResume.includes('weekly'));assert.ok(!review.revisedResume.includes('Implemented'));
  const kit=await server.run(person.id,{action:'career',buildId:id,consent:true});assert.equal(kit.status,200,JSON.stringify(kit));const reports=kit.data.kit.qualifications.find(q=>q.requirement.includes('weekly'));assert.equal(reports.status,'Needs detail');assert.equal(reports.nextAction,fixtures.reportQuestion);assert.ok(!kit.data.kit.translations.some(t=>t.civilianSkill==='ERP implementation'));
  if(person===b){const update=await server.run(b.id,{action:'refine',buildId:id,consent:true,answers:[{id:'step-0',answer:fixtures.reportAnswer}]});assert.equal(update.status,200,JSON.stringify(update));assert.ok(update.data.review.revisedResume.includes(fixtures.reportAnswer));assert.ok(!update.data.review.revisedResume.includes('Implemented'));const refreshed=await server.run(b.id,{action:'career',buildId:id,consent:true});assert.equal(refreshed.data.kit.qualifications.find(q=>q.requirement.includes('weekly')).status,'Supported');}
 }
 assert.equal(server.sessions.size,2);assert.ok(server.providerAttempts.every((p,i,all)=>p.attempt===1||all[i-1].attempt===1));
});
test('new targets preserve the master history and earlier purchased resume; another owner cannot retrieve either',async()=>{
 const server=createEvidenceProgram(),[a,b]=fixtures.applicants,master=structuredClone(server.db.records.get('profiles/'+b.id+'/resumeProgram/background'));
 const first=await paidBuild(server,b),firstBefore=structuredClone([...server.db.records].find(([path])=>path.endsWith('/builds/'+first.id))[1]);
 const second=await paidBuild(server,b,'Transport Dispatcher');assert.notEqual(first.id,second.id);assert.deepEqual(server.db.records.get('profiles/'+b.id+'/resumeProgram/background'),master);assert.deepEqual([...server.db.records].find(([path])=>path.endsWith('/builds/'+first.id))[1],firstBefore);
 for(const id of [first.id,second.id])for(const action of ['get','run','career','template-open'])assert.equal((await server.run(a.id,{action,buildId:id,design:'classic',consent:true})).status,404,action);
 server.db.records.set('profiles/'+b.id+'/resumeProgramResumes/only-b',{content:b.resume});assert.equal((await server.run(a.id,{action:'career-assess-saved',resumeId:'only-b',consent:true})).status,404);
});
