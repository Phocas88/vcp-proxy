'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const {createHash}=require('node:crypto');
const {renderAnalyticsBridge,serveAnalyticsBridge,VERSION}=require('../api/_lib/resume-analytics');
const MEASUREMENT_ID='G-TEST00000';
const VETERAN_RESUMES_MEASUREMENT_ID='G-VETERAN1234';
function fixture({activity=false,measurementId=MEASUREMENT_ID,veteranResumesMeasurementId=VETERAN_RESUMES_MEASUREMENT_ID}={}){
 const messages=[],scripts=[],listeners={},requests=[];let parentReads=0;
 const parent={postMessage:(value,origin)=>messages.push({value,origin})};for(const key of ['document','location'])Object.defineProperty(parent,key,{get(){parentReads++;throw new Error('Private parent access');}});
 const window={parent,addEventListener:(name,fn)=>listeners[name]=fn};if(activity)Object.assign(window,{fetch:(url,options)=>{requests.push({url,options});return Promise.resolve();},setTimeout:()=>1,clearTimeout(){}});const document={head:{append:script=>scripts.push(script)},createElement:()=>({}),cookie:''};
 const {html}=renderAnalyticsBridge({measurementId,veteranResumesMeasurementId});vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1],{window,parent,document,Date,Number,Array,Object,JSON,String});
 const send=(data,origin='https://veterancareerpath.com',source=parent)=>listeners.message({data:{protocol:VERSION,...data},origin,source});
 return {window,send,scripts,messages,requests,hide:()=>listeners.pagehide(),parentReads:()=>parentReads};
}
const config={type:'configure',client_id:'123456789.1793200000000',session_id:'1793200000',source:'linkedin',screen:'home'};
test('the public bridge has a hash-locked script, no editor access, no referrer and explicit embedding origins',()=>{
 const {html,csp}=renderAnalyticsBridge({measurementId:MEASUREMENT_ID}),script=html.match(/<script>([\s\S]*)<\/script>/)[1];assert.ok(csp.includes("'sha256-"+createHash('sha256').update(script).digest('base64')+"'"));assert.match(csp,/frame-ancestors https:\/\/veterancareerpath.com/);assert.match(csp,/sandbox allow-scripts allow-same-origin/);assert.doesNotMatch(csp,/unsafe-inline|unsafe-eval|frame-ancestors \*/);assert.match(html,/name="referrer" content="no-referrer"/);assert.doesNotMatch(html,/<form|<input|<iframe|firebase/i);
 const headers={};let status,sent;const res={setHeader:(k,v)=>headers[k]=v,status(value){status=value;return this;},send(value){sent=value;},end(){sent='';}};serveAnalyticsBridge({method:'GET',query:{private:'DO_NOT_ECHO'}},res);assert.equal(status,200);assert.equal(headers['Referrer-Policy'],'no-referrer');assert.equal(headers['Content-Type'],'text/html; charset=utf-8');assert.doesNotMatch(sent,/DO_NOT_ECHO/);serveAnalyticsBridge({method:'HEAD'},res);assert.equal(sent,'');
});
test('no Google code starts before a valid message from an allowed parent',()=>{
 const f=fixture();assert.equal(f.scripts.length,0);f.send(config,'https://attacker.invalid');f.send(config,'https://veterancareerpath.com',{});f.send({...config,client_id:'firebase-user-id'});f.send({...config,source:'private-campaign-name'});assert.equal(f.scripts.length,0);f.send(config);assert.equal(f.scripts.length,1);assert.equal(f.scripts[0].src,'https://www.googletagmanager.com/gtag/js?id='+MEASUREMENT_ID);assert.equal(f.scripts[0].referrerPolicy,'no-referrer');assert.equal(f.parentReads(),0);
});
test('advertising stays denied, IDs are browser-generated and only fixed synthetic page locations reach the tag',()=>{
 const f=fixture();f.send(config);const values=f.window.dataLayer.map(value=>Array.from(value));const consent=values.find(value=>value[0]==='consent')[2],settings=values.find(value=>value[0]==='config')[2];assert.equal(consent.analytics_storage,'granted');assert.equal(consent.ad_storage,'denied');assert.equal(consent.ad_user_data,'denied');assert.equal(consent.ad_personalization,'denied');assert.equal(settings.client_id,config.client_id);assert.equal(settings.cookie_flags,'SameSite=None;Secure;Partitioned');assert.equal(settings.allow_google_signals,false);assert.equal(settings.allow_ad_personalization_signals,false);assert.equal(settings.send_page_view,false);assert.equal(settings.page_location,'https://veterancareerpath.com/resumereview/screen/home');assert.equal(settings.page_referrer,'https://www.linkedin.com/');assert.equal(settings.linker.accept_incoming,false);
});
test('unknown events, private screens, IDs, extra fields and free text are discarded before measurement',()=>{
 const f=fixture();f.send(config);f.scripts[0].onload();const packet={type:'event',name:'vcp_resume_review_failed',params:{reason:'provider',email:'PRIVATE_EMAIL',resume:'PRIVATE_RESUME',error:'PRIVATE_ERROR'},screen:'resume_review',session_id:config.session_id,engagement_time_msec:1200,user_id:'PRIVATE_ACCOUNT',page_location:'https://example.com/?resume=PRIVATE_URL'};
 f.send(packet);f.send({...packet,name:'PRIVATE_EVENT'});f.send({...packet,screen:'calculator'});f.send({...packet,screen:'PRIVATE_SCREEN'});f.send({...packet,session_id:'PRIVATE_SESSION'});const events=f.window.dataLayer.map(value=>Array.from(value)).filter(value=>value[0]==='event');assert.equal(events.length,1);assert.equal(events[0][2].reason,'provider');assert.equal(events[0][2].engagement_time_msec,1200);assert.equal(events[0][2].page_location,'https://veterancareerpath.com/resumereview/screen/resume_review');assert.doesNotMatch(JSON.stringify(events),/PRIVATE_/);assert.equal(f.parentReads(),0);
});

