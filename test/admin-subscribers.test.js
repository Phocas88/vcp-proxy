'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSubscribersHandler}=require('../api/_lib/admin-subscribers');
const {requireAdmin}=require('../api/_lib/admin-auth');
function response(){return {headers:{},statusCode:0,body:null,setHeader(k,v){this.headers[k]=v;},status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;},end(){return this;}};}
const request=(query={})=>({method:'GET',headers:{origin:'https://veterancareerpath.com',authorization:'Bearer fixture-token'},query});
const admin=async()=>({ok:true,uid:'fixture-admin'}),key=()=> 'fixture-stripe-key';
const item=(values={})=>({id:'sub_A1',status:'active',customer:{name:'Alex Example',email:'alex@example.com',address:{line1:'PRIVATE_ADDRESS'},tax_ids:'PRIVATE_TAX'},currency:'usd',created:1700000000,current_period_end:1800000000,cancel_at_period_end:false,items:{data:[{quantity:1,price:{unit_amount:1500,currency:'usd',recurring:{interval:'month',interval_count:1}}}]},metadata:{note:'PRIVATE_NOTE'},...values});
test('missing, invalid and non-admin credentials cannot read Stripe or configuration',async()=>{
 for(const fixture of ['missing','invalid','nonadmin']){
  let calls=0;const req=request();if(fixture==='missing')delete req.headers.authorization;
  const authorize=req=>requireAdmin(req,async()=>{if(fixture==='invalid')throw new Error('PRIVATE_TOKEN');return {uid:'fixture-user',admin:false};});
  const handler=createSubscribersHandler({authorize,key:()=>{calls++;return key();},get:async()=>{calls++;}}),res=response();
  await handler(req,res);assert.equal(res.statusCode,fixture==='nonadmin'?403:401);assert.equal(calls,0);assert.equal(res.headers['Cache-Control'],'no-store');assert.doesNotMatch(JSON.stringify(res.body),/PRIVATE_/);
 }
});
test('an admin gets only dashboard fields and bounded, expanded Stripe pagination',async()=>{
 let path;const handler=createSubscribersHandler({authorize:admin,key,get:async(value,secret)=>{path=value;assert.equal(secret,key());return {data:[item()],has_more:true};}}),res=response();
 await handler(request({cursor:'sub_Previous1'}),res);assert.equal(res.statusCode,200);const query=new URL('https://stripe.test'+path);assert.equal(query.pathname,'/v1/subscriptions');assert.equal(query.searchParams.get('limit'),'100');assert.equal(query.searchParams.get('status'),'all');assert.equal(query.searchParams.get('expand[]'),'data.customer');assert.equal(query.searchParams.get('starting_after'),'sub_Previous1');
 assert.deepEqual(res.body,{subscribers:[{id:'sub_A1',email:'alex@example.com',name:'Alex Example',status:'active',amount:1500,currency:'usd',interval:'month',intervalCount:1,created:1700000000000,currentPeriodEnd:1800000000000,cancelAtPeriodEnd:false}],nextCursor:'sub_A1',hasMore:true});assert.doesNotMatch(JSON.stringify(res.body),/PRIVATE_|fixture-stripe-key/);
});
test('new Stripe item dates, quantities, deleted customers and unavailable prices stay accurate',async()=>{
 const subs=[item({id:'sub_A2',current_period_end:undefined,customer:{id:'cus_deleted',deleted:true},items:{data:[{quantity:2,current_period_end:1810000000,price:{unit_amount:2500,currency:'usd',recurring:{interval:'month',interval_count:1}}},{quantity:1,current_period_end:1820000000,price:{unit_amount:1000,currency:'usd',recurring:{interval:'month',interval_count:1}}}]}}),item({id:'sub_A3',status:'canceled',currency:'jpy',items:{data:[{price:{unit_amount:null,currency:'jpy'}}]}})];
 const handler=createSubscribersHandler({authorize:admin,key,get:async()=>({data:subs,has_more:false})}),res=response();await handler(request(),res);
 assert.equal(res.body.subscribers[0].amount,6000);assert.equal(res.body.subscribers[0].currentPeriodEnd,1810000000000);assert.equal(res.body.subscribers[0].email,'');assert.equal(res.body.subscribers[1].amount,null);assert.equal(res.body.subscribers[1].currency,'jpy');assert.equal(res.body.nextCursor,null);
});
test('unsupported methods, malicious cursors and preflight never query Stripe',async()=>{
 let calls=0;const handler=createSubscribersHandler({authorize:admin,key,get:async()=>{calls++;return {data:[]};}});
 for(const cursor of ['sub_A&status=active',['sub_A'],{id:'sub_A'},'x'.repeat(500)]){const res=response();await handler(request({cursor}),res);assert.equal(res.statusCode,400);}
 const pre=response();await handler({...request(),method:'OPTIONS'},pre);assert.equal(pre.statusCode,204);assert.equal(pre.headers['Access-Control-Allow-Origin'],'https://veterancareerpath.com');assert.equal(pre.headers['Access-Control-Allow-Headers'],'Authorization, Content-Type');
 const post=response();await handler({...request(),method:'POST'},post);assert.equal(post.statusCode,405);
 const other=response();await handler({...request(),method:'OPTIONS',headers:{origin:'https://attacker.invalid'}},other);assert.equal(other.headers['Access-Control-Allow-Origin'],undefined);assert.equal(calls,0);
});
test('billing configuration and provider failures give retryable errors without customer data or credentials',async()=>{
 for(const kind of ['missing','provider','timeout','malformed']){
  const handler=createSubscribersHandler({authorize:admin,key:()=>kind==='missing'?undefined:key(),get:async()=>{if(kind==='malformed')return {error:{message:'PRIVATE_SECRET'}};const e=new Error('PRIVATE_STRIPE_KEY PRIVATE_CUSTOMER');if(kind==='timeout')e.name='AbortError';throw e;}}),res=response();await handler(request(),res);assert.equal(res.statusCode,kind==='timeout'?504:503);assert.doesNotMatch(JSON.stringify(res.body),/PRIVATE_|fixture-stripe-key/);assert.equal(res.body.subscribers,undefined);
 }
});
test('the deployed route reaches the admin guard while normal AI POST and analytics behavior remain protected',async()=>{
 const handler=require('../api/claude'),res=response();await handler({method:'GET',query:{__admin:'subscribers'},headers:{}},res);assert.equal(res.statusCode,401);assert.equal(res.body.error,'missing_token');
 const post=response();await handler({method:'POST',query:{},headers:{},body:{}},post);assert.equal(post.statusCode,401);
 const cors=response();await handler({method:'OPTIONS',query:{__admin:'subscribers'},headers:{origin:'https://www.veterancareerpath.com'}},cors);assert.equal(cors.statusCode,204);assert.match(cors.headers['Access-Control-Allow-Methods'],/GET/);
 const routes=require('../vercel.json').rewrites;assert.ok(routes.some(route=>route.source==='/api/admin-subscribers'&&route.destination==='/api/claude?__admin=subscribers'));
});
