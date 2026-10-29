'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createProgramHandler,checkPayment,PRICE,PRODUCT}=require('../api/_lib/resume-program');
const {consumeQuota}=require('../api/_lib/resume-workspace');
const input={resume:'ALEX EXAMPLE\nMILITARY EXPERIENCE\nSupply specialist\nU.S. Navy\nMaintained accurate equipment records and trained colleagues on inventory processes.',applicationType:'federal',role:'Logistics specialist'};
const review={score:70,summary:'Clearer duties.',strengths:[],findings:[],suggestions:[],nextSteps:[],revisedResume:input.resume,rewriteNotes:[]};

const prepaidRequest={requestId:'12345678-1234-1234-1234-123456789012',entryMode:'build',storageConsent:true};
async function prepaid(s){const r=await s.run('purchase',prepaidRequest);assert.equal(r.code,200,JSON.stringify(r.data));return r.data.id;}
test('upfront checkout requires no resume; duplicate clicks reuse it and unpaid owners cannot bind or build',async()=>{
 const s=setup(),id=await prepaid(s);assert.equal(await prepaid(s),id);assert.equal(s.checkouts(),1);assert.equal(s.calls(),0);
 assert.equal((await s.run('get',{buildId:id})).data.input,null);
 assert.equal((await s.run('purchase',{...prepaidRequest,storageConsent:false})).code,400);
 assert.equal((await s.run('purchase',{...prepaidRequest,entryMode:'invalid'})).code,400);
 assert.equal((await s.run('verify',{buildId:id})).code,402);
 assert.equal((await s.run('bind',{buildId:id,input,consent:true,storageConsent:true})).code,402);
 assert.equal((await s.run('run',{buildId:id,consent:true})).code,400);
 assert.equal((await s.run('verify',{buildId:id},{'x-vcp-firebase-token':'owner-b'})).code,404);
});
test('verified full-price and free prepaid purchases bind one fixed resume and recover without another checkout',async()=>{
 for(const amount of [0,PRICE]){
  const s=setup(),id=await prepaid(s),session=[...s.sessions.values()][0];
  Object.assign(session,{status:'complete',payment_status:amount===0?'no_payment_required':'paid',amount_total:amount,total_details:{amount_discount:PRICE-amount}});
  const verified=await s.run('verify',{buildId:id});assert.equal(verified.code,200);assert.equal(verified.data.prepaid,true);assert.equal(verified.data.amount,amount);assert.equal(verified.data.input,null);
  assert.equal((await s.run('bind',{buildId:id,input,consent:true})).code,400);
  assert.equal((await s.run('bind',{buildId:id,input,consent:true,storageConsent:true})).code,200);
  assert.equal((await s.run('bind',{buildId:id,input,consent:true,storageConsent:true})).code,200);
  assert.equal((await s.run('bind',{buildId:id,input:{...input,role:'Different role'},consent:true,storageConsent:true})).code,409);
  const done=await s.run('run',{buildId:id,consent:true});assert.equal(done.code,200);assert.equal(done.data.review.submittedResume,input.resume);
  assert.equal((await s.run('run',{buildId:id,consent:true})).code,200);assert.equal(s.calls(),1);assert.equal(s.checkouts(),1);
 }
});
test('refunded purchases do not unlock the builder or accept a resume',async()=>{
 const s=setup(),id=await prepaid(s);s.paid();[...s.sessions.values()][0].payment_intent={latest_charge:{refunded:true}};
 assert.equal((await s.run('verify',{buildId:id})).code,402);assert.equal((await s.run('bind',{buildId:id,input,consent:true,storageConsent:true})).code,402);assert.equal(s.calls(),0);
});
test('one included clarification update uses server-owned questions, preserves the submitted source and charges nothing extra',async()=>{
 let generated;
 const initial={...review,findings:[{priority:'High',title:'Hours missing',evidence:'Supply specialist',action:'What were your verified hours per week?'}],nextSteps:['Which inventory system did you use?']};
 const s=setup({generate:async value=>{generated=value;return initial;}}),id=await s.prepare();s.paid();await s.run('run',{buildId:id,consent:true});
 const answers=[{id:'finding-0',answer:'Supply specialist: 40 hours per week.'},{id:'step-0',answer:'Used the Navy supply system.'},{id:'extra-0',context:'Supply specialist',answer:'Trained three colleagues.'}];
 const refined=await s.run('refine',{buildId:id,answers,consent:true});assert.equal(refined.code,200);assert.equal(refined.data.review.refinementCount,1);assert.equal(refined.data.review.submittedResume,input.resume);
 assert.match(generated.additionalDetails,/What were your verified hours per week/);assert.match(generated.additionalDetails,/40 hours/);assert.match(generated.additionalDetails,/Trained three colleagues/);
 const saved=(await s.run('get',{buildId:id})).data;assert.deepEqual(saved.answers,answers);assert.equal(saved.input.resume,input.resume);
 const duplicate=await s.run('refine',{buildId:id,answers,consent:true});assert.equal(duplicate.code,409);assert.equal(duplicate.data.errorCode,'CLARIFICATION_UPDATE_USED');assert.equal(s.checkouts(),1);
 await s.run('delete',{buildId:id});const record=[...s.db.records.values()][0];assert.equal(record.answers,null);assert.equal(record.clarificationDetails,null);
});
test('invalid clarification answers cannot consume the included update',async()=>{
 const initial={...review,nextSteps:['Which role do these hours belong to?']};
 const s=setup({generate:async()=>initial}),id=await s.prepare();s.paid();await s.run('run',{buildId:id,consent:true});
 for(const answers of [[],[{id:'step-9',answer:'Forged question'}],[{id:'step-0',answer:'x'.repeat(1001)}],[{id:'extra-0',answer:'Missing context'}],[{id:'step-0',answer:'One'},{id:'step-0',answer:'Two'}],[{id:'step-0',answer:'Fact',context:4}]])assert.equal((await s.run('refine',{buildId:id,answers,consent:true})).code,400);
 assert.equal((await s.run('get',{buildId:id})).data.refinementCount,0);assert.equal(s.checkouts(),1);
});
test('a failed clarification update retains the first result and can retry without another payment',async()=>{
 let calls=0;const initial={...review,nextSteps:['Which system did you use?']};
 const s=setup({generate:async()=>{if(++calls===2)throw new Error('Temporary outage');return initial;}}),id=await s.prepare();s.paid();await s.run('run',{buildId:id,consent:true});
 const answers=[{id:'step-0',answer:'Supply tracking system'}];
 assert.equal((await s.run('refine',{buildId:id,answers,consent:true})).code,503);
 let saved=(await s.run('get',{buildId:id})).data;assert.equal(saved.status,'complete');assert.equal(saved.refinementCount,0);assert.equal(saved.review.revisedResume,input.resume);assert.ok(saved.lastError);
 assert.equal((await s.run('refine',{buildId:id,answers,consent:true})).code,200);
 saved=(await s.run('get',{buildId:id})).data;assert.equal(saved.refinementCount,1);assert.equal(saved.lastError,null);assert.equal(s.checkouts(),1);assert.equal(calls,3);
});

