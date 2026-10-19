'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createProgramHandler,checkPayment,PRICE,PRODUCT}=require('../api/_lib/resume-program');
const {consumeQuota}=require('../api/_lib/resume-workspace');
const input={resume:'ALEX EXAMPLE\nMILITARY EXPERIENCE\nSupply specialist\nU.S. Navy\nMaintained accurate equipment records and trained colleagues on inventory processes.',applicationType:'federal',role:'Logistics specialist'};
const review={score:70,summary:'Clearer duties.',strengths:[],findings:[],suggestions:[],nextSteps:[],revisedResume:input.resume,rewriteNotes:[]};
function memoryDb(){const records=new Map();let queue=Promise.resolve();const ref=path=>({path,id:path.split('/').at(-1),collection:k=>ref(path+'/'+k),doc:k=>ref(path+'/'+k),orderBy(){return this;},limit(){return this;},async get(){return {exists:records.has(path),data:()=>structuredClone(records.get(path)),docs:[...records].filter(([k])=>k.startsWith(path+'/')).map(([k,v])=>({id:k.split('/').at(-1),data:()=>structuredClone(v)}))};},async update(d){records.set(path,{...records.get(path),...structuredClone(d)});}});return {records,collection:k=>ref(k),runTransaction(fn){const run=queue.then(()=>fn({get:r=>r.get(),set:(r,d)=>records.set(r.path,structuredClone(d)),update:(r,d)=>records.set(r.path,{...records.get(r.path),...structuredClone(d)})}));queue=run.catch(()=>{});return run;}};}
function setup(options={}){const db=memoryDb(),sessions=new Map(),keys=new Map(),checkoutBodies=[];let calls=0,checkouts=0,clock=1000000;const stripe={async stripePost(path,body,key,signal,idempotency,apiVersion){assert.equal(apiVersion,'2024-06-20');if(path.endsWith('/expire')){const s=sessions.get(path.split('/')[4]);s.status='expired';return s;}checkoutBodies.push(body);assert.equal(body.line_items[0].price_data.unit_amount,199);assert.equal(body.line_items[0].price_data.currency,'usd');assert.equal(body.mode,'payment');assert.equal(body.allow_promotion_codes,true);assert.ok(!JSON.stringify(body).includes(input.resume));assert.ok(idempotency.startsWith('resume-program-'));if(keys.has(idempotency))return keys.get(idempotency);checkouts++;const s={id:'cs_test_'+checkouts,url:'https://checkout.stripe.com/c/pay/test_'+checkouts,status:'open',mode:'payment',payment_status:'unpaid',allow_promotion_codes:body.allow_promotion_codes,amount_subtotal:PRICE,amount_total:PRICE,total_details:{amount_discount:0,amount_shipping:0,amount_tax:0},currency:'usd',client_reference_id:body.client_reference_id,metadata:body.metadata};sessions.set(s.id,s);keys.set(idempotency,s);return s;},async stripeGet(path,key,signal,apiVersion){assert.equal(apiVersion,'2024-06-20');const id=path.split('/').at(-1).split('?')[0];return structuredClone(sessions.get(id));}};
 const handler=createProgramHandler({db,stripe,stripeKey:'test-placeholder',now:()=>clock,verifyIdToken:async token=>{if(!['owner-a','owner-b'].includes(token))throw new Error('invalid');return {uid:token};},quota:async()=>true,generate:async value=>{calls++;assert.deepEqual(value.resume,input.resume);return review;},...options});
 return {db,sessions,checkoutBodies,calls:()=>calls,checkouts:()=>checkouts,tick:n=>clock+=n,paid(){for(const s of sessions.values()){s.status='complete';s.payment_status='paid';}},async run(action,body={},headers={}){const res={code:200,setHeader(){},status(c){this.code=c;return this;},json(d){this.data=d;return this;}};await handler({headers:{origin:'https://veterancareerpath.com','content-type':'application/json','x-vcp-firebase-token':'owner-a',...headers},body:{workspace:true,action,...body}},res);return res;},async prepare(){const r=await this.run('prepare',{input,consent:true,storageConsent:true});assert.equal(r.code,200,JSON.stringify(r.data));return r.data.id;}};
}
test('free program identity and both agreements are required; no membership or access-code token is needed',async()=>{const s=setup();for(const headers of [{'x-vcp-firebase-token':''},{'x-vcp-firebase-token':'forged'},{origin:'https://evil.example'}])assert.ok((await s.run('prepare',{input,consent:true,storageConsent:true},headers)).code>=400);assert.equal((await s.run('prepare',{input,consent:true})).code,400);assert.equal((await s.run('prepare',{input:{resume:'short'},consent:true,storageConsent:true})).code,400);assert.equal(s.checkouts(),0);await s.prepare();assert.equal(s.checkouts(),1);assert.equal(s.calls(),0);});
test('only a Stripe-verified $1.99 USD purchase unlocks its owner and fixed input',async()=>{const s=setup();const id=await s.prepare();assert.equal((await s.run('run',{buildId:id,consent:true,paid:true,amount:1})).code,402);assert.equal((await s.run('get',{buildId:id},{'x-vcp-firebase-token':'owner-b'})).code,404);s.paid();const paid=structuredClone([...s.sessions.values()][0]);for(const patch of [{amount_total:100},{currency:'eur'},{metadata:{...paid.metadata,uid:'owner-b'}},{metadata:{...paid.metadata,product:'resume-pro'}},{client_reference_id:'other'},{mode:'subscription'},{payment_intent:{latest_charge:{refunded:true}}}])assert.equal(checkPayment({...paid,...patch},'owner-a',id,paid.id),false);const done=await s.run('run',{buildId:id,consent:true,input:{resume:'tampered'}});assert.equal(done.code,200);assert.equal(done.data.review.revisedResume,input.resume);assert.equal(s.calls(),1);assert.equal((await s.run('run',{buildId:id,consent:true})).code,200);assert.equal(s.calls(),1);});
test('duplicate prepare reuses checkout, completed builds reopen free, changed contexts are separate purchases',async()=>{const s=setup();const ids=await Promise.all([s.prepare(),s.prepare()]);assert.equal(ids[0],ids[1]);assert.equal(s.checkouts(),1);s.paid();await s.run('run',{buildId:ids[0],consent:true});const existing=await s.run('prepare',{input,consent:true,storageConsent:true});assert.equal(existing.data.status,'complete');assert.equal(s.checkouts(),1);const changed=await s.run('prepare',{input:{...input,role:'New target'},consent:true,storageConsent:true});assert.notEqual(changed.data.id,ids[0]);assert.equal(s.checkouts(),2);});
test('failed AI and missing rewrites leave paid attempts retryable with no extra charge',async()=>{let attempts=0;const s=setup({generate:async()=>{attempts++;if(attempts===1)throw new Error('provider unavailable');if(attempts===2)return {...review,revisedResume:''};return review;}});const id=await s.prepare();s.paid();for(let i=0;i<2;i++)assert.equal((await s.run('run',{buildId:id,consent:true})).code,503);assert.equal((await s.run('get',{buildId:id})).data.status,'paid');assert.equal((await s.run('run',{buildId:id,consent:true})).code,200);assert.equal(s.checkouts(),1);assert.equal(attempts,3);});
test('concurrent runs cannot execute twice; an abandoned execution lease becomes recoverable',async()=>{let release,started;const gate=new Promise(r=>release=r),begin=new Promise(r=>started=r);let count=0;const s=setup({generate:async()=>{count++;started();await gate;return review;}});const id=await s.prepare();s.paid();const first=s.run('run',{buildId:id,consent:true});await begin;assert.equal((await s.run('run',{buildId:id,consent:true})).code,409);assert.equal((await s.run('delete',{buildId:id})).code,409);release();assert.equal((await first).code,200);assert.equal(count,1);
 const path=[...s.db.records.keys()][0];const record=s.db.records.get(path);s.db.records.set(path,{...record,status:'running',lease:'expired',leaseUntil:1});assert.equal((await s.run('run',{buildId:id,consent:true})).code,200);assert.equal(count,2);});
