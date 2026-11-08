'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createEvidenceProgram,fixtures}=require('./helpers/evidence-program.cjs');
async function prepare(server,person=fixtures.applicants[1]){
 const purchased=await server.run(person.id,{action:'purchase',requestId:crypto.randomUUID(),entryMode:'edit',storageConsent:true}),id=purchased.data.id;
 for(const request of [{action:'verify'},{action:'bind',input:{resume:person.resume,role:'Fleet Coordinator',jobDescription:fixtures.posting,applicationType:'private',additionalDetails:''},consent:true,storageConsent:true},{action:'run',consent:true}])assert.equal((await server.run(person.id,{buildId:id,...request})).status,200);
 const result=await server.run(person.id,{action:'career',buildId:id,consent:true});assert.equal(result.status,200);
 const index=result.data.kit.qualifications.findIndex(q=>q.requirement.includes('weekly')),question=result.data.kit.qualifications[index];
 return {id,person,answer:{id:'job-'+index,question:question.nextAction,requirement:question.requirement,answer:fixtures.reportAnswer},record:[...server.db.records].find(([p])=>p.endsWith('/builds/'+id))[1]};
}
test('job-match answers are bound to the owned comparison and update the same purchased resume',async()=>{
 const server=createEvidenceProgram(),{id,person,answer}=await prepare(server),master=structuredClone(server.db.records.get('profiles/'+person.id+'/resumeProgram/background'));
 const update=await server.run(person.id,{action:'refine',buildId:id,consent:true,answers:[answer]});assert.equal(update.status,200,JSON.stringify(update));assert.ok(update.data.review.revisedResume.includes(fixtures.reportAnswer));
 const record=[...server.db.records].find(([p])=>p.endsWith('/builds/'+id))[1];assert.equal(record.answers[0].question,fixtures.reportQuestion);assert.ok(!record.clarificationDetails.includes(answer.requirement));assert.ok(!record.clarificationDetails.includes(answer.question));assert.ok(record.clarificationDetails.includes(fixtures.reportAnswer));
 assert.equal(record.refinementCount,1);assert.equal(server.sessions.size,1);assert.deepEqual(server.db.records.get('profiles/'+person.id+'/resumeProgram/background'),master);
 assert.equal((await server.run(person.id,{action:'refine',buildId:id,consent:true,answers:[answer]})).status,409);
});
test('stale, supported, invented or altered job questions cannot authorize an update',async()=>{
 const server=createEvidenceProgram(),{id,person,answer,record}=await prepare(server);
 for(const changed of [{...answer,id:'job-99'},{...answer,id:'job-03'},{...answer,question:'Invented question?'},{...answer,requirement:'Invented requirement.'},{...answer,id:'job-0'}])assert.equal((await server.run(person.id,{action:'refine',buildId:id,consent:true,answers:[changed]})).status,400);
 record.careerRevision=99;assert.equal((await server.run(person.id,{action:'refine',buildId:id,consent:true,answers:[answer]})).status,400);record.careerRevision=0;
 record.careerProofVersion='old';assert.equal((await server.run(person.id,{action:'refine',buildId:id,consent:true,answers:[answer]})).status,400);
 assert.equal(server.sessions.size,1);assert.equal(record.refinementCount||0,0);
 assert.equal((await server.run(fixtures.applicants[0].id,{action:'refine',buildId:id,consent:true,answers:[answer]})).status,404);
});
test('skipped and negative job answers do not insert posting requirements or reporting into the resume',async()=>{
 const server=createEvidenceProgram(),{id,person,answer}=await prepare(server);
 assert.equal((await server.run(person.id,{action:'refine',buildId:id,consent:true,answers:[]})).status,400);
 const result=await server.run(person.id,{action:'refine',buildId:id,consent:true,answers:[{...answer,answer:'No, I did not prepare or export reports.'}]});assert.equal(result.status,200,JSON.stringify(result));assert.ok(!result.data.review.revisedResume.includes('weekly'));
 const stored=[...server.db.records].find(([p])=>p.endsWith('/builds/'+id))[1];assert.ok(!stored.clarificationDetails.includes(answer.requirement));assert.equal(server.sessions.size,1);
});