test('long reviews send JSON whitespace immediately and periodically, then save one result',async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 let release,started,writes=0;
 const gate=new Promise(r=>release=r),begin=new Promise(r=>started=r);
 const s=setup({onWrite:()=>writes++,generate:async()=>{started();await gate;return review;}});
 const id=await s.prepare();s.paid();
 const pending=s.run('run',{buildId:id,consent:true,keepAlive:true});await begin;
 assert.equal(writes,1);t.mock.timers.tick(15000);assert.equal(writes,4);
 assert.equal((await s.run('get',{buildId:id})).data.status,'running');
 assert.equal((await s.run('run',{buildId:id,consent:true,keepAlive:true})).code,409);
 release();const result=await pending;
 assert.equal(result.code,200);assert.equal(result.data.httpStatus,200);assert.deepEqual(result.data.review,{...review,submittedResume:input.resume,refinementCount:0});
 assert.deepEqual((await s.run('get',{buildId:id})).data.review,{...review,submittedResume:input.resume,refinementCount:0});
 t.mock.timers.tick(15000);assert.equal(writes,4);assert.equal(s.checkouts(),1);
});

test('streamed provider failures retain safe diagnostics for read-only recovery and a manual retry clears them',async()=>{
 let attempt=0;
 const s=setup({generate:async()=>{if(++attempt===1)throw Object.assign(new Error('private-secret-resume'),{diagnosticCode:'AI_AUTHENTICATION'});return review;}});
 const id=await s.prepare();s.paid();
 const failed=await s.run('run',{buildId:id,consent:true,keepAlive:true});
 assert.equal(failed.code,200);assert.equal(failed.data.httpStatus,503);assert.equal(failed.data.errorCode,'AI_AUTHENTICATION');
 const saved=(await s.run('get',{buildId:id})).data;
 assert.equal(saved.lastError.errorCode,'AI_AUTHENTICATION');assert.equal(saved.lastError.status,503);assert.equal(saved.status,'paid');
 assert.ok(!JSON.stringify(saved).includes('private-secret-resume'));
 assert.equal((await s.run('get',{buildId:id},{'x-vcp-firebase-token':'owner-b'})).code,404);
 assert.equal((await s.run('run',{buildId:id,consent:true,keepAlive:true})).data.httpStatus,200);
 assert.equal((await s.run('get',{buildId:id})).data.lastError,null);assert.equal(attempt,2);assert.equal(s.checkouts(),1);
});