test('purchase data deletion removes private text/results and cannot reissue deleted builds',async()=>{const s=setup();const id=await s.prepare();s.paid();await s.run('run',{buildId:id,consent:true});assert.equal((await s.run('delete',{buildId:id})).code,200);const d=[...s.db.records.values()][0];assert.equal(d.input,null);assert.equal(d.result,null);assert.equal((await s.run('get',{buildId:id})).code,410);assert.equal((await s.run('prepare',{input,consent:true,storageConsent:true})).code,409);assert.equal((await s.run('list')).data.builds.length,0);});
test('expired unpaid checkout can be replaced without reusing a paid purchase',async()=>{const s=setup();const id=await s.prepare();[...s.sessions.values()][0].status='expired';assert.equal(await s.prepare(),id);assert.equal(s.checkouts(),2);s.paid();assert.equal((await s.run('run',{buildId:id,consent:true})).code,200);});
test('shared quota remains atomic across function instances',async()=>{let doc=null;const db={collection(){return {doc(){return {};}};},async runTransaction(fn){return fn({get:async()=>({exists:!!doc,data:()=>doc}),set:(_,d)=>doc=d});}};for(let i=0;i<10;i++)assert.equal(await consumeQuota(db,'owner',1000),true);assert.equal(await consumeQuota(db,'owner',1000),false);assert.equal(await consumeQuota(db,'owner',901001),true);});

test('Stripe credential errors never expose provider messages or secret fragments',async()=>{
 const s=setup({stripe:{stripePost:async()=>{throw Object.assign(new Error('Invalid API key: private-fragment'),{status:401});}}});
 const r=await s.run('prepare',{input,consent:true,storageConsent:true});assert.equal(r.code,503);assert.ok(!JSON.stringify(r.data).includes('private-fragment'));
});

