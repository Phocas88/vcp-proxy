'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createProgramHandler}=require('../api/_lib/resume-program');
const {deleteSavedTemplate}=require('../api/_lib/resume-delete');
const id='a'.repeat(64),root='_privateResumeProgramUsers/owner/builds/'+id,mirror='profiles/owner/resumeProgramResumes/finished-'+id+'-';
function fixture(){
 const records=new Map([[root,{status:'complete',sessionId:'receipt',createdAt:1,templates:['classic','modern'],includedTemplate:'classic',input:{resume:'Original submitted text'}}],[root+'/finishedResumes/classic',{document:{resume:'Classic document'},careerAssessmentV2:{matches:['private']}}],[root+'/finishedResumes/modern',{document:{resume:'Other document'}}],[mirror+'classic',{content:'Classic mirror'}],[mirror+'modern',{content:'Other mirror'}]]);
 const ref=path=>({path,collection:key=>ref(path+'/'+key),doc:key=>ref(path+'/'+key),get:async()=>({exists:records.has(path),data:()=>records.get(path)})});
 const db={collection:ref,runTransaction:async run=>run({get:r=>r.get(),update:(r,patch)=>records.set(r.path,{...records.get(r.path),...patch}),delete:r=>records.delete(r.path)})};
 const handler=createProgramHandler({db,verifyIdToken:async uid=>({uid}),now:()=>1000,stripe:{stripeGet:async()=>{throw new Error('Deletion must not request a checkout');}}});
 return {records,db,ref:ref(root),async run(body={},uid='owner'){const res={status(code){this.code=code;return this;},setHeader(){},json(data){this.body=data;return this;}};await handler({method:'POST',headers:{origin:'https://veterancareerpath.com','content-type':'application/json','x-vcp-firebase-token':uid},body:{workspace:true,action:'resume-delete',buildId:id,design:'classic',...body}},res);return res;}};
}
test('delete removes one finished template and assessment plus mirror, preserving other documents and receipt',async()=>{
 const f=fixture(),r=await f.run();assert.equal(r.code,200);assert.equal(f.records.has(root+'/finishedResumes/classic'),false);assert.equal(f.records.has(mirror+'classic'),false);assert.ok(f.records.has(root+'/finishedResumes/modern'));assert.ok(f.records.has(mirror+'modern'));assert.equal(f.records.get(root).sessionId,'receipt');assert.equal(f.records.get(root).input.resume,'Original submitted text');assert.deepEqual(f.records.get(root).deletedTemplates,['classic']);
});
test('repeated deletion is idempotent and cannot add duplicate deletion markers',async()=>{
 const f=fixture();await f.run();assert.equal((await f.run()).code,200);assert.deepEqual(f.records.get(root).deletedTemplates,['classic']);
});
test('delete lookup is scoped to the authenticated owner, never a client owner ID',async()=>{
 const f=fixture();assert.equal((await f.run({ownerId:'owner'},'other')).code,404);assert.ok(f.records.has(root+'/finishedResumes/classic'));
});
test('unknown, unowned and path-like template IDs cannot delete an existing document',async()=>{
 const f=fixture();assert.equal((await f.run({design:'../../classic'})).code,400);assert.equal((await f.run({design:'creative'})).code,404);assert.ok(f.records.has(root+'/finishedResumes/classic'));
});
test('deleting a running or already deleted purchase cannot remove another saved template',async()=>{
 const f=fixture();f.records.set(root,{...f.records.get(root),status:'running',leaseUntil:2000});assert.equal((await f.run()).code,409);f.records.set(root,{...f.records.get(root),status:'deleted'});await assert.rejects(()=>deleteSavedTemplate({db:f.db,ref:f.ref,uid:'owner',id,design:'classic',now:()=>1000}),e=>e.status===410);assert.ok(f.records.has(root+'/finishedResumes/classic'));
});
