'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAdminResumeHandler,purchase}=require('../api/_lib/admin-resume');
const {aggregate,createActivityHandler}=require('../api/_lib/resume-activity');
function response(){return {headers:{},code:0,body:null,setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;},end(){return this;}};}
const request=query=>({method:'GET',headers:{origin:'https://veterancareerpath.com',authorization:'Bearer fixture-admin'},query:query||{}});
const authorized=async()=>({ok:true,uid:'fixture-admin'});
const checkout=values=>({id:'cs_test_resume1',mode:'payment',status:'complete',payment_status:'paid',created:1793200000,amount_total:199,currency:'usd',total_details:{amount_discount:0},metadata:{product:'vcp-resume-workspace',uid:'PRIVATE_UID',buildId:'PRIVATE_BUILD',resume:'PRIVATE_RESUME'},customer_details:{email:'alex@example.com',name:'Alex Example',address:'PRIVATE_ADDRESS'},payment_intent:{id:'pi_fixture1',latest_charge:{amount_refunded:0,receipt_email:'PRIVATE_RECEIPT'}},...values});
test('only completed app checkouts appear, including full-discount promos and template refunds',()=>{
 const base=purchase(checkout());assert.equal(base.service,'resume');assert.equal(base.amount,199);assert.equal(base.stripeUrl,'https://dashboard.stripe.com/payments/pi_fixture1');assert.doesNotMatch(JSON.stringify(base),/PRIVATE_/);
 assert.equal(purchase(checkout({metadata:{product:'unrelated-store'}})),null);assert.equal(purchase(checkout({metadata:{product:'constructor'}})),null);assert.equal(purchase(checkout({status:'open'})),null);assert.equal(purchase(checkout({payment_status:'unpaid'})),null);
 const promo=purchase(checkout({payment_status:'no_payment_required',amount_total:0,total_details:{amount_discount:199},payment_intent:null}));assert.equal(promo.status,'promo');assert.equal(promo.amount,0);assert.equal(promo.discount,199);
 const refunded=purchase(checkout({metadata:{product:'vcp-resume-template',design:'modern'},amount_total:100,payment_intent:{id:'pi_template1',latest_charge:{amount_refunded:100}}}));assert.equal(refunded.service,'template');assert.equal(refunded.status,'refunded');assert.equal(refunded.refunded,100);
 const testOrder=purchase(checkout({livemode:false}));assert.equal(testOrder.testMode,true);assert.equal(testOrder.stripeUrl,'https://dashboard.stripe.com/test/payments/pi_fixture1');
 assert.equal(purchase(checkout({payment_intent:{id:'pi_part1',latest_charge:{amount_refunded:50}}})).status,'partially_refunded');
});
test('administrator authorization precedes Stripe and activity database access',async()=>{
 for(const view of ['purchases','activity','feedback'])for(const code of [401,403]){let calls=0;const handler=createAdminResumeHandler({authorize:async()=>({ok:false,status:code,error:'not_allowed'}),get:async()=>calls++,key:()=>{calls++;return 'fixture';},db:{collection(){calls++;}}}),res=response();await handler(request({view}),res);assert.equal(res.code,code);assert.equal(calls,0);assert.equal(res.headers['Cache-Control'],'no-store');}
});
test('feedback reports require admin, paginate within a date range and expose only rating, comment and date',async()=>{
 const calls=[],rows=Array.from({length:51},(_,i)=>({id:i.toString(16).padStart(64,'0'),data:()=>({rating:4,comment:'Helpful <b>example</b>',createdAt:1793200000000,uid:'PRIVATE_UID',resume:'PRIVATE_RESUME'})}));
 const query={orderBy(...a){calls.push(['order',...a]);return this;},where(...a){calls.push(['where',...a]);return this;},startAfter(v){calls.push(['after',v]);return this;},limit(n){assert.equal(n,51);return this;},select(...a){assert.deepEqual(a,['rating','comment','createdAt']);return this;},get:async()=>({docs:rows})};
 const collection={...query,doc:id=>({get:async()=>({id,exists:true})})};
 const handler=createAdminResumeHandler({authorize:authorized,key:()=>{throw new Error('Stripe is unnecessary');},db:{collection:name=>{assert.equal(name,'_privateResumeFeedback');return collection;}},now:()=>Date.UTC(2026,9,29)}),res=response();
 await handler(request({view:'feedback',days:'7'}),res);assert.equal(res.code,200);assert.equal(res.body.feedback.length,50);assert.equal(res.body.nextCursor,rows[49].id);assert.doesNotMatch(JSON.stringify(res.body),/PRIVATE_/);assert.equal(calls.find(row=>row[0]==='where')[1],'createdAt');
 const next=response();await handler(request({view:'feedback',days:'all',cursor:rows[49].id}),next);assert.equal(next.code,200);assert.ok(calls.find(row=>row[0]==='after'));
 for(const cursor of ['cs_test_A1','../private','a&rating=5']){const bad=response();await handler(request({view:'feedback',cursor}),bad);assert.equal(bad.code,400);}
 const failed=response();await createAdminResumeHandler({authorize:authorized,db:{collection(){throw new Error('PRIVATE_DATABASE_ERROR');}}})(request({view:'feedback'}),failed);assert.equal(failed.code,503);assert.doesNotMatch(JSON.stringify(failed.body),/PRIVATE/);
});
test('purchase report scans past unrelated Stripe pages and supports safe historical pagination',async()=>{
 const paths=[];const handler=createAdminResumeHandler({authorize:authorized,key:()=> 'fixture',now:()=>Date.UTC(2026,9,29),get:async(path,key,signal,version)=>{paths.push(path);assert.equal(version,'2024-06-20');return paths.length===1?{data:[checkout({id:'cs_test_unrelated1',metadata:{product:'other'}})],has_more:true}:{data:[checkout({id:'cs_test_promo2',amount_total:0,payment_intent:null,payment_status:'no_payment_required',total_details:{amount_discount:199}})],has_more:false};}}),res=response();
 await handler(request({days:'all'}),res);assert.equal(res.code,200);assert.equal(paths.length,2);assert.ok(paths[1].includes('starting_after=cs_test_unrelated1'));assert.ok(paths[0].includes('status=complete'));assert.ok(!paths[0].includes('created%5Bgte%5D'));assert.equal(res.body.purchases.length,1);assert.equal(res.body.purchases[0].status,'promo');assert.equal(res.body.nextCursor,null);assert.doesNotMatch(JSON.stringify(res.body),/PRIVATE_/);
 const bad=response();await handler(request({cursor:'cs_x&secret=PRIVATE'}),bad);assert.equal(bad.code,400);assert.equal(paths.length,2);
});
test('large date ranges expose continuation instead of silently dropping app purchases',async()=>{
 let calls=0;const handler=createAdminResumeHandler({authorize:authorized,key:()=> 'fixture',get:async()=>{calls++;return {data:Array.from({length:100},(_,i)=>checkout({id:'cs_test_'+calls+'_'+i})),has_more:true};}}),res=response();await handler(request({days:'30'}),res);assert.equal(res.code,200);assert.equal(calls,1);assert.equal(res.body.purchases.length,100);assert.equal(res.body.nextCursor,'cs_test_1_99');assert.equal(res.body.hasMore,true);
});
test('activity reports read only aggregate fields and filter unknown or invalid counts',async()=>{
 const calls=[];const query={where(...v){calls.push(['where',...v]);return this;},orderBy(){return this;},limit(){return this;},select(...v){calls.push(['select',...v]);return this;},get:async()=>({docs:[{data:()=>({date:'2026-10-29',events:{page_view:8,vcp_resume_download:2,PRIVATE_RESUME:4},screens:{home:6,calculator:4},sources:{linkedin:3,PRIVATE_SOURCE:4},email:'PRIVATE_EMAIL'})}]})};
 const handler=createAdminResumeHandler({authorize:authorized,db:{collection:name=>{assert.equal(name,'_privateResumeActivityDaily');return query;}},now:()=>Date.UTC(2026,9,29)}),res=response();await handler(request({view:'activity',days:'7'}),res);assert.equal(res.code,200);assert.equal(res.body.days[0].events.page_view,8);assert.equal(res.body.days[0].screens.calculator,undefined);assert.doesNotMatch(JSON.stringify(res.body),/PRIVATE_/);assert.deepEqual(calls.find(row=>row[0]==='select'),['select','date','events','screens','sources']);
});
test('activity collector accepts categories only and never stores account, browser or purchase identifiers',async()=>{
 const body={protocol:'vcp-resume-analytics-v1',events:[{name:'page_view',screen:'home',source:'linkedin'},{name:'vcp_resume_download',screen:'resume_download',source:'linkedin'}]};
 assert.deepEqual(aggregate(body),{events:{page_view:1,vcp_resume_download:1},screens:{home:1},sources:{linkedin:1}});
 for(const bad of [{...body,email:'PRIVATE_EMAIL'},{...body,events:[{...body.events[0],client_id:'PRIVATE_ID'}]},{...body,events:[{...body.events[0],screen:'calculator'}]},{...body,events:[{...body.events[0],name:'PRIVATE_EVENT'}]},{...body,events:[{...body.events[0],source:'PRIVATE_SOURCE'}]}])assert.throws(()=>aggregate(bad));
 let saved;const db={collection:name=>{assert.equal(name,'_privateResumeActivityDaily');return {doc:id=>({set:async(data,options)=>{saved={id,data,options};}})};}};
 const handler=createActivityHandler({db,increment:value=>({increment:value}),now:()=>Date.UTC(2026,9,29),rateLimit:()=>false}),res=response();await handler({method:'POST',headers:{origin:'https://vcp-proxy.vercel.app','content-type':'application/json'},body},res);assert.equal(res.code,204);assert.equal(saved.id,'2026-10-29');assert.deepEqual(saved.data.events.page_view,{increment:1});assert.deepEqual(Object.keys(saved.data).sort(),['date','events','screens','sources','updatedAt']);
 const denied=response();await handler({method:'GET',headers:{origin:'https://vcp-proxy.vercel.app'}},denied);assert.equal(denied.code,405);
});
test('collector origin, body and rate limits stop writes; provider failures do not leak payloads',async()=>{
 let writes=0;const db={collection(){writes++;throw new Error('PRIVATE_ERROR');}},body={protocol:'vcp-resume-analytics-v1',events:[{name:'page_view',screen:'home',source:'direct'}]};
 for(const [headers,value,expected]of [[{origin:'https://attacker.invalid','content-type':'application/json'},body,403],[{origin:'https://vcp-proxy.vercel.app','content-type':'text/plain'},body,415],[{origin:'https://vcp-proxy.vercel.app','content-type':'application/json'},{...body,resume:'PRIVATE'},400]]){const res=response();await createActivityHandler({db})({method:'POST',headers,body:value},res);assert.equal(res.code,expected);}assert.equal(writes,0);
 const limited=response();await createActivityHandler({db,rateLimit:()=>true})({method:'POST',headers:{origin:'https://vcp-proxy.vercel.app','content-type':'application/json'},body},limited);assert.equal(limited.code,429);assert.equal(writes,0);
 const failed=response();await createActivityHandler({db,rateLimit:()=>false})({method:'POST',headers:{origin:'https://vcp-proxy.vercel.app','content-type':'application/json'},body},failed);assert.equal(failed.code,503);assert.doesNotMatch(JSON.stringify(failed.body),/PRIVATE/);
 const report=response();await createAdminResumeHandler({authorize:authorized,key:()=> 'fixture',get:async()=>{throw new Error('PRIVATE_STRIPE_KEY');}})(request(),report);assert.equal(report.code,503);assert.doesNotMatch(JSON.stringify(report.body),/PRIVATE/);
});