test('bounded identity, screen and cookie settings precede destination startup as well as explicit configuration',()=>{
 const f=fixture();f.send({...config,page_location:'PRIVATE_URL',clientId:'PRIVATE_UID'},'https://veteranresumes.com');
 const commands=f.window.dataLayer.map(v=>Array.from(v)),global=commands.find(v=>v[0]==='set')[1],settings=commands.find(v=>v[0]==='config')[2];
 assert.ok(commands.findIndex(v=>v[0]==='set')<commands.findIndex(v=>v[0]==='js'));
 for(const key of ['client_id','session_id','page_location','page_title','cookie_prefix','cookie_domain','cookie_expires','cookie_update','cookie_flags','send_page_view','allow_google_signals','allow_ad_personalization_signals'])assert.equal(global[key],settings[key],key);
 assert.equal(global.send_page_view,false);assert.equal(global.page_location,'https://veteranresumes.com/screen/home');assert.doesNotMatch(JSON.stringify(commands),/PRIVATE_/);
});
test('withdrawal disables the destination, drops queued events and rejects all later configuration',()=>{
 const f=fixture();f.send(config);f.send({type:'event',name:'page_view',params:{},screen:'home',session_id:config.session_id});f.send({type:'stop'});assert.equal(f.window['ga-disable-'+MEASUREMENT_ID],true);f.scripts[0].onload();f.send(config);f.send({type:'event',name:'vcp_resume_download',params:{format:'pdf',document:'resume'},screen:'resume_download',session_id:config.session_id});assert.equal(f.window.dataLayer.filter(value=>value[0]==='event').length,0);assert.ok(f.messages.some(item=>item.value.type==='stopped'));
});
test('the existing API keeps POST authorization and only the exact public bridge GET/HEAD route bypasses it',async()=>{
 const handler=require('../api/claude');let status,body;const res={setHeader(){},status(value){status=value;return this;},json(value){body=value;},send(value){body=value;},end(){body='';}};
 await handler({method:'GET',query:{},headers:{}},res);assert.equal(status,405);
 await handler({method:'POST',query:{__analytics:'bridge'},body:{},headers:{}},res);assert.equal(status,401);
 await handler({method:'GET',query:{__analytics:'bridge'},headers:{}},res);assert.equal(status,200);assert.match(body,/Veteran Resumes usage measurement/);
});

test('a missing explicit destination never starts a Google tag or falls back to another property',()=>{
 const messages=[],scripts=[],listeners={},parent={postMessage:value=>messages.push(value)};const window={parent,addEventListener:(name,fn)=>listeners[name]=fn};const document={head:{append:script=>scripts.push(script)},createElement:()=>({}),cookie:''};const {html}=renderAnalyticsBridge({measurementId:''});vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1],{window,parent,document,Date,Number,Array,Object,JSON,String});for(const data of [{type:'hello'},config])listeners.message({data:{protocol:VERSION,...data},source:parent,origin:'https://veterancareerpath.com'});assert.equal(scripts.length,0);assert.equal(window.gtag,undefined);assert.ok(messages.some(value=>value.type==='unconfigured'));assert.doesNotMatch(html,/G-CMFKLT321J/);
});