test('a disconnected response still leaves the completed resume recoverable',async()=>{
 const s=setup({onWrite:res=>{res.destroyed=true;}}),id=await s.prepare();s.paid();
 await s.run('run',{buildId:id,consent:true,keepAlive:true});
 const saved=(await s.run('get',{buildId:id})).data;
 assert.equal(saved.status,'complete');assert.deepEqual(saved.review,{...review,submittedResume:input.resume,refinementCount:0});assert.equal(s.calls(),1);
});
function memoryDb(){const records=new Map();let queue=Promise.resolve();const ref=path=>({path,id:path.split('/').at(-1),collection:k=>ref(path+'/'+k),doc:k=>ref(path+'/'+k),orderBy(){return this;},limit(){return this;},async get(){return {exists:records.has(path),data:()=>structuredClone(records.get(path)),docs:[...records].filter(([k])=>k.startsWith(path+'/')).map(([k,v])=>({id:k.split('/').at(-1),data:()=>structuredClone(v)}))};},async delete(){records.delete(path);},async update(d){records.set(path,{...records.get(path),...structuredClone(d)});}});return {records,collection:k=>ref(k),runTransaction(fn){const run=queue.then(()=>fn({get:r=>r.get(),set:(r,d)=>records.set(r.path,structuredClone(d)),update:(r,d)=>records.set(r.path,{...records.get(r.path),...structuredClone(d)})}));queue=run.catch(()=>{});return run;}};}
function setup(options={}){const db=memoryDb(),sessions=new Map(),keys=new Map(),checkoutBodies=[];let calls=0,checkouts=0,clock=1000000;const stripe={async stripePost(path,body,key,signal,idempotency,apiVersion){assert.equal(apiVersion,'2024-06-20');if(path.endsWith('/expire')){const s=sessions.get(path.split('/')[4]);s.status='expired';return s;}checkoutBodies.push(body);assert.ok([199,100].includes(body.line_items[0].price_data.unit_amount));assert.equal(body.line_items[0].price_data.currency,'usd');assert.equal(body.mode,'payment');assert.equal(body.allow_promotion_codes,true);assert.ok(!JSON.stringify(body).includes(input.resume));assert.ok(idempotency.startsWith('resume-program-'));if(keys.has(idempotency))return keys.get(idempotency);checkouts++;const s={id:'cs_test_'+checkouts,url:'https://checkout.stripe.com/c/pay/test_'+checkouts,status:'open',mode:'payment',payment_status:'unpaid',allow_promotion_codes:body.allow_promotion_codes,amount_subtotal:body.line_items[0].price_data.unit_amount,amount_total:body.line_items[0].price_data.unit_amount,total_details:{amount_discount:0,amount_shipping:0,amount_tax:0},currency:'usd',client_reference_id:body.client_reference_id,metadata:body.metadata};sessions.set(s.id,s);keys.set(idempotency,s);return s;},async stripeGet(path,key,signal,apiVersion){assert.equal(apiVersion,'2024-06-20');const id=path.split('/').at(-1).split('?')[0];return structuredClone(sessions.get(id));}};
 const handler=createProgramHandler({db,stripe,stripeKey:'test-placeholder',now:()=>clock,verifyIdToken:async token=>{if(!['owner-a','owner-b'].includes(token))throw new Error('invalid');return {uid:token};},quota:async()=>true,generate:async value=>{calls++;assert.deepEqual(value.resume,input.resume);return review;},...options});
 return {db,sessions,checkoutBodies,calls:()=>calls,checkouts:()=>checkouts,tick:n=>clock+=n,paid(){for(const s of sessions.values()){s.status='complete';s.payment_status='paid';}},async run(action,body={},headers={}){const res={code:200,chunks:[],setHeader(){},status(c){this.code=c;return this;},json(d){this.data=d;return this;},write(chunk){this.chunks.push(chunk);options.onWrite?.(this);},end(chunk){this.chunks.push(chunk);this.data=JSON.parse(this.chunks.join(''));this.writableEnded=true;}};await handler({headers:{origin:'https://veterancareerpath.com','content-type':'application/json','x-vcp-firebase-token':'owner-a',...headers},body:{workspace:true,action,...body}},res);return res;},async prepare(){const r=await this.run('prepare',{input,consent:true,storageConsent:true});assert.equal(r.code,200,JSON.stringify(r.data));return r.data.id;}};
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

test('a completed fully discounted order reported paid recovers without another checkout or coupon',async()=>{
 for(const recoverThroughPrepare of [false,true]){
  const s=setup(),id=await s.prepare(),session=[...s.sessions.values()][0];
  Object.assign(session,{status:'complete',payment_status:'paid',amount_total:0,total_details:{amount_discount:PRICE,amount_shipping:0,amount_tax:0},payment_intent:null});
  assert.equal(checkPayment(session,'owner-a',id,session.id),true);
  if(recoverThroughPrepare){
   const recovered=await s.run('prepare',{input,consent:true,storageConsent:true});
   assert.equal(recovered.data.status,'paid');assert.equal(recovered.data.amount,0);assert.equal(recovered.data.url,undefined);
  }
  const done=await s.run('run',{buildId:id,consent:true});
  assert.equal(done.code,200);assert.equal(done.data.review.revisedResume,input.resume);
  assert.equal((await s.run('run',{buildId:id,consent:true})).code,200);
  const saved=(await s.run('get',{buildId:id})).data;
  assert.equal(saved.amount,0);assert.equal(saved.discountAmount,PRICE);
  assert.equal(s.calls(),1);assert.equal(s.checkouts(),1);
 }
});

test('a positive total still requires paid status and zero totals still require a settled complete order',async()=>{
 const s=setup(),id=await s.prepare(),session=[...s.sessions.values()][0];
 for(const amount of [0,100,PRICE]){
  const order={...session,amount_total:amount,total_details:{amount_discount:PRICE-amount},status:'complete',payment_intent:null};
  for(const status of ['paid','no_payment_required','unpaid',null,'unknown']){
   assert.equal(checkPayment({...order,payment_status:status},'owner-a',id,session.id),status==='paid'||(amount===0&&status==='no_payment_required'));
  }
  for(const state of ['open','expired'])assert.equal(checkPayment({...order,status:state,payment_status:'paid'},'owner-a',id,session.id),false);
 }
});

test('incomplete, forged or inconsistent zero and discounted totals never grant a build',async()=>{
 const s=setup(),id=await s.prepare(),session=[...s.sessions.values()][0];
 assert.equal((await s.run('run',{buildId:id,consent:true,coupon:'FREE',amount:0,payment_status:'no_payment_required'})).code,402);
 const free={...session,status:'complete',amount_total:0,total_details:{amount_discount:PRICE},payment_status:'no_payment_required',payment_intent:null};
 assert.equal(checkPayment(free,'owner-a',id,session.id),true);
 for(const patch of [
  {status:'open'},{status:'expired'},{payment_status:'unpaid'},{payment_status:'unknown'},
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

test('real provider adapters classify failures safely and the same free build remains retryable',async t=>{
 const previous={openai:process.env.OPENAI_API_KEY,anthropic:process.env.ANTHROPIC_API_KEY};
 t.after(()=>{for(const [key,value] of [['OPENAI_API_KEY',previous.openai],['ANTHROPIC_API_KEY',previous.anthropic]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 let provider,status,failed=true;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.equal(url,provider==='openai'?'https://api.openai.com/v1/responses':'https://api.anthropic.com/v1/messages');
  const body=JSON.parse(options.body);assert.equal(body.max_output_tokens||body.max_tokens,12000);
  if(failed)return {ok:false,status,json:async()=>({error:{type:'private-provider-type',message:'private-fragment synthetic-resume-content',code:'private-code'}})};
  return {ok:true,status:200,json:async()=>provider==='openai'?{output:[{content:[{type:'output_text',text:JSON.stringify(review)}]}]}:{content:[{type:'tool_use',name:'submit_resume_review',input:review}],stop_reason:'tool_use'}};
 });
 for(provider of ['anthropic','openai'])for(const [http,expected] of [[401,'AI_AUTHENTICATION'],[403,'AI_ACCESS'],[429,'AI_QUOTA_OR_RATE_LIMIT'],[500,'AI_PROVIDER_UNAVAILABLE']]){
  process.env.OPENAI_API_KEY=provider==='openai'?'fixture-key':'';process.env.ANTHROPIC_API_KEY='fixture-key';status=http;failed=true;
  const s=setup({generate:undefined}),id=await s.prepare(),session=[...s.sessions.values()][0];
  Object.assign(session,{status:'complete',payment_status:'paid',amount_total:0,total_details:{amount_discount:PRICE},payment_intent:null});
  const error=await s.run('run',{buildId:id,consent:true});assert.equal(error.code,503);assert.equal(error.data.errorCode,expected);
  assert.ok(!JSON.stringify(error.data).includes('private-fragment'));assert.ok(!JSON.stringify(error.data).includes('synthetic-resume-content'));
  assert.equal((await s.run('get',{buildId:id})).data.status,'paid');
  failed=false;assert.equal((await s.run('run',{buildId:id,consent:true})).code,200);assert.equal(s.checkouts(),1);
 }
});

test('provider billing exhaustion is distinguished from transient request rate limits',async t=>{
 const oldOpenAI=process.env.OPENAI_API_KEY,oldAnthropic=process.env.ANTHROPIC_API_KEY;
 t.after(()=>{for(const [key,value] of [['OPENAI_API_KEY',oldOpenAI],['ANTHROPIC_API_KEY',oldAnthropic]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 let error,http;
 t.mock.method(globalThis,'fetch',async()=>({ok:false,status:http,json:async()=>({error})}));
 for(const [provider,status,body,expected] of [
  ['anthropic',400,{type:'invalid_request_error',message:'Your credit balance is too low to access the API. private-fragment'},'AI_BILLING_LIMIT'],
  ['anthropic',429,{type:'rate_limit_error',message:'private-fragment'},'AI_RATE_LIMIT'],
  ['openai',429,{code:'insufficient_quota',message:'private-fragment'},'AI_BILLING_LIMIT'],
  ['openai',429,{code:'rate_limit_exceeded',message:'private-fragment'},'AI_RATE_LIMIT']
 ]){
  process.env.OPENAI_API_KEY=provider==='openai'?'fixture-key':'';process.env.ANTHROPIC_API_KEY='fixture-key';http=status;error=body;
  const s=setup({generate:undefined}),id=await s.prepare();s.paid();
  const r=await s.run('run',{buildId:id,consent:true});assert.equal(r.code,503);assert.equal(r.data.errorCode,expected);assert.ok(!JSON.stringify(r.data).includes('private-fragment'));
  assert.equal((await s.run('get',{buildId:id})).data.status,'paid');assert.equal(s.checkouts(),1);
 }
});

test('both provider adapters repair a rejected draft inside the same full-price or free prepaid build',async t=>{
 const previous={openai:process.env.OPENAI_API_KEY,anthropic:process.env.ANTHROPIC_API_KEY};
 t.after(()=>{for(const [key,value] of [['OPENAI_API_KEY',previous.openai],['ANTHROPIC_API_KEY',previous.anthropic]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 let provider,calls,alwaysInvalid;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  const body=JSON.parse(options.body);calls.push(body);
  const result={...review,revisedResume:alwaysInvalid||calls.length===1?input.resume+'\nInvented 77% improvement.':input.resume};
  return {ok:true,status:200,json:async()=>provider==='openai'?{output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}]}:{content:[{type:'tool_use',name:'submit_resume_review',input:result}],stop_reason:'tool_use'}};
 });
 for(provider of ['openai','anthropic'])for(const amount of [0,PRICE]){
  process.env.OPENAI_API_KEY=provider==='openai'?'fixture-key':'';process.env.ANTHROPIC_API_KEY='fixture-key';calls=[];alwaysInvalid=false;
  const s=setup({generate:undefined}),id=await prepaid(s),session=[...s.sessions.values()][0];
  Object.assign(session,{status:'complete',payment_status:amount===0?'no_payment_required':'paid',amount_total:amount,total_details:{amount_discount:PRICE-amount}});
  assert.equal((await s.run('bind',{buildId:id,input,consent:true,storageConsent:true})).code,200);
  const done=await s.run('run',{buildId:id,consent:true});assert.equal(done.code,200);assert.equal(done.data.review.revisedResume,input.resume);assert.equal(calls.length,2);assert.equal(s.checkouts(),1);
  assert.match(calls[1].instructions||calls[1].system,/previous draft failed/);
  assert.equal((await s.run('run',{buildId:id,consent:true})).code,200);assert.equal(calls.length,2);
 }
 for(provider of ['openai','anthropic']){
  process.env.OPENAI_API_KEY=provider==='openai'?'fixture-key':'';calls=[];alwaysInvalid=true;
  const s=setup({generate:undefined}),id=await prepaid(s);s.paid();await s.run('bind',{buildId:id,input,consent:true,storageConsent:true});
  const failed=await s.run('run',{buildId:id,consent:true});assert.equal(failed.code,503);assert.equal(failed.data.errorCode,'AI_REWRITE_WITHHELD');assert.equal(calls.length,2);
  assert.deepEqual(failed.data.validationDetails.unsupportedNumbers,['77%']);assert.match(failed.data.error,/numeric details/);assert.ok(!JSON.stringify(failed.data).includes('Invented 77% improvement.'));assert.ok(!JSON.stringify(failed.data).includes(input.resume));
  const saved=(await s.run('get',{buildId:id})).data;assert.equal(saved.status,'paid');assert.equal(saved.review,null);assert.equal(saved.input.resume,input.resume);assert.deepEqual(saved.lastError.validationDetails,failed.data.validationDetails);
  assert.equal((await s.run('get',{buildId:id},{'x-vcp-firebase-token':'owner-b'})).code,404);
  alwaysInvalid=false;assert.equal((await s.run('run',{buildId:id,consent:true})).code,200);assert.equal(calls.length,3);assert.equal(s.checkouts(),1);
 }
});

test('rewrite failure details disclose only bounded numeric reasons to the authenticated owner',async()=>{
 const s=setup({generate:async()=>{throw Object.assign(new Error('private-provider-message'),{diagnosticCode:'AI_REWRITE_WITHHELD',validationDetails:{unsupportedNumbers:['77%','<script>','private-rejected-text','9'.repeat(41)],characters:20001,overLength:true,rejectedResume:'private-draft'}});}});
 const id=await s.prepare();s.paid();const failed=await s.run('run',{buildId:id,consent:true});
 assert.equal(failed.code,503);assert.deepEqual(failed.data.validationDetails,{reasons:['length_limit','unsupported_numbers'],unsupportedNumbers:['77%'],characters:20001,characterLimit:20000});
 for(const hidden of ['private-provider-message','<script>','private-rejected-text','private-draft'])assert.ok(!JSON.stringify(failed.data).includes(hidden));
 assert.equal((await s.run('get',{buildId:id},{'x-vcp-firebase-token':'owner-b'})).code,404);assert.equal(s.checkouts(),1);
});

const careerFixture={summary:'Evidence-based career tools.',qualifications:[],translations:[{militaryTerm:'Supply specialist',civilianSkill:'Inventory operations',evidence:'Maintained accurate equipment records',resumeWording:'Maintained accurate equipment records.',careerDirections:['Inventory coordinator']}],coverLetter:'Dear Hiring Team,\n\nI maintained accurate equipment records and trained colleagues on inventory processes.',checks:['Verify your details.']};
test('career tools require the owner and a completed settled purchase, cache one kit, and delete its data',async()=>{
 let kits=0;const s=setup({generateCareer:async()=>{kits++;return careerFixture;}}),id=await s.prepare();
 assert.equal((await s.run('career',{buildId:id,consent:true})).code,409);s.paid();await s.run('run',{buildId:id,consent:true});
 assert.equal((await s.run('career',{buildId:id,consent:true},{'x-vcp-firebase-token':'owner-b'})).code,404);
 assert.equal((await s.run('career',{buildId:id})).code,400);
 const result=await s.run('career',{buildId:id,consent:true,keepAlive:true});assert.equal(result.data.httpStatus,200);assert.ok(result.data.kit.coverLetter);
 assert.deepEqual((await s.run('career',{buildId:id})).data.kit,result.data.kit);assert.equal(kits,1);assert.equal(s.checkouts(),1);
 [...s.sessions.values()][0].payment_intent={latest_charge:{refunded:true}};assert.equal((await s.run('career',{buildId:id,consent:true})).code,402);
 await s.run('delete',{buildId:id});assert.equal([...s.db.records.values()][0].careerKit,null);
});
test('failed or concurrent career requests preserve the resume and reuse the same purchase',async()=>{
 let kits=0,release,started;const gate=new Promise(r=>release=r),begin=new Promise(r=>started=r);
 const s=setup({generateCareer:async()=>{kits++;if(kits===1)throw new Error('private-fragment');started();await gate;return careerFixture;}}),id=await s.prepare();s.paid();await s.run('run',{buildId:id,consent:true});
 const failed=await s.run('career',{buildId:id,consent:true});assert.equal(failed.code,503);assert.ok(!JSON.stringify(failed.data).includes('private-fragment'));assert.equal((await s.run('get',{buildId:id})).data.status,'complete');
 const pending=s.run('career',{buildId:id,consent:true});await begin;assert.equal((await s.run('career',{buildId:id,consent:true})).code,409);release();assert.equal((await pending).code,200);assert.equal(s.checkouts(),1);
});
test('prepaid tailoring context survives checkout without sending resume content to Stripe',async()=>{
 const s=setup(),context={jobId:'job-123',resumeVersionId:'version-456'};
 const r=await s.run('purchase',{...prepaidRequest,entryContext:context});s.paid();const value=await s.run('verify',{buildId:r.data.id});assert.deepEqual(value.data.entryContext,context);
 assert.ok(!JSON.stringify(s.checkoutBodies).includes('job-123'));
 assert.equal((await s.run('purchase',{...prepaidRequest,entryContext:{jobId:'../another-user',resumeVersionId:''}})).code,400);
});

const finishedDocument={resume:input.resume,design:'classic',applicationType:'private',role:'Coordinator',exportSettings:{}};
test('finished manual or AI resumes can leave one private rating; prompts, retries and duplicate tabs do not duplicate it',async()=>{
 for(const ai of [false,true]){
  const s=setup(),id=await prepaid(s);s.paid();await s.run('verify',{buildId:id});
  assert.equal((await s.run('feedback-prompt',{buildId:id})).code,409);
  if(ai){await s.run('bind',{buildId:id,input,consent:true,storageConsent:true});await s.run('run',{buildId:id,consent:true});}
  await s.run('template-finish',{buildId:id,document:finishedDocument,storageConsent:true});
  const claims=await Promise.all([s.run('feedback-prompt',{buildId:id}),s.run('feedback-prompt',{buildId:id})]);assert.equal(claims.filter(r=>r.data.show).length,1);
  const ratings=await Promise.all([s.run('feedback-submit',{buildId:id,rating:2,comment:'  Clearer instructions would help.  '}),s.run('feedback-submit',{buildId:id,rating:5,comment:'Duplicate tab'})]);assert.ok(ratings.every(r=>r.code===200&&r.data.submitted));
  const values=[...s.db.records].filter(([path])=>path.startsWith('_privateResumeFeedback/'));assert.equal(values.length,1);assert.deepEqual(Object.keys(values[0][1]).sort(),['comment','createdAt','rating']);assert.equal(values[0][1].rating,2);assert.equal(values[0][1].comment,'Clearer instructions would help.');assert.doesNotMatch(JSON.stringify(values),/owner-a|firebase|MILITARY EXPERIENCE/);
  assert.equal((await s.run('feedback-prompt',{buildId:id})).data.show,false);assert.equal(s.checkouts(),1);assert.equal(s.calls(),ai?1:0);
  assert.equal((await s.run('delete',{buildId:id})).code,200);assert.ok(![...s.db.records.keys()].some(path=>path.startsWith('_privateResumeFeedback/')));
 }
});
test('feedback rejects other accounts, invalid ratings, unsolicited fields and unfinished or deleted purchases',async()=>{
 const s=setup(),id=await prepaid(s);s.paid();await s.run('verify',{buildId:id});await s.run('template-finish',{buildId:id,document:finishedDocument,storageConsent:true});
 assert.equal((await s.run('feedback-submit',{buildId:id,rating:5,comment:''},{'x-vcp-firebase-token':'owner-b'})).code,404);
 assert.equal((await s.run('feedback-submit',{buildId:id,rating:5,comment:''},{'x-vcp-firebase-token':''})).code,401);
 for(const patch of [{rating:0},{rating:6},{rating:3.5},{rating:'5'},{comment:'x'.repeat(1001)},{comment:{}},{resume:input.resume},{email:'private@example.com'}])assert.equal((await s.run('feedback-submit',{buildId:id,rating:4,comment:'',...patch})).code,400);
 assert.ok(![...s.db.records.keys()].some(path=>path.startsWith('_privateResumeFeedback/')));
 await s.run('delete',{buildId:id});assert.equal((await s.run('feedback-submit',{buildId:id,rating:5,comment:''})).code,410);
});
test('a verified build claims one included template; extra templates require an exact server-verified $1 checkout',async()=>{
 const s=setup(),id=await prepaid(s);
 assert.equal((await s.run('template-finish',{buildId:id,document:finishedDocument,storageConsent:true})).code,402);
 s.paid();assert.equal((await s.run('template-finish',{buildId:id,document:finishedDocument})).code,400);
 const first=await s.run('template-finish',{buildId:id,document:finishedDocument,storageConsent:true});assert.equal(first.code,200);assert.deepEqual(first.data.templates,['classic']);assert.equal(first.data.document.buildId,id);assert.equal(s.checkouts(),1);
 await s.run('template-finish',{buildId:id,document:{...finishedDocument,resume:input.resume+' Updated.'},storageConsent:true});assert.equal(s.checkouts(),1);
 assert.match((await s.run('template-open',{buildId:id,design:'classic'})).data.document.resume,/Updated/);
 const extra=await s.run('template-finish',{buildId:id,document:{...finishedDocument,design:'modern'},storageConsent:true});assert.equal(extra.code,200);assert.ok(extra.data.url);assert.equal(s.checkouts(),2);assert.equal(s.checkoutBodies[1].line_items[0].price_data.unit_amount,100);assert.ok(!JSON.stringify(s.checkoutBodies[1]).includes(input.resume));
 assert.equal((await s.run('template-verify',{buildId:id,design:'modern',storageConsent:true,paid:true,amount:0})).code,402);
 await s.run('template-finish',{buildId:id,document:{...finishedDocument,design:'modern'},storageConsent:true});assert.equal(s.checkouts(),2);
 s.paid();const done=await s.run('template-verify',{buildId:id,design:'modern',storageConsent:true});assert.equal(done.code,200);assert.deepEqual(done.data.templates,['classic','modern']);assert.equal(done.data.document.design,'modern');
 assert.equal((await s.run('template-verify',{buildId:id,design:'modern',storageConsent:true})).code,200);
 assert.equal((await s.run('template-open',{buildId:id,design:'modern'})).code,200);assert.equal(s.checkouts(),2);assert.equal(s.calls(),0);
});
test('template entitlements survive concurrent tabs and cannot be forged, reassigned or used by another owner',async()=>{
 const s=setup(),id=await prepaid(s);s.paid();
 const results=await Promise.all(['classic','modern'].map(design=>s.run('template-finish',{buildId:id,document:{...finishedDocument,design},storageConsent:true})));
 assert.equal(results.filter(r=>r.data.templates?.length===1).length,1);assert.equal(results.filter(r=>r.data.url).length,1);
 const saved=(await s.run('get',{buildId:id})).data;assert.equal(saved.templates.length,1);assert.equal(s.checkouts(),2);
 assert.equal((await s.run('template-finish',{buildId:id,document:finishedDocument,storageConsent:true},{'x-vcp-firebase-token':'owner-b'})).code,404);
 assert.equal((await s.run('template-finish',{buildId:id,document:{...finishedDocument,design:'../../forged'},storageConsent:true})).code,400);
});
test('refunded, mismatched and zero-total unpaid template sessions do not grant a new design',async()=>{
 const s=setup(),id=await prepaid(s);s.paid();await s.run('template-finish',{buildId:id,document:finishedDocument,storageConsent:true});await s.run('template-finish',{buildId:id,document:{...finishedDocument,design:'modern'},storageConsent:true});
 const session=[...s.sessions.values()][1],original=structuredClone(session);
 for(const patch of [{status:'complete',payment_status:'paid',amount_total:0},{status:'complete',payment_status:'paid',currency:'eur'},{status:'complete',payment_status:'paid',metadata:{...session.metadata,design:'creative'}},{status:'complete',payment_status:'paid',payment_intent:{latest_charge:{refunded:true}}}]){delete session.payment_intent;Object.assign(session,original,patch);assert.equal((await s.run('template-verify',{buildId:id,design:'modern',storageConsent:true})).code,402);}
 delete session.payment_intent;Object.assign(session,original,{status:'complete',payment_status:'no_payment_required',amount_total:0,total_details:{amount_discount:100}});assert.equal((await s.run('template-verify',{buildId:id,design:'modern',storageConsent:true})).code,200);
 await s.run('delete',{buildId:id});assert.ok(![...s.db.records.keys()].some(k=>k.includes('/finishedResumes/')||k.includes('/templateOrders/')));
 assert.equal((await s.run('template-open',{buildId:id,design:'classic'})).code,410);
});