test('non-page events preserve previously recorded source and screen totals',async()=>{
 const stored={sources:{linkedin:3},screens:{home:3},events:{page_view:3}};
 const merge=(target,patch)=>{for(const [key,value]of Object.entries(patch)){if(value&&typeof value==='object'&&Object.keys(value).length){if(Object.hasOwn(value,'increment'))target[key]=(target[key]||0)+value.increment;else{target[key]||={};merge(target[key],value);}}else target[key]=value;}};
 const db={collection:()=>({doc:()=>({set:async patch=>merge(stored,patch)})})};
 const handler=createActivityHandler({db,increment:value=>({increment:value}),rateLimit:()=>false,now:()=>Date.UTC(2026,9,29)}),res=response();
 await handler({method:'POST',headers:{origin:'https://vcp-proxy.vercel.app','content-type':'application/json'},body:{protocol:'vcp-resume-analytics-v1',events:[{name:'vcp_resume_download',screen:'resume_download',source:'linkedin'}]}},res);
 assert.equal(res.code,204);assert.deepEqual(stored.sources,{linkedin:3});assert.deepEqual(stored.screens,{home:3});assert.equal(stored.events.page_view,3);assert.equal(stored.events.vcp_resume_download,1);
});

test('cover letter purchases and full-discount coupons appear without applicant text',()=>{for(const amount of [100,0]){const value=purchase(checkout({metadata:{product:'vcp-resume-cover-letter',uid:'PRIVATE_UID',letterId:'PRIVATE_ID',resume:'PRIVATE_RESUME'},amount_total:amount,payment_status:amount?'paid':'no_payment_required',total_details:{amount_discount:100-amount}}));assert.equal(value.service,'cover_letter');assert.equal(value.amount,amount);assert.equal(value.status,amount?'paid':'promo');assert.doesNotMatch(JSON.stringify(value),/PRIVATE_/);}});