test('new website telemetry keeps consent and sanitizes locations to the owned app domain',()=>{
 for(const origin of ['https://veteranresumes.com','https://www.veteranresumes.com','https://veteran-resumes.vercel.app']){
  const f=fixture();assert.equal(f.scripts.length,0);f.send(config,origin);assert.equal(f.scripts.length,1);
  const settings=f.window.dataLayer.map(v=>Array.from(v)).find(v=>v[0]==='config')[2];assert.equal(settings.page_location,'https://veteranresumes.com/screen/home');assert.equal(settings.allow_google_signals,false);
  f.send({type:'stop'},origin);assert.equal(f.window['ga-disable-'+VETERAN_RESUMES_MEASUREMENT_ID],true);assert.equal(f.window['ga-disable-'+MEASUREMENT_ID],undefined);
 }
 const f=fixture();for(const origin of ['https://veteranresumes.com.evil.example','https://evil.veteranresumes.com'])f.send(config,origin);assert.equal(f.scripts.length,0);
});

test('public website views and calls to action are distinct from app activity and never include visitor content',()=>{
 const f=fixture(),origin='https://veteranresumes.com';f.send({...config,screen:'website'},origin);f.scripts[0].onload();
 const settings=f.window.dataLayer.map(v=>Array.from(v)).find(v=>v[0]==='config')[2];assert.equal(settings.page_location,origin+'/');
 f.send({type:'event',name:'vcp_resume_website_action',screen:'website',session_id:config.session_id,params:{action:'upload_resume',email:'PRIVATE_EMAIL',url:'PRIVATE_QUERY'}},origin);
 const event=f.window.dataLayer.map(v=>Array.from(v)).find(v=>v[0]==='event');assert.equal(event[1],'vcp_resume_website_action');assert.equal(event[2].action,'upload_resume');assert.equal(event[2].page_location,origin+'/');assert.doesNotMatch(JSON.stringify(event),/PRIVATE_/);assert.equal(f.parentReads(),0);
});

test('leaving a website page flushes only consented aggregate categories and withdrawal cancels that flush',()=>{
 const origin='https://veteranresumes.com',packet={type:'event',name:'vcp_resume_website_action',screen:'website',session_id:config.session_id,params:{action:'start_resume',email:'PRIVATE_EMAIL'}};
 const f=fixture({activity:true});f.send({...config,screen:'website'},origin);f.scripts[0].onload();f.send(packet,origin);assert.equal(f.requests.length,0);f.hide();assert.equal(f.requests.length,1);assert.equal(f.requests[0].options.keepalive,true);assert.deepEqual(JSON.parse(f.requests[0].options.body).events,[{name:packet.name,screen:'website',source:'linkedin'}]);assert.doesNotMatch(f.requests[0].options.body,/PRIVATE_|client_id|session_id/);
 const stopped=fixture({activity:true});stopped.send({...config,screen:'website'},origin);stopped.scripts[0].onload();stopped.send(packet,origin);stopped.send({type:'stop'},origin);stopped.hide();assert.equal(stopped.requests.length,0);
});

test('the browser-verified parent origin selects exactly one property for the public site and app',()=>{
 const groups=[
  {origins:['https://veterancareerpath.com','https://www.veterancareerpath.com','https://mobile-resume-review-app.vercel.app','http://127.0.0.1:3000','http://localhost:3000'],id:MEASUREMENT_ID},
  {origins:['https://veteranresumes.com','https://www.veteranresumes.com','https://veteran-resumes.vercel.app'],id:VETERAN_RESUMES_MEASUREMENT_ID}
 ];
 for(const {origins,id}of groups)for(const origin of origins)for(const screen of ['website','home','resume_review']){
  const f=fixture();f.send({type:'hello'},origin);assert.equal(f.messages.at(-1).value.type,'ready');assert.equal(f.scripts.length,0);
  // A message cannot override the Google property, destination or browser origin.
  f.send({...config,screen,measurementId:'G-ATTACKER123',origin:'https://attacker.invalid'},origin);f.send({...config,screen},origin);
  assert.equal(f.scripts.length,1);assert.equal(f.scripts[0].src,'https://www.googletagmanager.com/gtag/js?id='+id);f.scripts[0].onload();
  f.send({type:'event',name:'page_view',screen,session_id:config.session_id,params:{send_to:'G-ATTACKER123',measurement_id:'G-ATTACKER123'}},origin);
  const entries=f.window.dataLayer.map(v=>Array.from(v)),configs=entries.filter(v=>v[0]==='config'),events=entries.filter(v=>v[0]==='event');
  assert.equal(configs.length,1);assert.equal(configs[0][1],id);assert.equal(events.length,1);assert.equal(events[0][2].send_to,id);assert.doesNotMatch(JSON.stringify(entries),/G-ATTACKER123/);assert.equal(f.parentReads(),0);
 }
});

