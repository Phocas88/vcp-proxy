// Fictional fields only. Read Google's real SDK, then abort every analytics hit
// before delivery so this privacy check does not populate the owner's reports.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
const require=createRequire(import.meta.url);
const {renderAnalyticsBridge,VERSION,MEASUREMENT_ID}=require('../api/_lib/resume-analytics.js');
if(!MEASUREMENT_ID){console.log('REAL_ANALYTICS_SDK_CHECK '+JSON.stringify({configured:false,checked:false,analyticsHitsDelivered:0,reason:'App Measurement ID required before activation'}));process.exit(0);}
// Fulfil fictional pages on distinct HTTPS sites before any network request.
// This exercises the same cross-site cookie rules as production.
const {html,csp}=renderAnalyticsBridge();
const cid='123456789.1793200000000',sid='1793200000';
const parentHtml=`<!doctype html><html><head><title>PRIVATE_PARENT_TITLE</title></head><body><form><input value="PRIVATE_EMAIL"><textarea>PRIVATE_RESUME_AND_VA_ENTRY</textarea></form><a href="https://profiles.veterancareerpath.com/veteran/PRIVATE_CV">PRIVATE_FILENAME.pdf</a><iframe id="bridge" hidden sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" src="https://vcp-proxy.vercel.app/"></iframe><script>addEventListener('message',event=>{if(event.origin!=='https://vcp-proxy.vercel.app'||event.data.type!=='ready')return;const target=document.getElementById('bridge').contentWindow;target.postMessage({protocol:${JSON.stringify(VERSION)},type:'configure',client_id:${JSON.stringify(cid)},session_id:${JSON.stringify(sid)},source:'linkedin',screen:'home'},'https://vcp-proxy.vercel.app');for(const name of ['page_view','vcp_resume_review_complete'])target.postMessage({protocol:${JSON.stringify(VERSION)},type:'event',name,screen:'home',session_id:${JSON.stringify(sid)},engagement_time_msec:1500,params:{kind:'new',email:'PRIVATE_EMAIL',resume:'PRIVATE_RESUME',filename:'PRIVATE_FILENAME',page_location:'https://example.com/PRIVATE_URL'}},'https://vcp-proxy.vercel.app');});document.getElementById('bridge').addEventListener('load',()=>document.getElementById('bridge').contentWindow.postMessage({protocol:${JSON.stringify(VERSION)},type:'hello'},'https://vcp-proxy.vercel.app'));</script></body></html>`;
let browser;
try{
 browser=await chromium.launch({channel:'chromium'});const context=await browser.newContext();const external=[],hits=[],activity=[];const page=await context.newPage();
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.hostname==='vcp-proxy.vercel.app'&&url.pathname==='/api/resume-activity'){activity.push(request.postDataJSON());return route.fulfill({status:204,body:''});}
  if(url.hostname==='veterancareerpath.com')return route.fulfill({contentType:'text/html',body:parentHtml});
  if(url.hostname==='vcp-proxy.vercel.app')return route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':csp,'Referrer-Policy':'no-referrer'},body:html});
  if(url.hostname.endsWith('google-analytics.com')||url.hostname.endsWith('analytics.google.com')){const headers=await request.allHeaders();const record={url:request.url(),body:request.postData()||'',headers};external.push(record);hits.push(record);return route.abort();}
  if(url.hostname==='www.googletagmanager.com')external.push({url:request.url(),headers:await request.allHeaders()});return route.continue();
 });
 await page.goto('https://veterancareerpath.com/resumereview/?build=PRIVATE_BUILD&email=PRIVATE_QUERY_EMAIL');
 const deadline=Date.now()+60000;while(Date.now()<deadline&&!hits.some(hit=>(hit.url+' '+hit.body).includes('vcp_resume_review_complete')))await new Promise(resolve=>setTimeout(resolve,250));
 assert.ok(hits.length,'The live Google SDK should attempt a measurement request.');assert.ok(hits.some(hit=>(hit.url+' '+hit.body).includes('vcp_resume_review_complete')),'The SDK should serialize a permitted app event.');
 await page.waitForTimeout(1600);assert.ok(activity.length,'Consented activity should reach the aggregate transport');assert.ok(!JSON.stringify(activity).includes(cid)&&!JSON.stringify(activity).includes(sid)&&!JSON.stringify(activity).includes('PRIVATE_'),'Activity transport excludes identifiers and private fields');
 assert.ok(!JSON.stringify(external).includes('PRIVATE_'),'No parent URL, title, field, filename or extra event property may reach Google.');
 for(const hit of hits){const url=new URL(hit.url);assert.equal(url.searchParams.get('tid'),MEASUREMENT_ID);assert.equal(url.searchParams.get('cid'),cid);assert.equal(url.searchParams.get('dl'),'https://veterancareerpath.com/resumereview/screen/home');}
 const cookies=(await context.cookies()).filter(cookie=>cookie.name.startsWith('vcp_resume'));assert.ok(cookies.length,'Cross-site measurement should establish its isolated session cookie');assert.ok(cookies.every(cookie=>cookie.secure&&cookie.sameSite==='None'&&cookie.partitionKey==='https://veterancareerpath.com'),'Collector cookies must be partitioned by the embedding site');
 console.log('REAL_ANALYTICS_SDK_CHECK '+JSON.stringify({sdkLoaded:true,allowedEventSerialized:true,privateDataSent:false,analyticsHitsDelivered:0,destinationMatched:true,browserIdMatched:true,crossSiteCollector:true,partitionedCookies:true,aggregateTransportPrivateDataSent:false}));
}finally{await browser?.close();}
