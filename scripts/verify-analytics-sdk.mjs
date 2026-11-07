// Fictional fields only. Read Google's real SDK, then abort every analytics hit
// before delivery so this privacy check does not populate the owner's reports.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const require=createRequire(import.meta.url);
const {renderAnalyticsBridge,VERSION,MEASUREMENT_ID,VETERAN_RESUMES_MEASUREMENT_ID}=require('../api/_lib/resume-analytics.js');
if(!MEASUREMENT_ID){console.log('REAL_ANALYTICS_SDK_CHECK '+JSON.stringify({configured:false,checked:false,analyticsHitsDelivered:0,reason:'App Measurement ID required before activation'}));process.exit(0);}
// Fulfil fictional pages on distinct HTTPS sites before any network request.
// This exercises the same cross-site cookie rules as production.
const {html,csp}=renderAnalyticsBridge();
const cid='123456789.1793200000000',sid='1793200000';
const targets=[
 {site:'legacy-app',origin:'https://veterancareerpath.com',root:'https://veterancareerpath.com/resumereview/',screen:'home',event:'vcp_resume_review_complete',id:MEASUREMENT_ID},
 {site:'standalone-app',origin:'https://veteranresumes.com',root:'https://veteranresumes.com/',screen:'home',event:'vcp_resume_review_complete',id:VETERAN_RESUMES_MEASUREMENT_ID},
 {site:'standalone-website',origin:'https://veteranresumes.com',root:'https://veteranresumes.com/',screen:'website',event:'vcp_resume_website_action',id:VETERAN_RESUMES_MEASUREMENT_ID}
];
assert.ok(VETERAN_RESUMES_MEASUREMENT_ID,'Dedicated Veteran Resumes Measurement ID is required for release');
assert.notEqual(MEASUREMENT_ID,VETERAN_RESUMES_MEASUREMENT_ID,'The two sites must use different destinations');
const parentPage=target=>`<!doctype html><html><head><title>PRIVATE_PARENT_TITLE</title></head><body><form><input value="PRIVATE_EMAIL"><textarea>PRIVATE_RESUME_AND_VA_ENTRY</textarea></form><a href="https://profiles.veterancareerpath.com/veteran/PRIVATE_CV">PRIVATE_FILENAME.pdf</a><iframe id="bridge" hidden sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" src="https://vcp-proxy.vercel.app/"></iframe><script>addEventListener('message',event=>{if(event.origin!=='https://vcp-proxy.vercel.app'||event.data.type!=='ready')return;const target=document.getElementById('bridge').contentWindow;target.postMessage({protocol:${JSON.stringify(VERSION)},type:'configure',client_id:${JSON.stringify(cid)},session_id:${JSON.stringify(sid)},source:'linkedin',screen:${JSON.stringify(target.screen)}},'https://vcp-proxy.vercel.app');for(const name of ${JSON.stringify(['page_view',target.event])})target.postMessage({protocol:${JSON.stringify(VERSION)},type:'event',name,screen:${JSON.stringify(target.screen)},session_id:${JSON.stringify(sid)},engagement_time_msec:1500,params:{kind:'new',action:'example',email:'PRIVATE_EMAIL',resume:'PRIVATE_RESUME',filename:'PRIVATE_FILENAME',page_location:'https://example.com/PRIVATE_URL'}},'https://vcp-proxy.vercel.app');});document.getElementById('bridge').addEventListener('load',()=>document.getElementById('bridge').contentWindow.postMessage({protocol:${JSON.stringify(VERSION)},type:'hello'},'https://vcp-proxy.vercel.app'));</script></body></html>`;
async function diagnoseTag(browser){
 const standard=()=>"window.dataLayer=[];window.gtag=function(){window.dataLayer.push(arguments);};window.gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});window.gtag('js',new Date());window.gtag('config',"+JSON.stringify(VETERAN_RESUMES_MEASUREMENT_ID)+",{page_location:'https://veteranresumes.com/',allow_google_signals:false});window.gtag('event','vcp_resume_review_complete',{send_to:"+JSON.stringify(VETERAN_RESUMES_MEASUREMENT_ID)+"});const script=document.createElement('script');script.src='https://www.googletagmanager.com/gtag/js?id='+"+JSON.stringify(VETERAN_RESUMES_MEASUREMENT_ID)+";document.head.append(script);";
 const variants=[
  {name:'new-id-proxy-top',change:standard,direct:true,csp:false},
  {name:'same-site-subdomain',change:s=>s,bridgeOrigin:'https://usage.veteranresumes.com'},
  {name:'same-site-www',change:s=>s,bridgeOrigin:'https://www.veteranresumes.com'},
  {name:'origin-script-referrer',change:s=>s.replace("script.referrerPolicy='no-referrer';","script.referrerPolicy='origin';")},
  {name:'without-referrer-suppression',change:s=>s.replace("script.referrerPolicy='no-referrer';",''),referrer:true},
  {name:'simple-iframe-without-csp',change:standard,csp:false,sandbox:false}
 ];
 for(const probe of variants){
  const context=await browser.newContext(),page=await context.newPage(),requests=[],errors=[];
  const fixture={origin:'https://veteranresumes.com',screen:'home',event:'vcp_resume_review_complete'},bridgeOrigin=probe.bridgeOrigin||'https://vcp-proxy.vercel.app';
  const original=renderAnalyticsBridge(),script=original.html.match(/<script>([\s\S]*)<\/script>/)[1],changed=probe.change(script);

  const bridge={html:original.html.replace(script,changed),csp:original.csp.replace(/sha256-[^']+/,"sha256-"+createHash('sha256').update(changed).digest('base64'))};
  if(probe.referrer)bridge.html=bridge.html.replace('<meta name=\"referrer\" content=\"no-referrer\">','');
  if(probe.sandbox===false)bridge.csp=bridge.csp.replace('; sandbox allow-scripts allow-same-origin','');
  page.on('pageerror',error=>errors.push(error.message.slice(0,200)));
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin===fixture.origin)return route.fulfill({contentType:'text/html',body:parentPage(fixture).replaceAll('https://vcp-proxy.vercel.app',bridgeOrigin).replace(probe.referrer?'referrerpolicy=\"no-referrer\"':'NO_MATCH','').replace(probe.sandbox===false?'sandbox=\"allow-scripts allow-same-origin\"':'NO_MATCH','').replace(probe.visible?' hidden ':'NO_MATCH',' ')});
   if(url.origin===bridgeOrigin&&url.pathname==='/api/resume-activity')return route.fulfill({status:204,body:''});
   if(url.origin===bridgeOrigin)return route.fulfill({contentType:'text/html',headers:probe.csp===false?{}:{'Content-Security-Policy':bridge.csp,...(probe.referrer?{}:{'Referrer-Policy':'no-referrer'})},body:bridge.html});
   requests.push({path:url.origin+url.pathname,event:(request.url()+' '+(request.postData()||'')).includes(fixture.event)});
   if(url.hostname==='www.googletagmanager.com')return route.continue();
   return route.abort();
  });
  await page.goto((probe.direct?bridgeOrigin:fixture.origin)+'/');await page.waitForTimeout(4000);
  console.log('ANALYTICS_CONTROL_PROBE '+JSON.stringify({name:probe.name,requests,errors}));await context.close();
 }
}
let browser;
try{
 browser=await chromium.launch({channel:'chromium'});
 for(const target of targets){
 const context=await browser.newContext();const external=[],hits=[],activity=[],diagnostics={requests:[],errors:[],scripts:[]};const page=await context.newPage();
 page.on('console',message=>{if(message.type()==='error')diagnostics.errors.push(message.text().replace(/PRIVATE_[A-Z_]+/g,'REDACTED_FIXTURE').slice(0,350));});
 page.on('pageerror',error=>diagnostics.errors.push(error.message.slice(0,350)));
 page.on('response',response=>{if(new URL(response.url()).hostname==='www.googletagmanager.com')diagnostics.scripts.push({path:new URL(response.url()).pathname,status:response.status()});});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(diagnostics.requests.length<30)diagnostics.requests.push(url.origin+url.pathname);
  if(url.hostname==='vcp-proxy.vercel.app'&&url.pathname==='/api/resume-activity'){activity.push(request.postDataJSON());return route.fulfill({status:204,body:''});}
  if(url.origin===target.origin)return route.fulfill({contentType:'text/html',body:parentPage(target)});
  if(url.hostname==='vcp-proxy.vercel.app')return route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':csp,'Referrer-Policy':'no-referrer'},body:html});
  if(url.hostname.endsWith('google-analytics.com')||url.hostname.endsWith('analytics.google.com')){const headers=await request.allHeaders();const record={url:request.url(),body:request.postData()||'',headers};external.push(record);hits.push(record);return route.abort();}
  if(url.hostname==='www.googletagmanager.com')external.push({url:request.url(),headers:await request.allHeaders()});return route.continue();
 });
 await page.goto(target.root+'?build=PRIVATE_BUILD&email=PRIVATE_QUERY_EMAIL');
 const deadline=Date.now()+60000;while(Date.now()<deadline&&!hits.some(hit=>(hit.url+' '+hit.body).includes(target.event)))await new Promise(resolve=>setTimeout(resolve,250));
 if(!hits.length){console.log('ANALYTICS_TAG_DIAGNOSTICS '+JSON.stringify({site:target.site,...diagnostics}));await diagnoseTag(browser);}
 assert.ok(hits.length,'The live Google SDK should attempt a measurement request for '+target.site);assert.ok(hits.some(hit=>(hit.url+' '+hit.body).includes(target.event)),'The SDK should serialize a permitted event for '+target.site);
 await page.waitForTimeout(1600);assert.ok(activity.length,'Consented activity should reach the aggregate transport');assert.ok(!JSON.stringify(activity).includes(cid)&&!JSON.stringify(activity).includes(sid)&&!JSON.stringify(activity).includes('PRIVATE_'),'Activity transport excludes identifiers and private fields');
 assert.ok(!JSON.stringify(external).includes('PRIVATE_'),'No parent URL, title, field, filename or extra event property may reach Google.');
 for(const hit of hits){const url=new URL(hit.url);assert.equal(url.searchParams.get('tid'),target.id);assert.equal(url.searchParams.get('cid'),cid);assert.equal(url.searchParams.get('dl'),target.screen==='website'?target.root:target.root+'screen/'+target.screen);}
 const cookies=(await context.cookies()).filter(cookie=>cookie.name.startsWith('vcp_resume'));assert.ok(cookies.length,'Cross-site measurement should establish its isolated session cookie');assert.ok(cookies.every(cookie=>cookie.secure&&cookie.sameSite==='None'&&cookie.partitionKey===target.origin),'Collector cookies must be partitioned by the embedding site');
 console.log('REAL_ANALYTICS_SDK_CHECK '+JSON.stringify({site:target.site,measurementId:target.id,sdkLoaded:true,allowedEventSerialized:true,privateDataSent:false,analyticsHitsDelivered:0,destinationMatched:true,browserIdMatched:true,crossSiteCollector:true,partitionedCookies:true,aggregateTransportPrivateDataSent:false}));
 await context.close();
 }
}finally{await browser?.close();}
