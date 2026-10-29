'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const {createHash}=require('node:crypto');
const {renderAnalyticsBridge,serveAnalyticsBridge,MEASUREMENT_ID,VERSION}=require('../api/_lib/resume-analytics');
function fixture(){
 const messages=[],scripts=[],listeners={};let parentReads=0;
 const parent={postMessage:(value,origin)=>messages.push({value,origin})};for(const key of ['document','location'])Object.defineProperty(parent,key,{get(){parentReads++;throw new Error('Private parent access');}});
 const window={parent,addEventListener:(name,fn)=>listeners[name]=fn};const document={head:{append:script=>scripts.push(script)},createElement:()=>({}),cookie:''};
 const {html}=renderAnalyticsBridge();vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1],{window,parent,document,Date,Number,Array,Object,JSON,String});
 const send=(data,origin='https://veterancareerpath.com',source=parent)=>listeners.message({data:{protocol:VERSION,...data},origin,source});
 return {window,send,scripts,messages,parentReads:()=>parentReads};
}
const config={type:'configure',client_id:'123456789.1793200000000',session_id:'1793200000',source:'linkedin',screen:'home'};
test('the public bridge has a hash-locked script, no editor access, no referrer and explicit embedding origins',()=>{
 const {html,csp}=renderAnalyticsBridge(),script=html.match(/<script>([\s\S]*)<\/script>/)[1];assert.ok(csp.includes("'sha256-"+createHash('sha256').update(script).digest('base64')+"'"));assert.match(csp,/frame-ancestors https:\/\/veterancareerpath.com/);assert.match(csp,/sandbox allow-scripts allow-same-origin/);assert.doesNotMatch(csp,/unsafe-inline|unsafe-eval|frame-ancestors \*/);assert.match(html,/name="referrer" content="no-referrer"/);assert.doesNotMatch(html,/<form|<input|<iframe|firebase/i);
 const headers={};let status,sent;const res={setHeader:(k,v)=>headers[k]=v,status(value){status=value;return this;},send(value){sent=value;},end(){sent='';}};serveAnalyticsBridge({method:'GET',query:{private:'DO_NOT_ECHO'}},res);assert.equal(status,200);assert.equal(headers['Referrer-Policy'],'no-referrer');assert.equal(headers['Content-Type'],'text/html; charset=utf-8');assert.doesNotMatch(sent,/DO_NOT_ECHO/);serveAnalyticsBridge({method:'HEAD'},res);assert.equal(sent,'');
});
test('no Google code starts before a valid message from an allowed parent',()=>{
 const f=fixture();assert.equal(f.scripts.length,0);f.send(config,'https://attacker.invalid');f.send(config,'https://veterancareerpath.com',{});f.send({...config,client_id:'firebase-user-id'});f.send({...config,source:'private-campaign-name'});assert.equal(f.scripts.length,0);f.send(config);assert.equal(f.scripts.length,1);assert.equal(f.scripts[0].src,'https://www.googletagmanager.com/gtag/js?id='+MEASUREMENT_ID);assert.equal(f.scripts[0].referrerPolicy,'no-referrer');assert.equal(f.parentReads(),0);
});
test('advertising stays denied, IDs are browser-generated and only fixed synthetic page locations reach the tag',()=>{
 const f=fixture();f.send(config);const values=f.window.dataLayer.map(value=>Array.from(value));const consent=values.find(value=>value[0]==='consent')[2],settings=values.find(value=>value[0]==='config')[2];assert.equal(consent.analytics_storage,'granted');assert.equal(consent.ad_storage,'denied');assert.equal(consent.ad_user_data,'denied');assert.equal(consent.ad_personalization,'denied');assert.equal(settings.client_id,config.client_id);assert.equal(settings.allow_google_signals,false);assert.equal(settings.allow_ad_personalization_signals,false);assert.equal(settings.send_page_view,false);assert.equal(settings.page_location,'https://veterancareerpath.com/resumereview/screen/home');assert.equal(settings.page_referrer,'https://www.linkedin.com/');assert.equal(settings.linker.accept_incoming,false);
});
test('unknown events, private screens, IDs, extra fields and free text are discarded before measurement',()=>{
 const f=fixture();f.send(config);f.scripts[0].onload();const packet={type:'event',name:'vcp_resume_review_failed',params:{reason:'provider',email:'PRIVATE_EMAIL',resume:'PRIVATE_RESUME',error:'PRIVATE_ERROR'},screen:'resume_review',session_id:config.session_id,engagement_time_msec:1200,user_id:'PRIVATE_ACCOUNT',page_location:'https://example.com/?resume=PRIVATE_URL'};
 f.send(packet);f.send({...packet,name:'PRIVATE_EVENT'});f.send({...packet,screen:'calculator'});f.send({...packet,screen:'PRIVATE_SCREEN'});f.send({...packet,session_id:'PRIVATE_SESSION'});const events=f.window.dataLayer.map(value=>Array.from(value)).filter(value=>value[0]==='event');assert.equal(events.length,1);assert.equal(events[0][2].reason,'provider');assert.equal(events[0][2].engagement_time_msec,1200);assert.equal(events[0][2].page_location,'https://veterancareerpath.com/resumereview/screen/resume_review');assert.doesNotMatch(JSON.stringify(events),/PRIVATE_/);assert.equal(f.parentReads(),0);
});
test('withdrawal disables the destination, drops queued events and rejects all later configuration',()=>{
 const f=fixture();f.send(config);f.send({type:'event',name:'page_view',params:{},screen:'home',session_id:config.session_id});f.send({type:'stop'});assert.equal(f.window['ga-disable-'+MEASUREMENT_ID],true);f.scripts[0].onload();f.send(config);f.send({type:'event',name:'vcp_resume_download',params:{format:'pdf',document:'resume'},screen:'resume_download',session_id:config.session_id});assert.equal(f.window.dataLayer.filter(value=>value[0]==='event').length,0);assert.ok(f.messages.some(item=>item.value.type==='stopped'));
});
test('the existing API keeps POST authorization and only the exact public bridge GET/HEAD route bypasses it',async()=>{
 const handler=require('../api/claude');let status,body;const res={setHeader(){},status(value){status=value;return this;},json(value){body=value;},send(value){body=value;},end(){body='';}};
 await handler({method:'GET',query:{},headers:{}},res);assert.equal(status,405);
 await handler({method:'POST',query:{__analytics:'bridge'},body:{},headers:{}},res);assert.equal(status,401);
 await handler({method:'GET',query:{__analytics:'bridge'},headers:{}},res);assert.equal(status,200);assert.match(body,/VCP Resume usage measurement/);
});
