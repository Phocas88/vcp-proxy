'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createProgramHandler}=require('../api/_lib/resume-program');
const {allowGuest}=require('../api/_lib/resume-guest');
test('guest signup accepts only trusted empty requests, is rate-limited and cannot mint a chosen identity',async()=>{
 let calls=0;const handler=createProgramHandler({db:{},guestQuota:async()=>true,mintGuestToken:async uid=>{calls++;assert.match(uid,/^resumeGuest_[a-f0-9-]{36}$/);return 'fixture-custom-token';}});
 const run=async(body,origin='https://veterancareerpath.com')=>{const res={setHeader(){},status(s){this.code=s;return this;},json(d){this.data=d;return this;}};await handler({headers:{origin,'content-type':'application/json'},body},res);return res;};
 assert.equal((await run({workspace:true,action:'guest',uid:'victim'})).code,400);
 assert.equal((await run({workspace:true,action:'guest',input:{resume:'private'}})).code,400);
 assert.equal((await run({workspace:true,action:'guest'},'https://evil.example')).code,403);assert.equal(calls,0);
 const ok=await run({workspace:true,action:'guest'});assert.equal(ok.code,200);assert.equal(ok.data.token,'fixture-custom-token');assert.equal(calls,1);
});
test('guest abuse counters store a hash and bounded count, with no raw address or resume',async()=>{
 let record,storedKey;const db={collection(name){assert.equal(name,'_privateResumeGuestLimits');return {doc(key){storedKey=key;return {};}};},async runTransaction(fn){return fn({get:async()=>({exists:!!record,data:()=>record}),set:(_,value)=>{record=value;}});}};
 for(let i=0;i<10;i++)assert.equal(await allowGuest(db,'fictional-address',1000),true);
 assert.equal(await allowGuest(db,'fictional-address',1000),false);assert.match(storedKey,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(record).includes('fictional-address'));assert.equal(await allowGuest(db,'fictional-address',3601001),true);
});