test('a missing or invalid standalone property never falls back to the main website property',()=>{
 for(const veteranResumesMeasurementId of ['',undefined,null,'G-invalid','AW-123456789','G-TEST/PRIVATE']){
  for(const origin of ['https://veteranresumes.com','https://www.veteranresumes.com','https://veteran-resumes.vercel.app']){
   const f=fixture({veteranResumesMeasurementId:veteranResumesMeasurementId??''});f.send({type:'hello'},origin);f.send(config,origin);assert.equal(f.scripts.length,0);assert.equal(f.window.gtag,undefined);assert.ok(f.messages.every(item=>item.value.type==='unconfigured'));
  }
  const legacy=fixture({veteranResumesMeasurementId:veteranResumesMeasurementId??''});legacy.send(config);assert.equal(legacy.scripts.length,1);assert.ok(legacy.scripts[0].src.endsWith(MEASUREMENT_ID));
 }
 const standalone=fixture({measurementId:''});standalone.send(config,'https://veteranresumes.com');assert.ok(standalone.scripts[0].src.endsWith(VETERAN_RESUMES_MEASUREMENT_ID));
});

test('an initialized bridge cannot switch properties through later messages or another allowed origin',()=>{
 const f=fixture(),origin='https://veteranresumes.com';f.send({type:'hello'},origin);f.send(config,origin);f.scripts[0].onload();
 f.send({type:'hello'});f.send(config);f.send({type:'stop'});assert.equal(f.window['ga-disable-'+VETERAN_RESUMES_MEASUREMENT_ID],undefined);
 f.send({type:'event',name:'page_view',screen:'home',session_id:config.session_id,params:{}},origin);
 const entries=f.window.dataLayer.map(v=>Array.from(v));assert.equal(f.scripts.length,1);assert.equal(entries.filter(v=>v[0]==='config').length,1);assert.equal(entries.find(v=>v[0]==='event')[2].send_to,VETERAN_RESUMES_MEASUREMENT_ID);
 f.send({type:'stop'},origin);assert.equal(f.window['ga-disable-'+VETERAN_RESUMES_MEASUREMENT_ID],true);assert.equal(f.window['ga-disable-'+MEASUREMENT_ID],undefined);
});

test('the same-site collector can record fixed activity while lookalike origins and private fields cannot write',async()=>{
 const {createActivityHandler}=require('../api/_lib/resume-activity');let writes=0;
 const db={collection:()=>({doc:()=>({set:async()=>{writes++;}})})};
 const handler=createActivityHandler({db,increment:value=>value,rateLimit:()=>false});
 const body={protocol:VERSION,events:[{name:'page_view',screen:'website',source:'direct'}]};
 const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;},end(){}});
 const ok=response();await handler({method:'POST',headers:{origin:'https://usage.veteranresumes.com','content-type':'application/json'},body},ok);assert.equal(ok.code,204);assert.equal(ok.headers['Access-Control-Allow-Origin'],'https://usage.veteranresumes.com');assert.equal(writes,1);
 for(const origin of ['https://usage.veteranresumes.com.evil.invalid','https://evil.veteranresumes.com']){const res=response();await handler({method:'POST',headers:{origin,'content-type':'application/json'},body},res);assert.equal(res.code,403);}
 const invalid=response();await handler({method:'POST',headers:{origin:'https://usage.veteranresumes.com','content-type':'application/json'},body:{...body,email:'PRIVATE_EMAIL'}},invalid);assert.equal(invalid.code,400);assert.equal(writes,1);assert.doesNotMatch(JSON.stringify(invalid),/PRIVATE_EMAIL/);
});
