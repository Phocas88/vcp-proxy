'use strict';
const {createHash}=require('node:crypto');
const protocol=require('./resume-analytics-protocol.json');
const MEASUREMENT_ID='G-CMFKLT321J'; // Existing VCP GA4 destination; public identifier.
const VERSION='vcp-resume-analytics-v1';
const PARENTS=['https://veterancareerpath.com','https://www.veterancareerpath.com','https://mobile-resume-review-app.vercel.app','http://127.0.0.1:3000','http://localhost:3000'];

// This function runs in a separate-origin, sandboxed document. Google code never
// runs in the editor and cannot inspect its fields, links, files or query string.
function collector(protocol,measurementId,version,parents){
 if(window.parent===window)return;
 let ownerOrigin=null,configured=false,stopped=false,loaded=false,pending=[],currentScreen='home',identity=null;
 const safeScreen=value=>typeof value==='string'&&Object.prototype.hasOwnProperty.call(protocol.screens,value);
 const page=screen=>'https://veterancareerpath.com/resumereview/screen/'+screen;
 const post=type=>{if(ownerOrigin)parent.postMessage({protocol:version,type},ownerOrigin);};
 const clean=(name,params)=>{
  if(typeof name!=='string'||!Object.prototype.hasOwnProperty.call(protocol.events,name)||!params||typeof params!=='object'||Array.isArray(params))return null;
  const out={};for(const [key,values]of Object.entries(protocol.events[name]))if(values.includes(params[key]))out[key]=params[key];return out;
 };
 function emit(value){
  if(stopped||!configured||!safeScreen(value.screen)||!/^\d{9,13}$/.test(value.session_id||''))return;
  const params=clean(value.name,value.params);if(!params)return;
  if(!loaded){if(pending.length<40)pending.push(value);return;}
  const previous=currentScreen;currentScreen=value.screen;
  const payload={...params,send_to:measurementId,app_name:'VCP Resume',app_area:'vcp_resume',page_location:page(currentScreen),page_title:'VCP Resume · '+protocol.screens[currentScreen],page_referrer:previous!==currentScreen?page(previous):'',session_id:value.session_id};
  if(Number.isFinite(value.engagement_time_msec)&&value.engagement_time_msec>=0&&value.engagement_time_msec<=3600000)payload.engagement_time_msec=Math.round(value.engagement_time_msec);
  if(ownerOrigin.startsWith('http://'))payload.debug_mode=true;
  window.gtag('event',value.name,payload);
 }
 window.addEventListener('message',event=>{
  if(event.source!==parent||!parents.includes(event.origin)||event.data?.protocol!==version)return;
  const value=event.data;if(value.type==='hello'){if(!stopped){ownerOrigin=event.origin;post('ready');}return;}if(value.type==='stop'){
   stopped=true;pending=[];window['ga-disable-'+measurementId]=true;
   try{for(const cookie of document.cookie.split(';')){const name=cookie.trim().split('=')[0];if(/^vcp_resume_ga/.test(name))document.cookie=name+'=; Max-Age=0; path=/; SameSite=None; Secure';}}catch{}
   ownerOrigin=event.origin;post('stopped');return;
  }
  if(stopped)return;
  if(value.type==='configure'){
   if(configured||!/^\d{1,10}\.\d{10,13}$/.test(value.client_id||'')||!/^\d{9,13}$/.test(value.session_id||'')||!protocol.sources.includes(value.source)||!safeScreen(value.screen))return;
   ownerOrigin=event.origin;configured=true;currentScreen=value.screen;identity=value.client_id;
   window.dataLayer=[];window.gtag=function(){window.dataLayer.push(arguments);};
   window.gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
   window.gtag('set',{allow_google_signals:false,allow_ad_personalization_signals:false,ads_data_redaction:true,url_passthrough:false});
   window.gtag('js',new Date());
   const referrers={tiktok:'https://www.tiktok.com/',linkedin:'https://www.linkedin.com/',google:'https://www.google.com/',bing:'https://www.bing.com/',other:'',direct:''};
   window.gtag('config',measurementId,{send_page_view:false,client_id:identity,session_id:value.session_id,cookie_prefix:'vcp_resume',cookie_domain:'none',cookie_expires:0,cookie_update:false,allow_google_signals:false,allow_ad_personalization_signals:false,page_location:page(currentScreen),page_title:'VCP Resume · '+protocol.screens[currentScreen],page_referrer:referrers[value.source],campaign_source:value.source,campaign_medium:['tiktok','linkedin'].includes(value.source)?'social':value.source==='direct'?'(none)':'referral',campaign_name:'vcp_resume',linker:{accept_incoming:false,domains:[]},...(ownerOrigin.startsWith('http://')?{debug_mode:true}:{})});
   const script=document.createElement('script');script.async=true;script.referrerPolicy='no-referrer';script.src='https://www.googletagmanager.com/gtag/js?id='+measurementId;
   script.onload=()=>{if(stopped)return;loaded=true;const queue=pending;pending=[];queue.forEach(emit);post('collecting');};
   script.onerror=()=>{pending=[];post('blocked');};document.head.append(script);return;
  }
  if(event.origin===ownerOrigin&&value.type==='event')emit(value);
 });
 // Wait for the allowed parent's hello; no parent/referrer URL is read.
}

function renderAnalyticsBridge(){
 const script='('+collector.toString()+')('+JSON.stringify(protocol)+','+JSON.stringify(MEASUREMENT_ID)+','+JSON.stringify(VERSION)+','+JSON.stringify(PARENTS)+');';
 const hash=createHash('sha256').update(script).digest('base64');
 const csp="default-src 'none'; script-src 'sha256-"+hash+"' https://www.googletagmanager.com; connect-src https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com; img-src https://*.google-analytics.com; base-uri 'none'; form-action 'none'; frame-ancestors "+PARENTS.join(' ')+"; sandbox allow-scripts allow-same-origin";
 return {html:'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>VCP Resume usage measurement</title></head><body><script>'+script+'</script></body></html>',csp};
}
function serveAnalyticsBridge(req,res){
 const {html,csp}=renderAnalyticsBridge();res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',csp);res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','public, max-age=300, s-maxage=86400');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 if(req.method==='HEAD')return res.status(200).end();return res.status(200).send(html);
}
module.exports={renderAnalyticsBridge,serveAnalyticsBridge,MEASUREMENT_ID,VERSION,PARENTS,protocol};