test('company checkout returns to the branded resume URL and standalone checkout retains its own origin',async()=>{
 for(const origin of ['https://veterancareerpath.com','https://www.veterancareerpath.com','https://mobile-resume-review-app.vercel.app']){
  const s=setup();const r=await s.run('prepare',{input,consent:true,storageConsent:true},{origin});assert.equal(r.code,200);
  const body=s.checkoutBodies[0],path=origin.includes('mobile-resume-review-app')?'/index.html':'/resumereview/';
  for(const key of ['success_url','cancel_url']){const url=new URL(body[key]);assert.equal(url.origin,origin);assert.equal(url.pathname,path);assert.equal(url.searchParams.get('build'),r.data.id);}
  assert.equal(new URL(body.success_url).searchParams.get('checkout'),'success');assert.equal(new URL(body.cancel_url).searchParams.get('checkout'),'canceled');
 }
});

test('Stripe-confirmed full and partial discounts unlock only their original owner and input',async()=>{
 for(const amount of [0,100]){
  const s=setup(),id=await s.prepare(),session=[...s.sessions.values()][0];
  Object.assign(session,{status:'complete',amount_total:amount,total_details:{amount_discount:PRICE-amount,amount_shipping:0,amount_tax:0},payment_status:amount===0?'no_payment_required':'paid',payment_intent:null});
  assert.equal((await s.run('run',{buildId:id,consent:true},{'x-vcp-firebase-token':'owner-b'})).code,404);
  const prepared=await s.run('prepare',{input,consent:true,storageConsent:true});
  assert.equal(prepared.data.status,'paid');assert.equal(prepared.data.amount,amount);
  const done=await s.run('run',{buildId:id,consent:true,input:{resume:'forged'}});
  assert.equal(done.code,200);assert.equal(done.data.review.revisedResume,input.resume);assert.equal(s.calls(),1);
  const history=(await s.run('list')).data.builds[0];
  assert.equal(history.amount,amount);assert.equal(history.discountAmount,PRICE-amount);
  assert.equal((await s.run('run',{buildId:id,consent:true})).code,200);assert.equal(s.calls(),1);assert.equal(s.checkouts(),1);
 }
});

test('incomplete, forged or inconsistent zero and discounted totals never grant a build',async()=>{
 const s=setup(),id=await s.prepare(),session=[...s.sessions.values()][0];
 assert.equal((await s.run('run',{buildId:id,consent:true,coupon:'FREE',amount:0,payment_status:'no_payment_required'})).code,402);
 const free={...session,status:'complete',amount_total:0,total_details:{amount_discount:PRICE},payment_status:'no_payment_required',payment_intent:null};
 assert.equal(checkPayment(free,'owner-a',id,session.id),true);
 for(const patch of [
  {status:'open'},{status:'expired'},{payment_status:'unpaid'},{payment_status:'paid'},
  {amount_total:1},{amount_total:-1},{amount_total:200},{amount_total:0.5},
  {amount_subtotal:0},{amount_subtotal:198},{amount_subtotal:undefined},
  {total_details:{amount_discount:0}},{total_details:{amount_discount:198}},{total_details:null},
  {currency:'eur'},{metadata:{...free.metadata,uid:'owner-b'}},{id:'cs_other'},
  {payment_intent:{latest_charge:{refunded:true}}}
 ])assert.equal(checkPayment({...free,...patch},'owner-a',id,session.id),false,JSON.stringify(patch));
 assert.equal(s.calls(),0);
});

test('free builds retry provider failures without another checkout or code redemption',async()=>{
 let attempts=0;const s=setup({generate:async()=>{if(++attempts===1)throw new Error('provider unavailable');return review;}});
 const id=await s.prepare(),session=[...s.sessions.values()][0];
 Object.assign(session,{status:'complete',payment_status:'no_payment_required',amount_total:0,total_details:{amount_discount:PRICE},payment_intent:null});
 assert.equal((await s.run('run',{buildId:id,consent:true})).code,503);
 const saved=(await s.run('get',{buildId:id})).data;
 assert.equal(saved.status,'paid');assert.equal(saved.amount,0);
 assert.equal((await s.run('run',{buildId:id,consent:true})).code,200);assert.equal(s.checkouts(),1);assert.equal(attempts,2);
});

test('old unpaid checkouts are expired and replaced once with promo-enabled checkout',async()=>{
 const s=setup(),id=await s.prepare(),old=[...s.sessions.values()][0];old.allow_promotion_codes=null;
 assert.equal(await s.prepare(),id);assert.equal(old.status,'expired');assert.equal(s.checkouts(),2);
 const current=[...s.sessions.values()][1];assert.equal(current.allow_promotion_codes,true);
 await s.prepare();assert.equal(s.checkouts(),2);
});

test('old completed full-price checkout is recovered without replacement',async()=>{
 const s=setup(),id=await s.prepare(),old=[...s.sessions.values()][0];old.allow_promotion_codes=null;s.paid();
 const r=await s.run('prepare',{input,consent:true,storageConsent:true});
 assert.equal(r.data.status,'paid');assert.equal(s.checkouts(),1);assert.equal((await s.run('run',{buildId:id,consent:true})).code,200);
});
